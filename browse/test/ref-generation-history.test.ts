/**
 * Ref generation bookkeeping — the branches of `explainMissingRef` that a live
 * browser can't reach cheaply.
 *
 * `ref-generation.test.ts` drives the same code through a real page and covers the
 * headline case (reuse a number after a re-snapshot → "that element is now @eN").
 * The remaining branches need more ref sets than a page test wants to build, or a
 * current set deliberately shaped to have zero or two candidate matches:
 *
 *   - REF_HISTORY_DEPTH: only the last 3 superseded sets are remembered. The 4th
 *     set back must fall back to the plain message rather than name a wrong element.
 *   - matches.length !== 1: with no match, or with two equally good ones, the
 *     message must decline to point anywhere.
 *   - endedBy 'navigation' vs 'snapshot': different cause, different fix.
 *   - clearRefs() on an already-empty map must not burn a generation number, or
 *     every navigation on a page nobody snapshotted would inflate the count the
 *     error messages quote.
 *
 * Same pure-logic pattern as tab-isolation.test.ts and tab-session-frame-detach.test.ts:
 * type-cast mocks, no browser launch, so no `process.exit` teardown is needed.
 */

import { describe, test, expect } from 'bun:test';
import { TabSession, type RefEntry } from '../src/tab-session';
import type { Page, Locator } from 'playwright';

function mockPage(): Page {
  return {} as Page;
}

/** Build a ref map from [ref, role, name] triples. */
function mk(entries: Array<[string, string, string]>): Map<string, RefEntry> {
  const m = new Map<string, RefEntry>();
  for (const [ref, role, name] of entries) {
    m.set(ref, { locator: {} as Locator, role, name });
  }
  return m;
}

/** The error message `resolveRef` throws for a ref that isn't in the current set. */
async function missingRefError(session: TabSession, selector: string): Promise<string> {
  try {
    await session.resolveRef(selector);
  } catch (e: any) {
    return e.message;
  }
  throw new Error(`expected ${selector} to be unresolvable, it resolved`);
}

describe('ref generation history', () => {
  test('a ref older than the remembered sets stops claiming to know it', async () => {
    const session = new TabSession(mockPage());

    // @e10 exists only in the oldest set, so each later snapshot pushes it one
    // step further back in history.
    session.setRefMap(mk([['e10', 'button', 'oldest']]));
    session.setRefMap(mk([['e1', 'button', 'set-b']]));
    session.setRefMap(mk([['e1', 'button', 'set-c']]));
    session.setRefMap(mk([['e1', 'button', 'set-d']]));

    // Three sets back — still the last one we keep.
    const remembered = await missingRefError(session, '@e10');
    expect(remembered).toContain('earlier ref set (#2)');
    expect(remembered).toContain('button "oldest"');

    // Four back — forgotten. The message must degrade to the honest version
    // rather than name whatever happens to sit at that number now.
    session.setRefMap(mk([['e1', 'button', 'set-e']]));
    const forgotten = await missingRefError(session, '@e10');
    expect(forgotten).toContain('not found');
    expect(forgotten).not.toContain('earlier ref set');
    expect(forgotten).toContain("Run 'snapshot' to get fresh refs.");
  });

  test('no single match in the current set means no suggestion', async () => {
    // Nothing with that role and name survives — do not point at the link.
    const gone = new TabSession(mockPage());
    gone.setRefMap(mk([['e5', 'button', 'mark complete']]));
    gone.setRefMap(mk([['e1', 'link', 'somewhere else']]));

    const goneMsg = await missingRefError(gone, '@e5');
    expect(goneMsg).toContain('earlier ref set (#2)');
    expect(goneMsg).toContain('button "mark complete"');
    expect(goneMsg).toContain('No single element with that role and name');
    expect(goneMsg).not.toContain('is now @');

    // Two equally good candidates — guessing one would be worse than declining.
    const ambiguous = new TabSession(mockPage());
    ambiguous.setRefMap(mk([['e5', 'button', 'Save']]));
    ambiguous.setRefMap(mk([
      ['e1', 'button', 'Save'],
      ['e2', 'button', 'Save'],
    ]));

    const ambiguousMsg = await missingRefError(ambiguous, '@e5');
    expect(ambiguousMsg).toContain('No single element with that role and name');
    expect(ambiguousMsg).not.toContain('is now @');
    expect(ambiguousMsg).toContain('Current set is #3 with 2 refs.');
  });

  test('a set ended by navigation blames navigation, not renumbering', async () => {
    const session = new TabSession(mockPage());
    // Unnamed element — the label has to render as a bare role, no empty quotes.
    session.setRefMap(mk([['e7', 'button', '']]));
    session.clearRefs();

    const msg = await missingRefError(session, '@e7');
    expect(msg).toContain('earlier ref set (#2)');
    expect(msg).toContain('where it was button.');
    expect(msg).toContain('cleared when the page or frame navigates');
    expect(msg).not.toContain('renumbered by every snapshot');
    // Refs were cleared, not replaced — say there is no current set at all.
    expect(msg).toContain("There is no current ref set — run 'snapshot' first.");
    expect(msg).not.toContain('Current set is #');
  });

  test('clearing an already-empty ref map does not burn a generation', async () => {
    const session = new TabSession(mockPage());
    session.setRefMap(mk([['e1', 'button', 'Submit']]));
    session.clearRefs();

    const afterFirstClear = session.getRefGeneration();
    expect(session.getRefCount()).toBe(0);

    // Every main-frame navigation calls clearRefs(). On a page nobody snapshotted
    // that must be free, or the generation numbers in the error messages count
    // navigations instead of ref sets.
    session.clearRefs();
    session.onMainFrameNavigated();
    session.clearRefs();
    expect(session.getRefGeneration()).toBe(afterFirstClear);

    // And the no-op clears must not have pushed empty sets over the real history.
    const msg = await missingRefError(session, '@e1');
    expect(msg).toContain('earlier ref set (#2)');
    expect(msg).toContain('button "Submit"');
  });
});
