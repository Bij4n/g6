/**
 * `fill` must drive framework-controlled inputs, not just set .value.
 *
 * A stored learning claimed browse `fill` sets `input.value` without triggering
 * React's onChange, leaving controlled state empty so the form submits blank —
 * which would look exactly like a click that reports success and does nothing.
 * That claim is wrong for this code path, and this test pins why: `fill` goes
 * through Playwright's `locator.fill()`, which dispatches a real `input` event,
 * and React's onChange is the `input` event.
 *
 * The genuine (much narrower) gap is that `change` does NOT fire, so a listener
 * bound to `change` rather than `input` still won't see the value. Asserted below
 * so a future change to fill's implementation has to confront it deliberately.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startTestServer } from './test-server';
import { BrowserManager } from '../src/browser-manager';
import { handleWriteCommand as _handleWriteCommand } from '../src/write-commands';

const handleWriteCommand = (cmd: string, args: string[], b: BrowserManager) =>
  _handleWriteCommand(cmd, args, b.getActiveSession(), b);

let testServer: ReturnType<typeof startTestServer>;
let bm: BrowserManager;
let baseUrl: string;

beforeAll(async () => {
  testServer = startTestServer(0);
  baseUrl = testServer.url;
  bm = new BrowserManager();
  await bm.launch();
});

afterAll(async () => {
  try { testServer.server.stop(); } catch {}
  await bm.close();
});

const txt = (sel: string) => bm.getActiveSession().getPage().textContent(sel);

describe('fill on a controlled input', () => {
  test('populates state the submit handler reads, so submit is not refused', async () => {
    await handleWriteCommand('goto', [baseUrl + '/fill-controlled.html'], bm);

    await handleWriteCommand('fill', ['#origin', 'Kazakhstan'], bm);
    expect(await bm.getActiveSession().getPage().inputValue('#origin')).toBe('Kazakhstan');

    // The fixture's submit handler reads the state variable, never the DOM value.
    await handleWriteCommand('click', ['#submit'], bm);
    expect(await txt('#log')).toBe('submitted:Kazakhstan');
  }, 30000);

  test('dispatches input but not change', async () => {
    await handleWriteCommand('goto', [baseUrl + '/fill-controlled.html'], bm);
    await handleWriteCommand('fill', ['#origin', 'Kazakhstan'], bm);
    expect(await txt('#events')).toBe('events:input');
  }, 30000);
});
