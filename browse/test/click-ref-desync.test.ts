/**
 * Regression: a snapshot ref must resolve to the element the snapshot showed.
 *
 * Ref locators are built as getByRole(role, {name}).nth(i). The index only means
 * anything if it is counted over the same elements the locator matches, and
 * getByRole's `name` option is a case-insensitive SUBSTRING match unless
 * `exact: true` is passed — while unnamed nodes pass no name at all and so match
 * every element of their role.
 *
 * Counting one population and indexing into another produced three failures, all
 * covered here:
 *   1. more than one match  → nth() applied (which also suppresses strict mode) →
 *      a click on a real, visible, WRONG element, reported as success
 *   2. icon-only buttons    → clicking the icon ref fired a named button's handler
 *   3. exactly one match    → no nth() → locator matched 2 elements → strict-mode
 *      error blaming the caller's selector
 *
 * Mode 3 was observed in production: `getByRole('button', { name: 'upload' })`
 * resolved to 2 elements because a file input carries role=button and its
 * accessible name "choose a file to upload" contains "upload".
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startTestServer } from './test-server';
import { BrowserManager } from '../src/browser-manager';
import { handleWriteCommand as _handleWriteCommand } from '../src/write-commands';
import { handleMetaCommand } from '../src/meta-commands';

const handleWriteCommand = (cmd: string, args: string[], b: BrowserManager) =>
  _handleWriteCommand(cmd, args, b.getActiveSession(), b);

let testServer: ReturnType<typeof startTestServer>;
let bm: BrowserManager;
let baseUrl: string;
const shutdown = async () => {};

beforeAll(async () => {
  testServer = startTestServer(0);
  baseUrl = testServer.url;
  bm = new BrowserManager();
  await bm.launch();
});

afterAll(() => {
  try { testServer.server.stop(); } catch {}
  setTimeout(() => process.exit(0), 500);
});

/** Refs whose snapshot line is exactly `[button] "<name>"`. */
function refsForButton(snapshot: string, name: string): string[] {
  return snapshot
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.endsWith(`[button] "${name}"`))
    .map(l => l.match(/^@(\S+)/)![1]);
}

/** Refs rendered as a bare `@eN [button]` line — no accessible name. */
function unnamedButtonRefs(snapshot: string): string[] {
  return snapshot
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^@\S+ \[button\]$/.test(l))
    .map(l => l.match(/^@(\S+)/)![1]);
}

const logText = () => bm.getActiveSession().getPage().textContent('#log');

describe('snapshot ref identity', () => {
  test('the 2nd of two identically-named buttons clicks that button, not a substring match', async () => {
    await handleWriteCommand('goto', [baseUrl + '/click-ref-desync.html'], bm);
    const snap = await handleMetaCommand('snapshot', ['-i'], bm, shutdown);

    // Page order: "Save", "Save draft", "Save" — getByRole({name:'Save'}) without
    // exact:true matches all three, so nth(1) used to land on "Save draft".
    const saveRefs = refsForButton(snap, 'Save');
    expect(saveRefs.length).toBe(2);

    expect(await logText()).toBe('none');
    const result = await handleWriteCommand('click', [`@${saveRefs[1]}`], bm);
    expect(result).toContain(`Clicked @${saveRefs[1]}`);
    expect(await logText()).toBe('save-b');
  }, 30000);

  test('an icon-only button ref clicks that icon, not a named sibling', async () => {
    await handleWriteCommand('goto', [baseUrl + '/click-ref-unnamed.html'], bm);
    const snap = await handleMetaCommand('snapshot', ['-i'], bm, shutdown);

    // Unnamed nodes get no name filter, so their index has to be counted across
    // every button on the page — including the named "Submit" ahead of them.
    const icons = unnamedButtonRefs(snap);
    expect(icons.length).toBe(2);

    await handleWriteCommand('click', [`@${icons[0]}`], bm);
    expect(await logText()).toBe('icon-close');

    await handleWriteCommand('click', [`@${icons[1]}`], bm);
    expect(await logText()).toBe('icon-menu');
  }, 30000);

  test('the production case: a file input does not shadow the "upload" button', async () => {
    // The DOM that produced the real strict-mode violation. A file input carries
    // role=button and its accessible name "choose a file to upload" contains
    // "upload", so the substring match resolved to both elements.
    await handleWriteCommand('goto', [baseUrl + '/click-ref-upload.html'], bm);
    const snap = await handleMetaCommand('snapshot', ['-i'], bm, shutdown);

    expect(refsForButton(snap, 'choose a file to upload').length).toBe(1);
    const uploadRefs = refsForButton(snap, 'upload');
    expect(uploadRefs.length).toBe(1);

    await handleWriteCommand('click', [`@${uploadRefs[0]}`], bm);
    expect(await logText()).toBe('upload');
  }, 30000);

  test('a uniquely-named button does not trip strict mode via a substring sibling', async () => {
    await handleWriteCommand('goto', [baseUrl + '/click-ref-strict.html'], bm);
    const snap = await handleMetaCommand('snapshot', ['-i'], bm, shutdown);

    // "Save" and "Save draft": only one exact "Save", so no nth() is applied and
    // the locator has to be exact or it resolves to both buttons.
    const saveRefs = refsForButton(snap, 'Save');
    expect(saveRefs.length).toBe(1);

    await handleWriteCommand('click', [`@${saveRefs[0]}`], bm);
    expect(await logText()).toBe('save');
  }, 30000);

  test('a ref survives the -d filter hiding an earlier button of the same name', async () => {
    // The output filters run AFTER the occurrence counters advance, because a node
    // the filter drops is still matched by getByRole. `-d 1` hides the button nested
    // under nav > ul > li; the body-level button that remains is the SECOND "act" on
    // the page, so its index has to be 1. Count after the filter instead and the
    // ref silently rewires to the hidden button.
    await handleWriteCommand('goto', [baseUrl + '/ref-depth-filter.html'], bm);
    const snap = await handleMetaCommand('snapshot', ['-d', '1'], bm, shutdown);

    const actRefs = refsForButton(snap, 'act');
    expect(actRefs.length).toBe(1);

    await handleWriteCommand('click', [`@${actRefs[0]}`], bm);
    expect(await logText()).toBe('shallow-b');
  }, 30000);

  test('a ref from a -s scoped snapshot indexes within the scope', async () => {
    // Two "Save" buttons in #sidebar, two in #main. `-s "#main"` counts only the
    // scoped tree, so the nth() index means "nth inside #main" — the locator has to
    // carry the same scope. Unscoped, nth(1) is the second SIDEBAR button.
    await handleWriteCommand('goto', [baseUrl + '/ref-scoped-selector.html'], bm);
    const snap = await handleMetaCommand('snapshot', ['-s', '#main', '-i'], bm, shutdown);

    const saveRefs = refsForButton(snap, 'Save');
    expect(saveRefs.length).toBe(2);

    await handleWriteCommand('click', [`@${saveRefs[0]}`], bm);
    expect(await logText()).toBe('main-save-a');

    await handleWriteCommand('click', [`@${saveRefs[1]}`], bm);
    expect(await logText()).toBe('main-save-b');
  }, 30000);
});
