/**
 * Chromium rebrand — macOS Dock/menu-bar naming without mutating the
 * shared Playwright cache.
 *
 * The old approach rewrote Info.plist inside Playwright's machine-global
 * Chromium .app. That had three failure modes:
 *   1. It invalidated the .app's code signature (hardened builds die at
 *      spawn with SIGTRAP and nothing self-repairs).
 *   2. The whole-file string replace could corrupt values that merely
 *      contain the app name (paths, handler identifiers).
 *   3. Every other Playwright consumer on the machine inherited the
 *      mutation without consent.
 *
 * New approach: copy the .app once into ~/.gstack/g6-browser/, patch ONLY
 * the display-name keys in the copy, ad-hoc re-sign it, and launch from
 * the copy. The Playwright cache stays pristine. Any failure returns null
 * and the caller launches the original binary — worst case the Dock says
 * "Google Chrome for Testing", never a broken browser.
 */

import * as fs from 'fs';
import * as path from 'path';

export const BRAND_NAME = 'g6 Browser';

/** Display-name keys we are allowed to rebrand. Nothing else. */
const DISPLAY_NAME_KEYS = ['CFBundleName', 'CFBundleDisplayName'];

/** Names we recognize as "the thing to rebrand" (incl. prior in-place patches). */
const REBRANDABLE_NAMES = ['Google Chrome for Testing', 'Chromium', 'GStack Browser'];

/**
 * Pure transform: set the <string> value of CFBundleName / CFBundleDisplayName
 * to the brand, only when the current value is a known Chromium/legacy name.
 * All other plist content — including other values that happen to contain
 * "Google Chrome for Testing" — is untouched.
 */
export function transformPlistDisplayNames(
  plistContent: string,
  brand: string = BRAND_NAME,
): { content: string; changed: boolean } {
  let changed = false;
  let out = plistContent;
  for (const key of DISPLAY_NAME_KEYS) {
    const re = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`, 'g');
    out = out.replace(re, (whole, open, value, close) => {
      if (value === brand) return whole;
      if (!REBRANDABLE_NAMES.some((n) => value.includes(n))) return whole;
      changed = true;
      return `${open}${brand}${close}`;
    });
  }
  return { content: out, changed };
}

/**
 * Atomic in-place write: temp file + rename so a crash or a concurrent
 * writer can never leave a torn plist.
 */
export function writePlistAtomic(plistPath: string, content: string): void {
  const tmp = `${plistPath}.g6-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, plistPath);
}

/** Walk up from a binary path to its containing .app root, or null. */
export function findAppRoot(binaryPath: string): string | null {
  let dir = binaryPath;
  while (dir !== path.dirname(dir)) {
    if (dir.endsWith('.app')) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Prepare a branded copy of the Chromium .app under ~/.gstack/g6-browser/
 * and return the executable path inside the copy. Returns null on any
 * failure or on non-macOS — callers fall back to the original binary.
 *
 * The copy is keyed by the source app's CFBundleVersion so a Playwright
 * Chromium upgrade produces a fresh copy instead of a stale one.
 */
export function prepareBrandedChromium(
  sourceBinary: string,
  opts: { iconSource?: string | null } = {},
): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const appRoot = findAppRoot(sourceBinary);
    if (!appRoot) return null;
    const srcPlist = path.join(appRoot, 'Contents', 'Info.plist');
    if (!fs.existsSync(srcPlist)) return null;
    const srcPlistContent = fs.readFileSync(srcPlist, 'utf-8');
    const versionMatch = srcPlistContent.match(
      /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/,
    );
    const versionKey = (versionMatch ? versionMatch[1] : 'unknown').replace(/[^\w.]/g, '_');

    const destBase = path.join(process.env.HOME || '/tmp', '.gstack', 'g6-browser', versionKey);
    const destApp = path.join(destBase, `${BRAND_NAME}.app`);
    const relBinary = path.relative(appRoot, sourceBinary);
    const destBinary = path.join(destApp, relBinary);

    // Cached copy from a previous launch — reuse it.
    if (fs.existsSync(destBinary)) return destBinary;

    fs.mkdirSync(destBase, { recursive: true });
    // Copy into a staging dir, finish every mutation, then rename into place.
    // A crash mid-copy leaves only an orphaned staging dir, never a half
    // .app at the launch path.
    const staging = path.join(destBase, `.staging-${process.pid}`);
    fs.rmSync(staging, { recursive: true, force: true });
    // cp -c uses APFS clonefile (instant, no extra disk) and falls back below.
    let cp = Bun.spawnSync(['cp', '-Rc', appRoot, staging], { stdout: 'ignore', stderr: 'pipe' });
    if (cp.exitCode !== 0) {
      cp = Bun.spawnSync(['cp', '-R', appRoot, staging], { stdout: 'ignore', stderr: 'pipe' });
      if (cp.exitCode !== 0) throw new Error(`cp failed: ${cp.stderr.toString().slice(0, 200)}`);
    }

    const stagedPlist = path.join(staging, 'Contents', 'Info.plist');
    const { content, changed } = transformPlistDisplayNames(fs.readFileSync(stagedPlist, 'utf-8'));
    if (changed) writePlistAtomic(stagedPlist, content);

    // Optional Dock icon swap — inside the copy only.
    if (opts.iconSource && fs.existsSync(opts.iconSource)) {
      const iconMatch = content.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/);
      let origIcon = iconMatch ? iconMatch[1] : 'app';
      if (!origIcon.endsWith('.icns')) origIcon += '.icns';
      try {
        fs.copyFileSync(opts.iconSource, path.join(staging, 'Contents', 'Resources', origIcon));
      } catch {
        // icon swap is cosmetic — never fail the rebrand for it
      }
    }

    // Ad-hoc re-sign: mutating Info.plist broke the seal; without this,
    // hardened-runtime builds are killed at spawn.
    const sign = Bun.spawnSync(['codesign', '--force', '--deep', '--sign', '-', staging], {
      stdout: 'ignore',
      stderr: 'pipe',
    });
    if (sign.exitCode !== 0) {
      throw new Error(`codesign failed: ${sign.stderr.toString().slice(0, 200)}`);
    }

    fs.rmSync(destApp, { recursive: true, force: true });
    fs.renameSync(staging, destApp);
    return fs.existsSync(destBinary) ? destBinary : null;
  } catch (err: any) {
    console.warn(`[browse] Chromium rebrand skipped (${err?.message || err}) — launching unbranded.`);
    return null;
  }
}
