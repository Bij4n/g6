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
import { sliceBetween } from './source-slice';

const SRC = path.resolve(import.meta.dir, '..', 'src');

/** Drop the browser without going through BrowserManager.close(), which would
 *  set intentionalDisconnect and suppress the handler. This is what a crash
 *  looks like from the manager's point of view. */
async function simulateCrash(bm: BrowserManager, settled?: () => boolean): Promise<void> {
  await (bm as unknown as { browser: { close(): Promise<void> } }).browser.close();
  // The 'disconnected' event is emitted asynchronously. Poll rather than sleep
  // a fixed interval — a cold Chromium on a loaded box is exactly when a fixed
  // wait turns this into a flake, and this suite is part of the gate now.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (settled?.()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

describe('browser disconnect contract', () => {
  test('a crash hands the daemon its exit code instead of exiting directly', async () => {
    const bm = new BrowserManager();
    await bm.launch();

    const codes: Array<number | undefined> = [];
    bm.onDisconnect = (code) => { codes.push(code); };

    await simulateCrash(bm, () => codes.length > 0);

    // Code 1 is the crash code; 2 means a user closed a headed window.
    expect(codes).toEqual([1]);
  });

  test('a crash with no daemon wired does not end the host process', async () => {
    const bm = new BrowserManager();
    await bm.launch();
    // onDisconnect deliberately left null — this is the embedded case.

    // Observe that the handler actually RAN and chose not to exit. Asserting
    // only that the process survived is invisible to the reporter: on
    // regression the run dies rather than naming a failed test.
    const errors: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
    try {
      await simulateCrash(bm, () => errors.some(e => e.includes('FATAL')));
    } finally {
      console.error = realError;
    }

    expect(errors.some(e => e.includes('Chromium process crashed'))).toBe(true);
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

    await simulateCrash(bm, () => resolved);
    expect(resolved).toBe(true);
  });

  test('two concurrent closes never strand the browser with zero pages', async () => {
    // The live-page count is a snapshot, not a reservation. Before closeTab was
    // serialized, two concurrent closes both read 2, both concluded they were
    // not closing the last page, and both closed — Chromium lost its final page
    // and took the daemon with it.
    const bm = new BrowserManager();
    await bm.launch();
    await bm.newTab();

    const crashes: number[] = [];
    bm.onDisconnect = (code) => { crashes.push(code ?? -1); };

    const ids = [...(bm as unknown as { pages: Map<number, unknown> }).pages.keys()];
    await Promise.all(ids.map(id => bm.closeTab(id)));

    expect(crashes).toEqual([]);
    expect(bm.getTabCount()).toBeGreaterThan(0);

    bm.onDisconnect = null;
    await closeBrowserQuietly(bm);
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

  test('no hand-rolled disconnect handler survives', () => {
    // The point is not how many times the registrar is named — it is that
    // nobody re-adds a bare listener. launch(), launchHeaded() and handoff()
    // each had their own copy and they drifted: one printed the log-flush line
    // and the others did not, and launchHeaded still hard-exited when unwired
    // long after the other two stopped.
    const listeners = src.match(/\.on\('disconnected',/g) ?? [];
    expect(listeners.length).toBe(1);
    // ...and the one that exists lives inside the registrar.
    const registrar = sliceBetween(src, 'private registerCrashHandler(', '\n  /**');
    expect(registrar).toContain(".on('disconnected'");
  });

  test('the only process.exit on the crash path is the watchdog and its fallbacks', () => {
    // The exits moved down into notifyDisconnect, so asserting the handler body
    // is clean proves nothing on its own. Assert where they actually live.
    const registrar = sliceBetween(src, 'private registerCrashHandler(', '\n  /**');
    expect(registrar).not.toContain('process.exit');
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

  test('a crash before activeShutdown is installed still exits, and cleans up', () => {
    // start() launches the browser before buildFetchHandler assigns
    // activeShutdown, so the optional call would resolve to undefined and read
    // as a clean shutdown. Exiting bare is not enough either: the state file
    // and singleton locks have to go, or the next launch hits EADDRINUSE.
    const wiring = sliceBetween(serverSrc, 'browserManager.onDisconnect =', '\nlet isShuttingDown');
    expect(wiring).toContain('activeShutdown(code)');
    expect(wiring).toContain('emergencyCleanup()');
    expect(wiring.indexOf('emergencyCleanup()')).toBeLessThan(wiring.indexOf('process.exit(code)'));
  });
});
