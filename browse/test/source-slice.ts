/**
 * Loud source-region extraction for tests that assert on implementation text.
 *
 * These tests only work while the markers they anchor on still exist. The
 * pattern they replace — `src.slice(src.indexOf(marker), ...)` — returns -1 for
 * a marker that moved, so the slice yields '' and the block keeps asserting
 * against nothing: every toContain() fails loudly, but every not.toContain()
 * passes vacuously. 59% of the anchors in sidebar-ux.test.ts were dead by the
 * time anyone looked, and a refactor could turn assertions green by deleting
 * the thing they guarded.
 *
 * Every helper here throws, naming the marker, so a refactor breaks the test
 * with a usable message instead of quietly satisfying it.
 */

export function sliceBetween(
  source: string,
  startMarker: string,
  endMarker: string,
  // Skip this many characters before hunting for the end marker, for blocks
  // whose own header comment would otherwise match it.
  endSearchOffset = 0,
): string {
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`Marker not found: ${startMarker}`);
  const from = startIdx + Math.max(startMarker.length, endSearchOffset);
  const endIdx = source.indexOf(endMarker, from);
  if (endIdx === -1) throw new Error(`End marker not found: ${endMarker}`);
  return source.slice(startIdx, endIdx);
}

/** Same, but keeps the end marker — for brace-terminated blocks. */
export function sliceThrough(source: string, startMarker: string, endMarker: string): string {
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`Marker not found: ${startMarker}`);
  const endIdx = source.indexOf(endMarker, startIdx + startMarker.length);
  if (endIdx === -1) throw new Error(`End marker not found: ${endMarker}`);
  return source.slice(startIdx, endIdx + endMarker.length);
}

/**
 * A fixed-width window after a marker. Still a blunt instrument, but it throws
 * when the marker is gone instead of returning '' and asserting into the void.
 */
export function sliceFrom(source: string, startMarker: string, length: number): string {
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`Marker not found: ${startMarker}`);
  return source.slice(startIdx, startIdx + length);
}
