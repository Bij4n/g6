/**
 * Per-tab session state.
 *
 * Extracted from BrowserManager to enable parallel tab execution in /batch.
 * Each TabSession holds the state that is scoped to a single browser tab:
 * page reference, element refs, snapshot baseline, and frame context.
 *
 *   BrowserManager (global)
 *     └── tabSessions: Map<number, TabSession>
 *           ├── TabSession(page1)  ←  refMap, lastSnapshot, frame
 *           ├── TabSession(page2)  ←  refMap, lastSnapshot, frame
 *           └── TabSession(page3)  ←  refMap, lastSnapshot, frame
 *
 * The /command path gets the active session via bm.getActiveSession().
 * The /batch path gets specific sessions via bm.getSession(tabId).
 * Both paths pass TabSession to the same handler functions.
 */

import type { Page, Locator, Frame } from 'playwright';
import { escapeEnvelopeSentinels } from './content-security';

export interface RefEntry {
  locator: Locator;
  role: string;
  name: string;
}

export type SetContentWaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

/**
 * How many superseded ref sets to remember, for diagnosing reused ref numbers.
 * Three covers the common shape (snapshot → act → snapshot → reuse an old number)
 * with room to spare, and each entry is only role+name strings.
 */
const REF_HISTORY_DEPTH = 3;

/**
 * Cap on an archived accessible name. Names come from the page, can be ~900 chars,
 * and the history now survives navigation — so this bounds both the memory a hostile
 * or merely huge page can pin and how much page text an error string can carry.
 */
const MAX_ARCHIVED_NAME = 80;

function truncateName(name: string): string {
  return name.length <= MAX_ARCHIVED_NAME ? name : `${name.slice(0, MAX_ARCHIVED_NAME)}…`;
}

export class TabSession {
  readonly page: Page;

  // ─── Ref Map (snapshot → @e1, @e2, @c1, @c2, ...) ────────
  private refMap: Map<string, RefEntry> = new Map();

  // ─── Ref generations ──────────────────────────────────────
  // Refs are POSITIONAL, not stable element ids: @e40 in one snapshot is a
  // different element — or no element — in the next. Reusing a number across a
  // snapshot is the most common way to act on the wrong thing, and the bare
  // "Ref @e40 not found" it used to produce didn't say why.
  //
  // So every new ref set bumps a generation counter, and we keep the role+name
  // of the last few superseded sets. That turns the error into "@e40 was
  // button 'mark complete'; that element is now @e30".
  private refGeneration = 1;
  private priorRefs: Array<{
    generation: number;
    endedBy: 'snapshot' | 'navigation';
    refs: Map<string, { role: string; name: string }>;
  }> = [];

  // ─── Snapshot Diffing ─────────────────────────────────────
  // NOT cleared on navigation — it's a text baseline for diffing
  private lastSnapshot: string | null = null;

  // ─── Frame context ─────────────────────────────────────────
  private activeFrame: Frame | null = null;

  // ─── Loaded HTML (for load-html replay across context recreation) ─
  //
  // loadedHtml lifecycle:
  //
  //   load-html cmd ──▶ session.setTabContent(html, opts)
  //                          ├─▶ page.setContent(html, opts)
  //                          └─▶ this.loadedHtml = html
  //                              this.loadedHtmlWaitUntil = opts.waitUntil
  //
  //   goto/back/forward/reload ──▶ session.clearLoadedHtml()
  //                                     (BEFORE Playwright call, so timeouts
  //                                      don't leave stale state)
  //
  //   viewport --scale ──▶ recreateContext()
  //                             ├─▶ saveState() captures { url, loadedHtml } per tab
  //                             │        (in-memory only, never to disk)
  //                             └─▶ restoreState():
  //                                    for each tab with loadedHtml:
  //                                       newSession.setTabContent(html, opts)
  //                                    (NOT page.setContent — must rehydrate
  //                                     TabSession.loadedHtml too)
  private loadedHtml: string | null = null;
  private loadedHtmlWaitUntil: SetContentWaitUntil | undefined;

  constructor(page: Page) {
    this.page = page;
  }

  // ─── Page Access ───────────────────────────────────────────
  getPage(): Page {
    return this.page;
  }

  // ─── Ref Map ──────────────────────────────────────────────
  setRefMap(refs: Map<string, RefEntry>) {
    this.startNewRefGeneration('snapshot');
    this.refMap = refs;
  }

  clearRefs() {
    if (this.refMap.size === 0) return;
    this.startNewRefGeneration('navigation');
    this.refMap = new Map();
  }

  /** Current ref-set number. Bumps on every snapshot and every ref-clearing navigation. */
  getRefGeneration(): number {
    return this.refGeneration;
  }

  /** Archive the outgoing ref set's role+name, then open a new generation. */
  private startNewRefGeneration(endedBy: 'snapshot' | 'navigation'): void {
    if (this.refMap.size > 0) {
      const archived = new Map<string, { role: string; name: string }>();
      for (const [ref, entry] of this.refMap) {
        // Truncate on the way in. Accessible names are page-controlled and can run to
        // ~900 chars; the archive only needs enough to identify the element, and this
        // history now outlives the page it came from.
        archived.set(ref, { role: entry.role, name: truncateName(entry.name) });
      }
      this.priorRefs.unshift({ generation: this.refGeneration, endedBy, refs: archived });
      if (this.priorRefs.length > REF_HISTORY_DEPTH) {
        this.priorRefs.length = REF_HISTORY_DEPTH;
      }
    }
    this.refGeneration++;
  }

  /**
   * Explain a ref that isn't in the current set.
   *
   * If we remember it from a superseded set, say what it was and — when role+name
   * identifies exactly one element in BOTH the prior and the current set — which ref
   * it became.
   *
   * Both sides of that check matter. Role+name is not identity: if the prior set held
   * two "Delete" buttons, the ref never had a role+name identity to begin with, and
   * naming a survivor would point the caller at the wrong row of a destructive action.
   * The suggestion is hedged for the same reason — it is a lead, not a fact.
   *
   * Every branch keeps the words "not found" so the phrasing pinned by
   * snapshot.test.ts still matches.
   */
  private explainMissingRef(selector: string, ref: string): string {
    const available = this.refMap.size > 0
      ? `Current set is #${this.refGeneration} with ${this.refMap.size} refs.`
      : `There is no current ref set — run 'snapshot' first.`;

    const prior = this.priorRefs.find(g => g.refs.has(ref));
    if (!prior) {
      return `Ref ${selector} not found. ${available} Run 'snapshot' to get fresh refs.`;
    }

    const was = prior.refs.get(ref)!;
    // Page-controlled text crosses into an error string that is NOT wrapped in the
    // untrusted-content envelope the snapshot path uses, so neutralize the sentinels.
    const safeName = escapeEnvelopeSentinels(was.name);
    const label = was.name ? `${was.role} "${safeName}"` : was.role;

    const sameRoleName = (e: { role: string; name: string }) =>
      e.role === was.role && e.name === was.name;
    const priorMatches = Array.from(prior.refs.values()).filter(sameRoleName).length;
    const matches = Array.from(this.refMap.entries())
      .filter(([, e]) => sameRoleName(e))
      .map(([r]) => r);

    const nowIs = priorMatches === 1 && matches.length === 1
      ? `One element in the current set has the same role and name — @${matches[0]} — ` +
        `but role and name are not identity, so verify before acting on it.`
      : `Role and name do not identify a single replacement in the current set.`;

    const why = prior.endedBy === 'navigation'
      ? `Refs are cleared when the page or frame navigates — take a fresh snapshot.`
      : `Refs are renumbered by every snapshot, so re-read them from the newest ` +
        `snapshot output instead of reusing numbers.`;

    return (
      `Ref ${selector} not found — it belongs to an earlier ref set (#${prior.generation}), ` +
      `where it was ${label}. ${nowIs} ${why} ${available}`
    );
  }

  /**
   * Resolve a selector that may be a @ref (e.g., "@e3", "@c1") or a CSS selector.
   * Returns { locator } for refs or { selector } for CSS selectors.
   */
  async resolveRef(selector: string): Promise<{ locator: Locator } | { selector: string }> {
    if (selector.startsWith('@e') || selector.startsWith('@c')) {
      const ref = selector.slice(1); // "e3" or "c1"
      const entry = this.refMap.get(ref);
      if (!entry) {
        throw new Error(this.explainMissingRef(selector, ref));
      }
      const count = await entry.locator.count();
      if (count === 0) {
        throw new Error(
          `Ref ${selector} (${entry.role} "${entry.name}") is stale — element no longer exists. ` +
          `Run 'snapshot' for fresh refs.`
        );
      }
      return { locator: entry.locator };
    }
    return { selector };
  }

  /** Get the ARIA role for a ref selector, or null for CSS selectors / unknown refs. */
  getRefRole(selector: string): string | null {
    if (selector.startsWith('@e') || selector.startsWith('@c')) {
      const entry = this.refMap.get(selector.slice(1));
      return entry?.role ?? null;
    }
    return null;
  }

  getRefCount(): number {
    return this.refMap.size;
  }

  /** Get all ref entries for the /refs endpoint. */
  getRefEntries(): Array<{ ref: string; role: string; name: string }> {
    return Array.from(this.refMap.entries()).map(([ref, entry]) => ({
      ref, role: entry.role, name: entry.name,
    }));
  }

  // ─── Snapshot Diffing ─────────────────────────────────────
  setLastSnapshot(text: string | null) {
    this.lastSnapshot = text;
  }

  getLastSnapshot(): string | null {
    return this.lastSnapshot;
  }

  // ─── Frame context ─────────────────────────────────────────
  setFrame(frame: Frame | null): void {
    this.activeFrame = frame;
  }

  getFrame(): Frame | null {
    return this.activeFrame;
  }

  /**
   * Returns the active frame if set, otherwise the current page.
   * Use this for operations that work on both Page and Frame (locator, evaluate, etc.).
   */
  getActiveFrameOrPage(): Page | Frame {
    // Auto-recover from detached frames (iframe removed/navigated). Clear
    // refs alongside the activeFrame — same staleness condition as
    // onMainFrameNavigated() below: refs were captured against a frame
    // that no longer exists. Without this, refMap entries linger against
    // a dead frame after silently falling back to the main page; the
    // next snapshot's role+name keys collide with stale entries and the
    // resolver picks one at random.
    if (this.activeFrame?.isDetached()) {
      this.activeFrame = null;
      this.clearRefs();
    }
    return this.activeFrame ?? this.page;
  }

  /**
   * Called on main-frame navigation to clear stale refs, frame context, and any
   * load-html replay metadata. Runs for every main-frame nav — explicit goto/back/
   * forward/reload AND browser-emitted navigations (link clicks, form submits, JS
   * redirects, OAuth). Without clearing loadedHtml here, a user who load-html'd and
   * then clicked a link would silently revert to the original HTML on the next
   * viewport --scale.
   */
  onMainFrameNavigated(): void {
    this.clearRefs();
    this.activeFrame = null;
    this.loadedHtml = null;
    this.loadedHtmlWaitUntil = undefined;
  }

  // ─── Loaded HTML (load-html replay) ───────────────────────

  /**
   * Load HTML content into the tab AND store it for replay after context recreation
   * (e.g. viewport --scale). Unlike page.setContent() alone, this rehydrates
   * TabSession.loadedHtml so the next saveState()/restoreState() round-trip preserves
   * the content.
   */
  async setTabContent(html: string, opts: { waitUntil?: SetContentWaitUntil } = {}): Promise<void> {
    const waitUntil = opts.waitUntil ?? 'domcontentloaded';
    // Call setContent FIRST — only record the replay metadata after a successful load.
    // If setContent throws (timeout, crash), we must not leave phantom HTML that a
    // later viewport --scale would replay.
    await this.page.setContent(html, { waitUntil, timeout: 15000 });
    this.loadedHtml = html;
    this.loadedHtmlWaitUntil = waitUntil;
  }

  /** Get stored HTML + waitUntil for state replay. Returns null if no load-html happened. */
  getLoadedHtml(): { html: string; waitUntil?: SetContentWaitUntil } | null {
    if (this.loadedHtml === null) return null;
    return { html: this.loadedHtml, waitUntil: this.loadedHtmlWaitUntil };
  }

  /** Clear stored HTML. Called BEFORE goto/back/forward/reload navigation. */
  clearLoadedHtml(): void {
    this.loadedHtml = null;
    this.loadedHtmlWaitUntil = undefined;
  }
}
