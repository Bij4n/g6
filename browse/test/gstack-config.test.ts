/**
 * Tests for bin/gstack-config bash script.
 *
 * Uses Bun.spawnSync to invoke the script with temp dirs and
 * GSTACK_STATE_DIR env override for full isolation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SCRIPT = join(import.meta.dir, '..', '..', 'bin', 'gstack-config');

let stateDir: string;

// The script resolves its state dir as G6_HOME → GSTACK_HOME → GSTACK_STATE_DIR, and
// we inherit process.env. Other suites in the shared bun process set GSTACK_HOME at
// module scope (domain-skills-storage, domain-skills-e2e), which outranks the
// GSTACK_STATE_DIR this file used to set alone and silently redirected the script to
// another directory. Point every rung of the chain at the same dir so precedence
// cannot decide the outcome.
function stateEnv(dir: string): Record<string, string> {
  return { G6_HOME: dir, GSTACK_HOME: dir, GSTACK_STATE_DIR: dir };
}

function run(args: string[] = [], extraEnv: Record<string, string> = {}) {
  const result = Bun.spawnSync(['bash', SCRIPT, ...args], {
    env: {
      ...process.env,
      ...stateEnv(stateDir),
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'gstack-config-test-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('gstack-config', () => {
  // ─── get ──────────────────────────────────────────────────
  test('get on missing file falls back to the built-in default, exit 0', () => {
    const { exitCode, stdout } = run(['get', 'auto_upgrade']);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('false');
  });

  // cross_project_learnings is the one key whose default is deliberately empty:
  // callers use "unset" to trigger the first-time prompt.
  test('get returns empty for a key whose default is intentionally unset', () => {
    const { exitCode, stdout } = run(['get', 'cross_project_learnings']);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  test('get existing key returns value', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'auto_upgrade: true\n');
    const { exitCode, stdout } = run(['get', 'auto_upgrade']);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('true');
  });

  test('get missing key returns empty', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'auto_upgrade: true\n');
    const { exitCode, stdout } = run(['get', 'nonexistent']);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  test('get returns last value when key appears multiple times', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'foo: bar\nfoo: baz\n');
    const { exitCode, stdout } = run(['get', 'foo']);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('baz');
  });

  // ─── set ──────────────────────────────────────────────────
  test('set creates file and writes key on missing file', () => {
    const { exitCode } = run(['set', 'auto_upgrade', 'true']);
    expect(exitCode).toBe(0);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('auto_upgrade: true');
  });

  test('set appends new key to existing file', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'foo: bar\n');
    const { exitCode } = run(['set', 'auto_upgrade', 'true']);
    expect(exitCode).toBe(0);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('foo: bar');
    expect(content).toContain('auto_upgrade: true');
  });

  test('set replaces existing key in-place', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'auto_upgrade: false\n');
    const { exitCode } = run(['set', 'auto_upgrade', 'true']);
    expect(exitCode).toBe(0);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('auto_upgrade: true');
    expect(content).not.toContain('auto_upgrade: false');
  });

  test('set creates state dir if missing', () => {
    const nestedDir = join(stateDir, 'nested', 'dir');
    const { exitCode } = run(['set', 'foo', 'bar'], stateEnv(nestedDir));
    expect(exitCode).toBe(0);
    expect(existsSync(join(nestedDir, 'config.yaml'))).toBe(true);
  });

  // ─── list ─────────────────────────────────────────────────
  test('list shows all keys', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'auto_upgrade: true\nupdate_check: false\n');
    const { exitCode, stdout } = run(['list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('auto_upgrade: true');
    expect(stdout).toContain('update_check: false');
  });

  test('list on missing file shows the active defaults, exit 0', () => {
    const { exitCode, stdout } = run(['list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Active values (including defaults for unset keys)');
    expect(stdout).toContain('auto_upgrade:');
    expect(stdout).toContain('(default)');
  });

  // ─── usage ────────────────────────────────────────────────
  test('no args shows usage and exits 1', () => {
    const { exitCode, stdout } = run([]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Usage');
  });

  // ─── security: input validation ─────────────────────────
  test('set rejects key with regex metacharacters', () => {
    const { exitCode, stderr } = run(['set', '.*', 'value']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('alphanumeric');
  });

  test('set preserves value with sed special chars', () => {
    run(['set', 'test_special', 'a/b&c\\d']);
    const { stdout } = run(['get', 'test_special']);
    expect(stdout).toBe('a/b&c\\d');
  });

  // ─── annotated header ──────────────────────────────────────
  test('first set writes annotated header with docs', () => {
    run(['set', 'telemetry', 'off']);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('# gstack configuration');
    expect(content).toContain('edit freely');
    expect(content).toContain('proactive:');
    expect(content).toContain('telemetry:');
    expect(content).toContain('auto_upgrade:');
    expect(content).toContain('skill_prefix:');
    expect(content).toContain('routing_declined:');
    expect(content).toContain('codex_reviews:');
    expect(content).toContain('skip_eng_review:');
  });

  test('header written only once, not duplicated on second set', () => {
    run(['set', 'foo', 'bar']);
    run(['set', 'baz', 'qux']);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    const headerCount = (content.match(/# gstack configuration/g) || []).length;
    expect(headerCount).toBe(1);
  });

  test('header does not break get on commented-out keys', () => {
    run(['set', 'telemetry', 'community']);
    // Header contains "# telemetry: anonymous" as a comment example.
    // get should return the real value, not the comment.
    const { stdout } = run(['get', 'telemetry']);
    expect(stdout).toBe('community');
  });

  test('existing config file is not overwritten with header', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'existing: value\n');
    run(['set', 'new_key', 'new_value']);
    const content = readFileSync(join(stateDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('existing: value');
    expect(content).not.toContain('# gstack configuration');
  });

  // ─── routing_declined ──────────────────────────────────────
  // ─── state-dir precedence ──────────────────────────────────
  // Documented in bin/gstack-config: G6_HOME wins, then GSTACK_HOME, then the legacy
  // GSTACK_STATE_DIR alias. Untested until now, which is how a leaked GSTACK_HOME from
  // another suite could silently redirect this whole file.
  test('G6_HOME outranks GSTACK_HOME and GSTACK_STATE_DIR', () => {
    const winner = mkdtempSync(join(tmpdir(), 'gstack-config-win-'));
    const loser = mkdtempSync(join(tmpdir(), 'gstack-config-lose-'));
    try {
      run(['set', 'telemetry', 'on'], {
        G6_HOME: winner,
        GSTACK_HOME: loser,
        GSTACK_STATE_DIR: loser,
      });
      expect(existsSync(join(winner, 'config.yaml'))).toBe(true);
      expect(existsSync(join(loser, 'config.yaml'))).toBe(false);
    } finally {
      rmSync(winner, { recursive: true, force: true });
      rmSync(loser, { recursive: true, force: true });
    }
  });

  test('GSTACK_HOME outranks the legacy GSTACK_STATE_DIR alias', () => {
    const winner = mkdtempSync(join(tmpdir(), 'gstack-config-win-'));
    const loser = mkdtempSync(join(tmpdir(), 'gstack-config-lose-'));
    try {
      run(['set', 'telemetry', 'on'], {
        G6_HOME: '',
        GSTACK_HOME: winner,
        GSTACK_STATE_DIR: loser,
      });
      expect(existsSync(join(winner, 'config.yaml'))).toBe(true);
      expect(existsSync(join(loser, 'config.yaml'))).toBe(false);
    } finally {
      rmSync(winner, { recursive: true, force: true });
      rmSync(loser, { recursive: true, force: true });
    }
  });

  test('routing_declined defaults to false when unset', () => {
    const { stdout } = run(['get', 'routing_declined']);
    expect(stdout).toBe('false');
  });

  test('routing_declined can be set and read', () => {
    run(['set', 'routing_declined', 'true']);
    const { stdout } = run(['get', 'routing_declined']);
    expect(stdout).toBe('true');
  });

  test('routing_declined can be reset to false', () => {
    run(['set', 'routing_declined', 'true']);
    run(['set', 'routing_declined', 'false']);
    const { stdout } = run(['get', 'routing_declined']);
    expect(stdout).toBe('false');
  });
});
