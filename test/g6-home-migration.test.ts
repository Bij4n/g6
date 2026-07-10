/**
 * v1.44.0.0 migration — ~/.gstack moves to ~/.g6 with a compat symlink.
 * Every case runs against a throwaway fake HOME; the real HOME is never
 * touched (see the relink-mutates-source-via-symlink learning: migration
 * smoke tests against real HOME have bitten this repo before).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const MIGRATION = path.resolve(import.meta.dir, '..', 'gstack-upgrade', 'migrations', 'v1.44.0.0.sh');

let fakeHome: string;

function runMigration(): { status: number | null; stderr: string } {
  const r = spawnSync('bash', [MIGRATION], { env: { ...process.env, HOME: fakeHome } });
  return { status: r.status, stderr: r.stderr.toString() };
}

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'g6-migrate-'));
});

afterEach(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('v1.44.0.0 state-dir migration', () => {
  test('moves a real ~/.gstack to ~/.g6 and symlinks back', () => {
    fs.mkdirSync(path.join(fakeHome, '.gstack', 'projects'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.gstack', 'config.yaml'), 'skill_prefix: false\n');

    const { status } = runMigration();
    expect(status).toBe(0);

    // Data lives at ~/.g6 now
    expect(fs.readFileSync(path.join(fakeHome, '.g6', 'config.yaml'), 'utf-8')).toContain('skill_prefix');
    // Old path is a symlink that still resolves to the same data
    expect(fs.lstatSync(path.join(fakeHome, '.gstack')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(fakeHome, '.gstack', 'config.yaml'), 'utf-8')).toContain('skill_prefix');
    // Writes through the OLD path land in the NEW location
    fs.writeFileSync(path.join(fakeHome, '.gstack', 'via-old-path.txt'), 'x');
    expect(fs.existsSync(path.join(fakeHome, '.g6', 'via-old-path.txt'))).toBe(true);
  });

  test('idempotent — second run is a no-op', () => {
    fs.mkdirSync(path.join(fakeHome, '.gstack'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.gstack', 'marker'), '1');
    runMigration();
    const { status } = runMigration();
    expect(status).toBe(0);
    expect(fs.readFileSync(path.join(fakeHome, '.g6', 'marker'), 'utf-8')).toBe('1');
    expect(fs.lstatSync(path.join(fakeHome, '.gstack')).isSymbolicLink()).toBe(true);
  });

  test('conflict: both dirs exist → touches NOTHING, warns', () => {
    fs.mkdirSync(path.join(fakeHome, '.gstack'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.gstack', 'old-data'), 'old');
    fs.mkdirSync(path.join(fakeHome, '.g6'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.g6', 'new-data'), 'new');

    const { status, stderr } = runMigration();
    expect(status).toBe(0);
    expect(stderr).toContain('not merging');
    // Both untouched, no symlink created
    expect(fs.lstatSync(path.join(fakeHome, '.gstack')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(fakeHome, '.gstack', 'old-data'), 'utf-8')).toBe('old');
    expect(fs.readFileSync(path.join(fakeHome, '.g6', 'new-data'), 'utf-8')).toBe('new');
  });

  test('fresh machine: creates ~/.g6 and the compat symlink', () => {
    const { status } = runMigration();
    expect(status).toBe(0);
    expect(fs.lstatSync(path.join(fakeHome, '.g6')).isDirectory()).toBe(true);
    expect(fs.lstatSync(path.join(fakeHome, '.gstack')).isSymbolicLink()).toBe(true);
  });
});

describe('G6_HOME env precedence', () => {
  test('gstack-config prefers G6_HOME over GSTACK_HOME', () => {
    const g6Dir = path.join(fakeHome, 'g6-state');
    const legacyDir = path.join(fakeHome, 'legacy-state');
    fs.mkdirSync(g6Dir, { recursive: true });
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(g6Dir, 'config.yaml'), 'proactive: false\n');
    fs.writeFileSync(path.join(legacyDir, 'config.yaml'), 'proactive: true\n');

    const bin = path.resolve(import.meta.dir, '..', 'bin', 'gstack-config');
    const r = spawnSync(bin, ['get', 'proactive'], {
      env: { ...process.env, HOME: fakeHome, G6_HOME: g6Dir, GSTACK_HOME: legacyDir, GSTACK_STATE_DIR: legacyDir },
    });
    expect(r.stdout.toString().trim()).toBe('false');
  });

  test('gstack-config falls back to GSTACK_HOME when G6_HOME unset', () => {
    const legacyDir = path.join(fakeHome, 'legacy-state');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'config.yaml'), 'proactive: true\n');

    const bin = path.resolve(import.meta.dir, '..', 'bin', 'gstack-config');
    const env = { ...process.env, HOME: fakeHome, GSTACK_HOME: legacyDir, GSTACK_STATE_DIR: legacyDir };
    delete (env as Record<string, string | undefined>).G6_HOME;
    const r = spawnSync(bin, ['get', 'proactive'], { env });
    expect(r.stdout.toString().trim()).toBe('true');
  });
});
