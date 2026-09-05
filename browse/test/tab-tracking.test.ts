/**
 * One page must have exactly one tab id.
 *
 * In headed mode the context 'page' listener adopts every new page, and
 * Playwright fires that event for API-created pages too — not just tabs the
 * user opened. newTab() then registered the same page a second time, so
 * this.pages held two ids for one page. That made closeTab's last-tab check
 * read one too many, so it closed the real last page without opening a
 * replacement, Chromium exited, and the daemon shut itself down on a routine
 * `$B tab close`.
 *
 * Headless installs no such listener, which is why the whole free suite stayed
 * green while this was broken. These tests drive the tracking maps directly so
 * the invariant is checked without a display.
 */

import { describe, test, expect } from 'bun:test';
import { BrowserManager } from '../src/browser-manager';
import { TabSession } from '../src/tab-session';

/** Enough of a Page for the tracking bookkeeping. */
function fakePage() {
  return {
    on() {},
    once() {},
    url: () => 'about:blank',
    async evaluate() {},
    async close() {},
    isClosed: () => false,
  };
}

describe('tab tracking', () => {
  test('newTab reuses the id an adopted page already has', async () => {
    const bm = new BrowserManager() as any;
    const page = fakePage();

    // Simulate the headed listener having adopted this page first.
    bm.pages.set(1, page);
    bm.tabSessions.set(1, new TabSession(page as never));
    bm.nextTabId = 2;
    bm.context = { newPage: async () => page, pages: () => [page] };

    const id = await bm.newTab();

    expect(id).toBe(1);
    expect(bm.getTabCount()).toBe(1);
  });

  test('newTab registers a page nobody adopted', async () => {
    const bm = new BrowserManager() as any;
    const page = fakePage();
    bm.context = { newPage: async () => page, pages: () => [page] };

    const id = await bm.newTab();

    expect(id).toBeGreaterThan(0);
    expect(bm.getTabCount()).toBe(1);
  });

  test('the tracking map never holds two ids for one page', async () => {
    const bm = new BrowserManager() as any;
    const page = fakePage();
    bm.context = { newPage: async () => page, pages: () => [page] };

    await bm.newTab();
    await bm.newTab();

    const tracked = [...bm.pages.values()];
    expect(new Set(tracked).size).toBe(tracked.length);
  });

  test('a tab id is never zero', async () => {
    // nextTabId starts at 1, so 0 addresses nothing: every later command would
    // throw "No active page" instead of recovering.
    const bm = new BrowserManager() as any;
    const page = fakePage();
    bm.context = { newPage: async () => page, pages: () => [page] };

    await bm.newTab();
    expect(bm.getActiveTabId()).toBeGreaterThan(0);
  });
});
