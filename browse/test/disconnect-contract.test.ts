/**
 * The disconnect contract, from both sides.
 *
 * BrowserManager registers a crash handler in three places (launch, launchHeaded,
 * handoff). Each used to call process.exit() directly. That is correct for the
 * daemon, which owns its process and must not sit holding a dead browser — a
 * wedged server keeps the port and the next launch fails with EADDRINUSE. It is
 * wrong for every other caller: under `bun test` the exit ended the whole run,
 * and because it raced the reporter the run printed no summary and exited 0.
 *
 * `onDisconnect` is the discriminator. server.ts assigns it before launching;
 * an embedded consumer never does.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserManager } from '../src/browser-manager';
import { closeBrowserQuietly } from './teardown';

const SRC = path.resolve(import.meta.dir, '..', 'src');

/** Drop the browser without going through BrowserManager.close(), which would
 *  set intentionalDisconnect and suppress the handler. This is what a crash
 *  looks like from the manager's point of view. */
async function simulateCrash(bm: BrowserManager): Promise<void> {
  await (bm as unknown as { browser: { close(): Promise<void> } }).browser.close();
  // The 'disconnected' event is emitted asynchronously.
  await new Promise(resolve => setTimeout(resolve, 250));
}

describe('browser disconnect contract', () => {
  test('a crash hands the daemon its exit code instead of exiting directly', async () => {
    const bm = new BrowserManager();
    await bm.launch();

    const codes: Array<number | undefined> = [];
    bm.onDisconnect = (code) => { codes.push(code); };

    await simulateCrash(bm);

    // Code 1 is the crash code; 2 means a user closed a headed window.
    expect(codes).toEqual([1]);
  });

  test('a crash with no daemon wired does not end the host process', async () => {
    const bm = new BrowserManager();
    await bm.launch();
    // onDisconnect deliberately left null — this is the embedded case.

    await simulateCrash(bm);

    // Reaching this line at all is the assertion: before the fix the handler
    // called process.exit(1) here and the run died without a summary.
    expect(bm.onDisconnect).toBeNull();

    await closeBrowserQuietly(bm);
  });

  test('the daemon handler is awaited, not just called', async () => {
    // Production hands notifyDisconnect an async function (server.ts returns
    // activeShutdown(code), which is async). The sync-void path is the one the
    // test above takes, so pin the shape production actually uses.
    const bm = new BrowserManager();
    await bm.launch();

    let resolved = false;
    bm.onDisconnect = async () => {
      await new Promise(r => setTimeout(r, 10));
      resolved = true;
    };

    await simulateCrash(bm);
    expect(resolved).toBe(true);
  });

  test('closing the last tab never looks like a crash', async () => {
    // The closeTab fix is an ORDERING fix: open the replacement before closing
    // the last page, so `pages` never hits zero and Chromium never exits under
    // us. Asserting the end state (one tab) passes on the buggy order too, so
    // assert the thing that actually changed — the disconnect handler must
    // never fire.
    const bm = new BrowserManager();
    await bm.launch();

    const crashes: number[] = [];
    bm.onDisconnect = (code) => { crashes.push(code ?? -1); };

    await bm.closeTab();

    expect(crashes).toEqual([]);
    expect(bm.getTabCount()).toBe(1);

    bm.onDisconnect = null;
    await closeBrowserQuietly(bm);
  });
});

describe('crash handler registration', () => {
  const src = fs.readFileSync(path.join(SRC, 'browser-manager.ts'), 'utf-8');

  test('every disconnect handler goes through the shared registrar', () => {
    // launch(), launchHeaded() and handoff() each register one. They used to
    // be three hand-rolled copies that drifted: one printed the log-flush line
    // and the others did not, and launchHeaded still hard-exited when unwired
    // long after the other two stopped.
    const registrations = src.match(/registerCrashHandler\(/g) ?? [];
    // One definition plus three call sites.
    expect(registrations.length).toBe(4);
  });

  test('no disconnect handler calls process.exit directly', () => {
    const handlers = src.match(/on\('disconnected', \(\) => \{[\s\S]*?\n {4}\}\)/g) ?? [];
    for (const handler of handlers) {
      expect(handler).not.toContain('process.exit');
    }
  });
});

describe('server wires the disconnect handler', () => {
  const serverSrc = fs.readFileSync(path.join(SRC, 'server.ts'), 'utf-8');

  test('the cfg instance is wired, not just the module-level one', () => {
    // buildFetchHandler supports an embedder-supplied browserManager and the
    // module-level instance is not exported, so wiring only the module one
    // left every embedded daemon surviving a crash with a dead browser.
    expect(serverSrc).toContain('cfgBrowserManager.onDisconnect =');
  });

  test('a crash before activeShutdown is installed still exits', () => {
    // start() launches the browser before buildFetchHandler assigns
    // activeShutdown, so the optional call would resolve to undefined and read
    // as a clean shutdown.
    expect(serverSrc).toContain('activeShutdown ? activeShutdown(code) : process.exit(code)');
  });
});
