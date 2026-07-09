/**
 * chromium-rebrand unit tests — the plist transform is the riskiest part of
 * the Dock rename (a bad rewrite bricks Chromium launches), so it's tested
 * as a pure function against a realistic Chrome-for-Testing plist fixture.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  transformPlistDisplayNames,
  writePlistAtomic,
  findAppRoot,
  BRAND_NAME,
} from '../src/chromium-rebrand';

const FIXTURE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Google Chrome for Testing</string>
  <key>CFBundleExecutable</key>
  <string>Google Chrome for Testing</string>
  <key>CFBundleName</key>
  <string>Google Chrome for Testing</string>
  <key>CFBundleGetInfoString</key>
  <string>Google Chrome for Testing 145.0, Copyright 2026 Google LLC.</string>
  <key>CFBundleIconFile</key>
  <string>app.icns</string>
  <key>CFBundleVersion</key>
  <string>145.0.6422.0</string>
  <key>CFBundleShortVersionString</key>
  <string>145.0.6422.0</string>
</dict>
</plist>
`;

describe('transformPlistDisplayNames', () => {
  test('rebrands ONLY the display-name keys', () => {
    const { content, changed } = transformPlistDisplayNames(FIXTURE_PLIST);
    expect(changed).toBe(true);
    expect(content).toContain(`<key>CFBundleName</key>\n  <string>${BRAND_NAME}</string>`);
    expect(content).toContain(`<key>CFBundleDisplayName</key>\n  <string>${BRAND_NAME}</string>`);
    // CFBundleExecutable is a real filesystem path component — rewriting it
    // breaks the bundle. The old whole-file replace corrupted exactly this.
    expect(content).toContain('<key>CFBundleExecutable</key>\n  <string>Google Chrome for Testing</string>');
    // Prose values that merely contain the app name stay untouched.
    expect(content).toContain('Google Chrome for Testing 145.0, Copyright 2026 Google LLC.');
  });

  test('migrates a plist previously in-place patched to GStack Browser', () => {
    const legacy = FIXTURE_PLIST.replace(
      /(<key>CFBundle(?:Display)?Name<\/key>\s*<string>)[^<]*(<\/string>)/g,
      '$1GStack Browser$2',
    );
    const { content, changed } = transformPlistDisplayNames(legacy);
    expect(changed).toBe(true);
    expect(content).not.toContain('GStack Browser');
    expect(content).toContain(BRAND_NAME);
  });

  test('is idempotent — already-branded plist reports no change', () => {
    const first = transformPlistDisplayNames(FIXTURE_PLIST);
    const second = transformPlistDisplayNames(first.content);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  test('leaves unknown app names alone (never rebrand arbitrary apps)', () => {
    const foreign = FIXTURE_PLIST.replace(/Google Chrome for Testing/g, 'SomeOtherBrowser');
    const { changed, content } = transformPlistDisplayNames(foreign);
    expect(changed).toBe(false);
    expect(content).toBe(foreign);
  });
});

describe('writePlistAtomic', () => {
  test('writes via temp + rename, leaving no temp file behind', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plist-atomic-'));
    const target = path.join(dir, 'Info.plist');
    fs.writeFileSync(target, 'old');
    writePlistAtomic(target, 'new-content');
    expect(fs.readFileSync(target, 'utf-8')).toBe('new-content');
    expect(fs.readdirSync(dir)).toEqual(['Info.plist']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('findAppRoot', () => {
  test('walks up from the binary to the .app root', () => {
    expect(
      findAppRoot('/cache/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    ).toBe('/cache/chrome-mac-arm64/Google Chrome for Testing.app');
  });

  test('returns null when no .app ancestor exists (Linux/Windows layout)', () => {
    expect(findAppRoot('/home/user/.cache/ms-playwright/chromium-1208/chrome-linux/chrome')).toBeNull();
  });
});
