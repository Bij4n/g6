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

/** The test file that called us, for attributing a leak to a suite. */
function callerSuite(): string {
  const stack = new Error().stack ?? '';
  const hit = stack.split('\n').find(l => l.includes('.test.ts'));
  return hit?.match(/([\w.-]+\.test\.ts)/)?.[1] ?? 'unknown suite';
}

export async function closeBrowserQuietly(
  bm: Closable | undefined | null,
  budgetMs: number = TEARDOWN_BUDGET_MS,
): Promise<void> {
  if (!bm) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abandoned = false;
  try {
    await Promise.race([
      bm.close(),
      new Promise<void>(resolve => {
        timer = setTimeout(() => { abandoned = true; resolve(); }, budgetMs);
      }),
    ]);
  } catch (err) {
    // Best-effort: the run is ending either way. But say so — a close that
    // throws leaves the same live browser behind as one that hangs.
    console.error(`[teardown] ${callerSuite()}: browser close threw:`, err);
  } finally {
    if (timer) clearTimeout(timer);
  }

  // The whole point of the budget is to yield rather than fail the hook, but
  // yielding silently means a browser survives into every later file in this
  // process and nobody can attribute the contention it causes.
  if (abandoned) {
    console.error(
      `[teardown] LEAK: ${callerSuite()} exceeded ${budgetMs}ms closing its browser; handle abandoned`,
    );
  }
}
