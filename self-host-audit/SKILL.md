---
name: self-host-audit
preamble-tier: 2
version: 1.0.0
description: |
  Scores how portable an app is off managed SaaS and produces a concrete
  migration plan toward self-hosting. Maps every hosted dependency (DB, auth,
  storage, queue, email, analytics), flags the ones that hard-block a self-host,
  checks for a Docker/compose path, finds hardcoded provider URLs and
  vendor-locked APIs, and rates data portability (can a user export and leave?).
  Runs quick (blockers only) or full (every dependency + a phased exit plan).
  Use when: "self-host audit", "can I self-host this", "how locked in am I",
  "portability check", "get off vercel/supabase", "exit plan". (g6)
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
  - self-host audit
  - can i self-host this
  - portability check
  - how locked in am i
  - exit plan
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

The goal isn't "self-host everything today." It's to know exactly how locked in
you are, which dependencies would fight you, and what a realistic exit looks like.
Read CLAUDE.md for the documented stack — that's the starting inventory.

## Step 1: Scope

Ask (or infer): quick (hard blockers only) or full (full inventory + phased plan)?

- **Quick**: proprietary services with no open equivalent, vendor-locked APIs,
  data with no export path
- **Full**: every hosted dependency scored for portability, Docker readiness, and
  a phased migration plan

## Step 2: Inventory the hosted dependencies

Every external service is a thing you don't control. List them all first.

```bash
# Managed platform hosts + provider SDKs in code and env
grep -rniE "vercel|render\.com|railway|fly\.io|heroku|netlify|supabase|firebase|planetscale|neon\.tech|upstash|mongodb\.net|rds\.amazonaws|dynamodb|cognito|auth0|clerk|okta|s3\.amazonaws|cloudflare|cloudinary|sendgrid|mailgun|postmark|resend|twilio|algolia|pusher|ably" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.env*" --include="*.yml" --include="*.yaml" --include="*.toml" . 2>/dev/null | \
  grep -v ".git/\|lock" | head -50

# Dependency manifests reveal the rest
ls package.json Gemfile requirements.txt pyproject.toml go.mod 2>/dev/null
```

Group each hit into a category: **datastore, auth, file storage, queue/cache,
email, search, realtime, analytics/monitoring, hosting**.

## Step 3: Classify each dependency by portability

For every service found, place it in one of three buckets:

- **Open / drop-in** — Postgres, Redis, MinIO (S3-compatible), SMTP, Meilisearch,
  Keycloak. Self-hostable with a config change. Low effort.
- **Portable with work** — Supabase (self-hostable but heavy), Firebase Auth →
  Keycloak, Vercel → any Node host. Doable, needs a migration.
- **Hard-locked** — proprietary APIs with no open equivalent (Clerk-specific
  flows, DynamoDB single-table designs, Firebase realtime rules, platform-only
  edge functions). These are the real cost.

## Step 4: Find hardcoded provider assumptions

Portability dies by a thousand hardcoded hostnames. Find the ones that would break
the moment you move.

```bash
# Hardcoded managed-service URLs (should be env vars, not literals)
grep -rniE "https?://[a-z0-9.-]*\.(supabase\.co|vercel\.app|firebaseio|amazonaws|upstash\.io|neon\.tech|railway\.app)" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -v ".git/\|test\|example\|\.env" | head -30

# Provider-specific SDK calls that assume the managed platform
grep -rniE "createClient\(|initializeApp\(|new S3Client|Vercel|process\.env\.VERCEL|@vercel/|firebase-admin" \
  --include="*.ts" --include="*.js" --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -25

# Env vars that name a specific provider (vs. a generic connection string)
grep -rniE "SUPABASE_|FIREBASE_|VERCEL_|CLERK_|AUTH0_|UPSTASH_|PLANETSCALE_" \
  --include="*.env*" . 2>/dev/null | grep -v ".git/" | cut -d= -f1 | sort -u | head -30
```

A generic `DATABASE_URL` is portable. A `SUPABASE_URL` wired through `createClient`
everywhere is a coupling to fix.

## Step 5: Docker / self-host path readiness

```bash
# Is there any containerized run path today?
ls Dockerfile* docker-compose*.yml docker-compose*.yaml compose.yaml Procfile 2>/dev/null || echo "No container/compose path found"

# Does the README describe self-hosting?
grep -niE "self.host|docker|compose|localhost|on-prem|air.?gap" README.md 2>/dev/null | head -10

# Local dev vs. prod parity — does local point at cloud services?
grep -rniE "localhost|127\.0\.0\.1|host\.docker" --include="*.env*" --include="docker-compose*" . 2>/dev/null | head -15
```

A clean self-host story needs: containerized app, self-hostable datastore, and no
cloud dependency required just to boot. Note which of the three are missing.

## Step 6: Data portability (the user's right to leave)

Self-hosting the app is half the story. The people using it should be able to take
their data with them.

```bash
# Export endpoints / data-dump capability
grep -rniE "export|download.*data|dump|backup|to_csv|to_json.*all|takeout" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | grep -v ".git/\|test" | head -20

# Proprietary storage formats that resist export (vs. plain SQL/files)
grep -rniE "firestore|dynamodb|realtime.*database|proprietary" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | grep -v ".git/\|test" | head -15
```

Rate: can a user (or you) export everything to an open format and stand it up
elsewhere? If there's no export path, that's a portability FAIL regardless of how
clean the code is.

## Step 7: Score and produce the exit plan

**Portability Score: X/10**

| Category | Lock-in | Notes |
|---|---|---|
| Datastore | OPEN / PORTABLE / HARD | what it is + swap target |
| Auth | OPEN / PORTABLE / HARD | |
| File storage | OPEN / PORTABLE / HARD | |
| Queue / cache | OPEN / PORTABLE / HARD | |
| Email / notifications | OPEN / PORTABLE / HARD | |
| Search / realtime | OPEN / PORTABLE / HARD | |
| Hosting / runtime | OPEN / PORTABLE / HARD | |
| Data export path | YES / PARTIAL / NONE | |

Scoring: start at 10. −2 per HARD-locked category, −1 per PORTABLE-with-work,
−2 if there's no data export path, −1 if there's no container/compose path.

Then write a **phased exit plan** — cheapest, highest-leverage moves first:

1. **Free wins** — swap drop-in services (managed Postgres → self-hosted Postgres,
   managed Redis → self-hosted Redis), replace hardcoded hosts with env vars.
2. **Migrations** — the portable-with-work items, each with a concrete target
   (e.g. "Supabase Auth → self-hosted Keycloak, ~1 day").
3. **The hard ones** — for each hard-locked dependency, state the real cost and
   whether it's worth paying now or documenting as accepted lock-in.

Close with the one change that most reduces lock-in for the least effort. Pair this
with `/degoogle` to strip Google-specific dependencies in the same pass.
