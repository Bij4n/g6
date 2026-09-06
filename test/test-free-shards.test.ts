import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isFreeTestFile,
  collectFreeTestFiles,
  detectWindowsFragility,
  curateWindowsSafe,
  stableHash,
  assignFilesToShards,
  normalizeRelativePath,
  FREE_TEST_TIMEOUT_MS,
} from '../scripts/test-free-shards';

const ROOT = path.resolve(import.meta.dir, '..');

describe('test-free-shards: enumeration', () => {
  test('isFreeTestFile rejects non-test files', () => {
    expect(isFreeTestFile('test/foo.ts')).toBe(false);
    expect(isFreeTestFile('test/foo.test.ts')).toBe(true);
    expect(isFreeTestFile('test/foo.test.tsx')).toBe(true);
    expect(isFreeTestFile('test/foo.test.mjs')).toBe(true);
  });

  test('isFreeTestFile rejects paid eval tests', () => {
    expect(isFreeTestFile('test/skill-e2e-foo.test.ts')).toBe(false);
    expect(isFreeTestFile('test/skill-llm-eval.test.ts')).toBe(false);
    expect(isFreeTestFile('test/codex-e2e.test.ts')).toBe(false);
    expect(isFreeTestFile('test/gemini-e2e.test.ts')).toBe(false);
  });

  test('collectFreeTestFiles returns sorted, deduped, only-free list', () => {
    const files = collectFreeTestFiles(ROOT);
    expect(files.length).toBeGreaterThan(10);
    expect(files).toEqual([...files].sort());
    expect(new Set(files).size).toBe(files.length);
    for (const f of files) {
      expect(isFreeTestFile(f)).toBe(true);
    }
  });

  test('normalizeRelativePath converts Windows backslashes to forward slashes', () => {
    expect(normalizeRelativePath('test\\foo\\bar.test.ts')).toBe('test/foo/bar.test.ts');
    expect(normalizeRelativePath('test/foo/bar.test.ts')).toBe('test/foo/bar.test.ts');
  });
});

describe('test-free-shards: Windows curation', () => {
  function withTempFile(content: string, fn: (filePath: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curation-test-'));
    const file = path.join(dir, 'sample.test.ts');
    fs.writeFileSync(file, content);
    try {
      fn(file);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('detects /bin/bash hardcode', () => {
    withTempFile(`spawn('/bin/bash', ['-c', 'echo hi']);`, (f) => {
      expect(detectWindowsFragility(f)?.reason).toBe('hardcoded /bin/sh or /bin/bash');
    });
  });

  test('detects spawn("sh", ...)', () => {
    withTempFile(`spawnSync('sh', ['-c', 'command -v claude']);`, (f) => {
      expect(detectWindowsFragility(f)?.reason).toBe('spawn("sh", ...)');
    });
  });

  test('detects raw /tmp/ paths', () => {
    withTempFile(`const TMPERR = '/tmp/codex-err.txt';`, (f) => {
      expect(detectWindowsFragility(f)?.reason).toBe('raw /tmp/ path (use os.tmpdir())');
    });
  });

  test('detects which claude shell command', () => {
    withTempFile(`execSync('which claude').trim();`, (f) => {
      expect(detectWindowsFragility(f)?.reason).toBe('which claude (use Bun.which)');
    });
  });

  test('Windows-safe code passes the filter', () => {
    withTempFile(`import { spawn } from 'child_process'; spawn(claude.command, args);`, (f) => {
      expect(detectWindowsFragility(f)).toBeNull();
    });
  });

  test('curateWindowsSafe partitions files into safe + excluded', () => {
    const files = collectFreeTestFiles(ROOT);
    const result = curateWindowsSafe(files, ROOT);
    expect(result.safe.length + result.excluded.length).toBe(files.length);
    // Sanity: at least one excluded entry, since we know test/ship-version-sync.test.ts uses /bin/bash
    expect(result.excluded.length).toBeGreaterThan(0);
    // Every excluded entry has a non-empty reason
    for (const { reason } of result.excluded) {
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

describe('test-free-shards: sharding', () => {
  test('stableHash is deterministic', () => {
    expect(stableHash('foo.test.ts')).toBe(stableHash('foo.test.ts'));
    expect(stableHash('foo.test.ts')).not.toBe(stableHash('bar.test.ts'));
  });

  test('assignFilesToShards distributes files into N non-empty shards', () => {
    const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts'];
    const shards = assignFilesToShards(files, 3);
    const flattened = shards.flat();
    expect(flattened.sort()).toEqual([...files].sort());
    expect(shards.every((s) => s.length > 0)).toBe(true);
  });

  test('assignFilesToShards rejects invalid shard counts', () => {
    expect(() => assignFilesToShards(['a.test.ts'], 0)).toThrow();
    expect(() => assignFilesToShards(['a.test.ts'], -1)).toThrow();
  });

  test('shards are stable across runs (same files always land in same shard)', () => {
    const files = ['x.test.ts', 'y.test.ts', 'z.test.ts'];
    const a = assignFilesToShards(files, 5);
    const b = assignFilesToShards(files, 5);
    expect(a).toEqual(b);
  });
});

/**
 * The `test` script in package.json is the pre-commit gate CLAUDE.md mandates,
 * and it is the only place the whole free suite runs. It used to take bun's
 * defaults while the shard runner set its own, so the gate ran every browser
 * test against a 5s ceiling and at default concurrency. snapshot.test.ts passes
 * 45/45 alone and lost 33 tests to that ceiling in a full run — noise that looks
 * exactly like a regression.
 */
describe('the gate runs under the same limits as the shard runner', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(import.meta.dir, '..', 'package.json'), 'utf-8'),
  ) as { scripts: Record<string, string> };

  test('bun test uses the shard runner timeout', () => {
    expect(pkg.scripts.test).toContain(`--timeout=${FREE_TEST_TIMEOUT_MS}`);
  });

  test('bun test pins concurrency, like the shard runner', () => {
    // This flag is a guard, not a speedup. bun's --max-concurrency only bounds
    // test.concurrent() tests, and no free test is concurrent, so the
    // 518s -> 320s win came from --timeout=10000 and the browser-leak fixes.
    // Keeping it pinned means a future test.concurrent() in a suite that shares
    // one browser process cannot quietly start interleaving.
    expect(pkg.scripts.test).toContain('--max-concurrency=1');
  });

  test('the shard runner enumerates the same roots the gate runs', () => {
    // Two definitions of "the free suite" drifting apart is what hid
    // design/test/feedback-roundtrip from the v1.46.1.0 teardown sweep.
    const runnerSrc = fs.readFileSync(
      path.join(import.meta.dir, '..', 'scripts', 'test-free-shards.ts'), 'utf-8',
    );
    const roots = (runnerSrc.match(/const TEST_ROOTS = \[([^\]]+)\]/) ?? [])[1] ?? '';
    for (const root of roots.split(',').map(r => r.trim().replace(/['"]/g, '')).filter(Boolean)) {
      expect(pkg.scripts.test).toContain(`${root}/`);
    }
  });

  test('bun test names design/test explicitly', () => {
    // bun treats these paths as filters, not a file set, so design/test used to
    // run without being listed. That invisibility is why the v1.46.1.0 teardown
    // sweep missed design/test/feedback-roundtrip.test.ts.
    expect(pkg.scripts.test).toContain('design/test/');
  });
});
