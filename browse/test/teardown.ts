/**
 * Shared teardown helper for tests that launch a real browser.
 *
 * These suites used to end with `setTimeout(() => process.exit(0), 500)`, which
 * killed the whole `bun test` process — every remaining test file was skipped
 * and the run reported exit 0 with no summary.
 *
 * Awaiting `BrowserManager.close()` directly is not a safe replacement: it races
 * its own 5s internal timeout, which is exactly bun's default hook timeout, so a
 * browser that refuses to close fails the hook instead. Bound it below that
 * limit — a stuck browser should be a leaked handle, not a failed suite.
 */

/**
 * Under bun's 5s default hook timeout with enough slack for the rest of the
 * hook (stopping the fixture server) and scheduler jitter on a loaded machine.
 * A healthy browser closes in well under a second; a stuck one yields here
 * instead of failing the hook.
 */
export const TEARDOWN_BUDGET_MS = 3500;

interface Closable {
  close(): Promise<void>;
}

export async function closeBrowserQuietly(
  bm: Closable | undefined | null,
  budgetMs: number = TEARDOWN_BUDGET_MS,
): Promise<void> {
  if (!bm) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      bm.close(),
      new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs); }),
    ]);
  } catch {
    // Best-effort: the run is ending either way.
  } finally {
    if (timer) clearTimeout(timer);
  }
}
