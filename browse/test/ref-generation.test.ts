/**
 * Ref generations — reusing a ref number across a snapshot must say so.
 *
 * Refs are positional. A fresh snapshot renumbers them, so a number carried over
 * from an earlier snapshot points at a different element or at nothing. The old
 * error ("Ref @e12 not found. Run 'snapshot' to get fresh refs.") was true but gave
 * the caller nothing to act on — it read like the element had vanished rather than
 * like the number was stale. These tests pin the actionable version.
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

afterAll(async () => {
  try { testServer.server.stop(); } catch {}
  await bm.close();
});

/** Ref whose snapshot line is exactly `[button] "<name>"`. */
function refForButton(snapshot: string, name: string): string {
  const line = snapshot
    .split('\n')
    .map(l => l.trim())
    .find(l => l.endsWith(`[button] "${name}"`));
  if (!line) throw new Error(`no button "${name}" in snapshot:\n${snapshot}`);
  return line.match(/^@(\S+)/)![1];
}

const clickError = async (ref: string): Promise<string> => {
  try {
    await handleWriteCommand('click', [ref], bm);
  } catch (e: any) {
    return e.message;
  }
  throw new Error(`expected click ${ref} to throw, it succeeded`);
};

describe('ref generations', () => {
  test('a ref reused after a re-snapshot names the element and its new ref', async () => {
    await handleWriteCommand('goto', [baseUrl + '/ref-renumber.html'], bm);

    const first = await handleMetaCommand('snapshot', ['-i'], bm, shutdown);
    const oldRef = refForButton(first, 'mark complete');

    // Collapse the filler buttons, then re-snapshot — "mark complete" renumbers.
    await handleWriteCommand('click', [`@${refForButton(first, 'collapse')}`], bm);
    const second = await handleMetaCommand('snapshot', ['-i'], bm, shutdown);
    const newRef = refForButton(second, 'mark complete');
    expect(newRef).not.toBe(oldRef);

    const msg = await clickError(`@${oldRef}`);
    expect(msg).toContain('earlier ref set');
    expect(msg).toContain('mark complete');
    expect(msg).toContain(`same role and name — @${newRef}`);
    expect(msg).toContain('renumbered by every snapshot');
    // The old message was actively misleading here; make sure it's gone.
    expect(msg).not.toBe(`Ref @${oldRef} not found. Run 'snapshot' to get fresh refs.`);
  }, 30000);

  test('a ref that never existed says so without inventing history', async () => {
    await handleWriteCommand('goto', [baseUrl + '/ref-renumber.html'], bm);
    await handleMetaCommand('snapshot', ['-i'], bm, shutdown);

    const msg = await clickError('@e900');
    expect(msg).toContain('not found');
    expect(msg).toContain('Current set is #');
    expect(msg).not.toContain('earlier ref set');
  }, 30000);

  test('generation advances per snapshot and refs cleared by navigation still explain themselves', async () => {
    await handleWriteCommand('goto', [baseUrl + '/ref-renumber.html'], bm);

    const before = bm.getActiveSession().getRefGeneration();
    const snap = await handleMetaCommand('snapshot', ['-i'], bm, shutdown);
    expect(bm.getActiveSession().getRefGeneration()).toBeGreaterThan(before);

    const ref = refForButton(snap, 'mark complete');

    // Navigating clears refs — the number must not silently resolve elsewhere.
    await handleWriteCommand('goto', [baseUrl + '/basic.html'], bm);
    const msg = await clickError(`@${ref}`);
    expect(msg).toContain('mark complete');
    expect(msg).toContain('earlier ref set');
  }, 30000);
});
