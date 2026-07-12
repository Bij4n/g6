---
name: degoogle
preamble-tier: 2
version: 1.0.0
description: |
  Finds every Google dependency in an app and replaces it with a self-hosted or
  privacy-respecting equivalent. Covers Fonts, Analytics, Tag Manager, reCAPTCHA,
  Maps, OAuth/Sign-in, Firebase, hosted libraries, and reCAPTCHA/AdSense. Reports
  each hit with a concrete swap (Bunny Fonts, Plausible, hCaptcha, self-hosted
  tiles, etc.) and can apply the swaps with confirmation. Enforces the g6 "no
  Google services" default.
  Use when: "degoogle", "remove google", "replace google fonts", "drop analytics",
  "no google", "swap recaptcha". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Edit
  - Write
  - Agent
  - WebSearch
  - AskUserQuestion
triggers:
  - degoogle
  - remove google
  - replace google fonts
  - drop google analytics
  - no google services
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

This enforces the g6 default: no Google services. Read CLAUDE.md — if it already
documents "No Google services," this is a verification pass to catch regressions.

## Step 1: Report-only or apply?

Ask the user: **report** (find and recommend, no edits) or **apply** (make the
swaps with confirmation before each edit)? Default to report on the first run so
they see the full surface before anything changes.

## Step 2: Scan for every Google surface

```bash
# Fonts
grep -rniE "fonts\.googleapis\.com|fonts\.gstatic\.com|family=.*google" \
  --include="*.html" --include="*.erb" --include="*.css" --include="*.scss" \
  --include="*.jsx" --include="*.tsx" --include="*.js" --include="*.ts" . 2>/dev/null | grep -v ".git/" | head -30

# Analytics + Tag Manager
grep -rniE "google-analytics\.com|googletagmanager\.com|gtag\(|ga\(|_gaq|GA_MEASUREMENT|G-[A-Z0-9]{8,}|UA-[0-9]" \
  --include="*.html" --include="*.erb" --include="*.jsx" --include="*.tsx" --include="*.js" --include="*.ts" . 2>/dev/null | grep -v ".git/" | head -30

# reCAPTCHA
grep -rniE "recaptcha|google\.com/recaptcha|grecaptcha" \
  --include="*.html" --include="*.erb" --include="*.jsx" --include="*.tsx" --include="*.js" --include="*.ts" --include="*.rb" --include="*.py" . 2>/dev/null | grep -v ".git/" | head -20

# Maps
grep -rniE "maps\.googleapis\.com|maps\.google\.com|google\.maps|GoogleMap" \
  --include="*.html" --include="*.jsx" --include="*.tsx" --include="*.js" --include="*.ts" . 2>/dev/null | grep -v ".git/" | head -20

# OAuth / Sign-in with Google
grep -rniE "accounts\.google\.com|oauth2/google|omniauth-google|google-auth|GoogleProvider|apis\.google\.com" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.tsx" . 2>/dev/null | grep -v ".git/" | head -20

# Firebase (Google-owned)
grep -rniE "firebase|firebaseio\.com|firebaseapp\.com" \
  --include="*.ts" --include="*.js" --include="*.json" --include="*.env*" . 2>/dev/null | grep -v ".git/\|lock" | head -20

# Hosted libraries + AdSense + other Google CDNs
grep -rniE "ajax\.googleapis\.com|googleusercontent|pagead2|adsbygoogle|doubleclick|gstatic\.com" \
  --include="*.html" --include="*.erb" --include="*.jsx" --include="*.tsx" . 2>/dev/null | grep -v ".git/" | head -20
```

## Step 3: Map each hit to a swap

For every finding, propose a concrete replacement. Default recommendations:

| Google service | Replace with | Notes |
|---|---|---|
| Google Fonts | **Bunny Fonts** (`fonts.bunny.net`, drop-in, GDPR-safe) or self-host with `@fontsource/*` | Self-host is the strongest option — zero third-party request. |
| Analytics / GA4 | **Plausible**, **Umami**, or **PostHog** (self-hosted) | Cookieless, no consent banner needed. |
| Tag Manager | Remove entirely; inline the few scripts you actually need | GTM is a remote-code-injection surface. |
| reCAPTCHA | **hCaptcha**, **Cloudflare Turnstile**, or **Altcha** (self-hostable, no external call) | Altcha for the fully-independent path. |
| Maps | **MapLibre GL** + **OpenStreetMap** / self-hosted tiles, or **Protomaps** | No API key, no per-load billing. |
| Sign-in with Google | Keep only if users demand it; otherwise passkeys / email magic-link / self-hosted OIDC (Keycloak) | If kept, isolate it behind your own auth layer. |
| Firebase | Supabase (self-hostable) or Postgres + your own API | Depends on what Firebase feature is used. |
| Hosted JS libraries | Self-host / bundle the library | Removes the CDN tracking + SPOF. |
| AdSense / DoubleClick | Remove, or self-host ads via a privacy-respecting network | Heavy tracking surface. |

Adjust per project. If the stack has a documented preference in CLAUDE.md, honor it.

## Step 4: Apply (only if the user chose apply mode)

For each swap, make the smallest correct edit and confirm before moving on:

- **Fonts** → rewrite the `<link>`/`@import` to Bunny Fonts, or install
  `@fontsource/<family>` and import it. Show the exact before/after.
- **Analytics/GTM** → remove the snippet; if replacing, scaffold the new tag.
- **reCAPTCHA** → swap the widget + server-side verification endpoint.
- **Maps** → replace the embed/component with the MapLibre equivalent.

After edits, re-run the Step 2 scan to prove zero Google hits remain. Never batch
all edits silently — one confirmed change at a time.

## Step 5: Persist the policy

If the project doesn't already document it, offer to add a **"No Google services"**
line to CLAUDE.md so future work (and `/privacy-audit`) enforces it automatically.

## Step 6: Report

**Google Dependencies: N found, M swapped**

| Surface | File:line | Status | Swap |
|---|---|---|---|
| Fonts / Analytics / … | path:line | FOUND / SWAPPED / KEPT (justified) | recommendation |

For anything **KEPT**, record the justification (e.g. "Sign-in with Google
required by an existing user base") so it's a documented decision, not an oversight.
Pair with `/self-host-audit` for the full portability picture.
