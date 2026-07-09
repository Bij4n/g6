/**
 * Branding regression scan — the test that would have caught the original
 * "browser pops up saying GStack" episode. Greps every user-visible surface
 * of the browse binary + extension for upstream branding. Source-level scan:
 * dist/ binaries are stale by policy, so source is the honest surface to gate.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..', '..');

/** Surfaces a user actually sees: rendered pages, UI chrome, console output. */
const USER_VISIBLE_SURFACES = [
  'browse/src/welcome.html',
  'browse/src/cookie-picker-ui.ts',
  'extension/manifest.json',
  'extension/sidepanel.html',
];

/** Branding that must never appear on a user-visible surface. */
const FORBIDDEN = [/GStack Browser/i, /GStackBrowser/, /ycombinator\.com/i, /garrytan/i];

describe('branding scan', () => {
  for (const rel of USER_VISIBLE_SURFACES) {
    test(`${rel} has no upstream branding`, () => {
      const content = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      for (const pattern of FORBIDDEN) {
        const match = content.match(pattern);
        expect(match ? `${rel} contains "${match[0]}"` : null).toBeNull();
      }
    });
  }

  test('server fallback page and CLI messages say g6 Browser', () => {
    const server = fs.readFileSync(path.join(ROOT, 'browse/src/server.ts'), 'utf-8');
    expect(server).toContain('g6 Browser ready');
    expect(server).not.toContain('<title>GStack Browser</title>');
    const cli = fs.readFileSync(path.join(ROOT, 'browse/src/cli.ts'), 'utf-8');
    expect(cli).not.toContain('Opening GStack Browser');
  });

  test('welcome page credits capitalismkilledsoftware.com', () => {
    const html = fs.readFileSync(path.join(ROOT, 'browse/src/welcome.html'), 'utf-8');
    expect(html).toContain('capitalismkilledsoftware.com');
  });
});
