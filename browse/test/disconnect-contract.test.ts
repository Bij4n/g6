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
import { BrowserManager } from '../src/browser-manager';
import { closeBrowserQuietly } from './teardown';

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
});
