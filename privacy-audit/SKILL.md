---
name: privacy-audit
preamble-tier: 2
version: 1.0.0
description: |
  Privacy-first audit for software that belongs to the people using it.
  Checks third-party phone-homes, PII exposure, data minimization, encryption,
  self-hosting readiness, GDPR/CCPA surface area, and cookie/tracking hygiene.
  Runs in two modes: quick (critical issues only) and full (every surface).
  Use when: "privacy audit", "privacy review", "check for tracking",
  "data audit", "gdpr check", "does this phone home". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - Agent
  - WebSearch
  - AskUserQuestion
triggers:
  - privacy audit
  - check for tracking
  - gdpr review
  - does this phone home
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/gstack/bin/gstack-update-check 2>/dev/null || .claude/skills/gstack/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

Read CLAUDE.md for stack-specific context. Note any "No Google services" or similar restrictions already documented — don't re-audit what's already known and compliant.

## Step 1: Determine scope

Ask (or infer from context): quick scan (critical only) or full audit?

- **Quick**: phone-homes, live key exposure, unencrypted PII storage
- **Full**: all of the above plus GDPR/CCPA surface, data minimization, self-hosting path, tracking hygiene

## Step 2: Third-party phone-home scan

Search for external service calls that may exfiltrate user data or behavior without explicit consent:

```bash
# Google services (Fonts, Analytics, reCAPTCHA, Maps, Tag Manager)
grep -rn "google-analytics\|googletagmanager\|fonts\.googleapis\|recaptcha\.net\|maps\.googleapis\|gtag\b\|ga\b\|_gaq\b" \
  --include="*.html" --include="*.erb" --include="*.jsx" --include="*.tsx" \
  --include="*.js" --include="*.ts" --include="*.py" --include="*.rb" . 2>/dev/null | grep -v ".git/" | head -40

# Third-party analytics / tracking pixels
grep -rn "mixpanel\|segment\.com\|amplitude\|hotjar\|fullstory\|heap\.io\|intercom\|crisp\.chat\|zendesk\|hubspot\|klaviyo\|sentry\.io" \
  --include="*.html" --include="*.erb" --include="*.jsx" --include="*.tsx" \
  --include="*.js" --include="*.ts" --include="*.py" --include="*.rb" . 2>/dev/null | grep -v ".git/" | head -40

# CDN-hosted scripts (loads remote code into user's browser)
grep -rn 'src="https://\|src='"'"'https://' \
  --include="*.html" --include="*.erb" . 2>/dev/null | grep -v ".git/" | head -20
```

Flag every hit. Categorize: **required** (payment processor SDK), **optional but disclosed**, or **silent tracking**.

## Step 3: PII exposure audit

```bash
# PII in logs
grep -rn "logger\.\|Rails\.logger\|console\.log\|print(" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -i "email\|password\|phone\|ssn\|dob\|address\|credit_card\|token\|secret" | \
  grep -v ".git/" | head -30

# PII in error responses (stack traces, validation messages)
grep -rn "rescue\|except\|catch\|raise\|throw" \
  --include="*.rb" --include="*.py" . 2>/dev/null | \
  grep -i "email\|password\|ssn\|token" | grep -v ".git/" | head -20

# PII in URL params (gets logged in access logs)
grep -rn "params\[:email\]\|request\.args\[.email.\]\|GET.*email=\|redirect.*email=" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | grep -v ".git/" | head -20
```

## Step 4: Data minimization check

Read the data models / database schema:

```bash
# Rails
find . -path "*/db/schema.rb" -o -name "*_create_*.rb" 2>/dev/null | head -10

# FastAPI / SQLAlchemy
find . -name "models*.py" -o -name "schema*.py" 2>/dev/null | head -10

# Migrations
find . -path "*/migrations/*.py" -o -path "*/migrate/*.rb" 2>/dev/null | head -20
```

For each model that stores user data, ask: **Is every field strictly necessary?** Flag fields that are collected but likely unused (e.g., `date_of_birth` when only age verification is needed, full `address` when only city is needed).

## Step 5: Encryption audit

```bash
# Secrets / keys in source
grep -rn "sk_live_\|pk_live_\|AKIA\|secret_key\s*=\s*['\"]" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" \
  --include="*.env" --include="*.yml" --include="*.yaml" . 2>/dev/null | \
  grep -v ".git/\|\.example\|test\|spec\|_test\." | head -20

# Database passwords in non-credential files
grep -rn "password\s*=\s*['\"][^${\|password_digest\|bcrypt\|argon" \
  --include="*.rb" --include="*.py" --include="*.yml" . 2>/dev/null | \
  grep -v ".git/\|test\|spec\|example" | head -20

# HTTP (not HTTPS) external calls
grep -rn '"http://\|'"'"'http://' \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -v ".git/\|localhost\|127\.0\.0\|test\|#" | head -20
```

Also check: Are sensitive fields encrypted at rest? (Look for `encrypts :field`, `EncryptedField`, `Fernet`, etc.)

## Step 6: Self-hosting readiness (g6 brand check)

For projects marketed as self-hostable or privacy-respecting:

```bash
# Hardcoded external service dependencies that block self-hosting
grep -rn "\.fly\.io\|\.render\.com\|\.vercel\.app\|\.railway\.app\|\.supabase\.co" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.env*" . 2>/dev/null | \
  grep -v ".git/\|test\|example" | head -20

# Check for Docker/compose self-hosting path
ls docker-compose*.yml docker-compose*.yaml Dockerfile* 2>/dev/null || echo "No Docker self-hosting config found"

# Check README for self-hosting instructions
grep -n "self.host\|docker\|compose\|localhost" README.md 2>/dev/null | head -10
```

## Step 7: Cookie and tracking hygiene (web projects only)

If the project has a web frontend:

```bash
# Cookie consent / tracking disclosure
grep -rn "cookie\|consent\|gdpr\|ccpa" \
  --include="*.html" --include="*.erb" --include="*.jsx" --include="*.tsx" . 2>/dev/null | \
  grep -iv "test\|spec\|.git/" | head -20

# localStorage / sessionStorage usage
grep -rn "localStorage\|sessionStorage" \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" . 2>/dev/null | \
  grep -v ".git/\|test" | head -20
```

## Step 8: Compile findings and score

Produce a report with:

**Privacy Score: X/10** (deduct for each category with issues)

| Category | Status | Issues |
|---|---|---|
| Third-party phone-homes | PASS / WARN / FAIL | list |
| PII in logs/responses | PASS / WARN / FAIL | list |
| Data minimization | PASS / WARN / FAIL | list |
| Encryption at rest/transit | PASS / WARN / FAIL | list |
| Self-hosting readiness | PASS / WARN / FAIL | list |
| Cookie/tracking hygiene | PASS / WARN / FAIL | list |

**FAIL items** require fixes before next deploy. **WARN items** require a decision (document why it's acceptable or fix it).

For each FAIL: produce the specific file:line and a one-line fix.

Scoring guide: 10 = zero issues. Deduct 2 per FAIL category, 1 per WARN category.
