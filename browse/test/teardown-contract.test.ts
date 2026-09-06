/**
 * Guards the browser-teardown contract across every suite that launches a real
 * browser.
 *
 * v1.46.1.0 replaced `setTimeout(() => process.exit(0), 500)` teardown with
 * `closeBrowserQuietly()` because a process.exit() anywhere in a test file ends
 * the whole `bun test` run: remaining files never execute and the run still
 * reports exit 0, with no summary line to show anything was skipped.
 *
 * That migration missed three files, and each miss was silent:
 *   - domain-skills-e2e / cdp-e2e called `await bm.cleanup?.()`. BrowserManager
 *     has no `cleanup` method, so optional chaining made it a no-op and the
 *     browser stayed open for the rest of the run.
 *   - design/test/feedback-roundtrip kept the process.exit(0) teardown. It sits
 *     outside the paths the `test` script lists, so it was invisible to the sweep.
 *
 * A leaked browser is not just a handle. Because close() never runs,
 * `intentionalDisconnect` stays false, so when that browser eventually dies the
 * handler in browser-manager.ts calls process.exit(1) and takes the run with it.
 *
 * These assertions are static on purpose: they cost no browser launch and they
 * fail on the next copy-paste rather than on the next full-suite truncation.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..', '..');
// Every root the gate runs. A BrowserManager suite added anywhere else
// would leak a browser with this guard none the wiser.
const TEST_DIRS = ['browse/test', 'design/test', 'test', 'make-pdf/test'];

/** This file names the banned patterns in order to test for them. */
const SELF = 'browse/test/teardown-contract.test.ts';

/**
 * The bodies of every afterAll/afterEach in a file, approximately: from the hook
 * to its closing `});` at the same indent. Approximate is fine — this is a
 * lint, and the failure it guards against (a process.exit in teardown) sits at
 * the top of the hook, not nested deep inside it.
 */
function teardownHooks(src: string): string[] {
  const hooks: string[] = [];
  const re = /\b(afterAll|afterEach)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const close = src.indexOf('\n});', m.index);
    hooks.push(src.slice(m.index, close === -1 ? m.index + 800 : close));
  }
  return hooks;
}

function testFiles(): string[] {
  return TEST_DIRS.flatMap(dir => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs)
      .filter(f => f.endsWith('.test.ts'))
      .map(f => path.join(dir, f));
  }).filter(rel => rel !== SELF);
}

/**
 * Files that launch a browser through BrowserManager. Suites that drive raw
 * Playwright (`chromium.launch()` + `browser.close()`) are a different case:
 * they never install BrowserManager's disconnect handler, so a slow close
 * leaks a handle instead of ending the run.
 */
function launchesViaBrowserManager(src: string): boolean {
  return /new BrowserManager\s*\(/.test(src) && /\.launch(Headed)?\s*\(/.test(src);
}

describe('browser teardown contract', () => {
  test('every BrowserManager suite closes it via closeBrowserQuietly', () => {
    const offenders = testFiles().filter(rel => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      // Require the call, not the token. The bug this guards against was a
      // suite that still LOOKED like it tore down (`await bm.cleanup?.()`);
      // an unused import would read the same way.
      return launchesViaBrowserManager(src) && !/await\s+closeBrowserQuietly\s*\(/.test(src);
    });

    expect(offenders).toEqual([]);
  });

  test('no suite uses the process.exit teardown that truncates the whole run', () => {
    const offenders = testFiles().filter(rel => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      // Look inside teardown hooks rather than at the whole file. Scanning
      // everything meant an ever-growing allowlist: several suites name
      // process.exit in a fixture script, a shell-injection payload, or an
      // assertion about cli.ts source, and none of those truncate a run.
      return teardownHooks(src).some(hook => /process\.exit\s*\(/.test(hook));
    });

    expect(offenders).toEqual([]);
  });

  test('closeBrowserQuietly is not silently optional-chained away', () => {
    // `await bm.cleanup?.()` type-checks, never throws, and does nothing.
    // Any optional-chained teardown call is a no-op waiting to happen.
    const offenders = testFiles().filter(rel => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      // Match the method, not the receiver: nothing forces a suite to name
      // its manager `bm`, and `await manager.cleanup?.()` is the same no-op.
      return /\.(cleanup|close|closeBrowserQuietly|teardown)\?\.\(/.test(src);
    });

    expect(offenders).toEqual([]);
  });
});
