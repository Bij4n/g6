---
name: supabase-audit
version: 1.0.0
description: |
  Supabase security audit: Row-Level Security coverage, storage bucket policies,
  Edge Function auth, auth configuration hardening, service_role key exposure,
  pg_cron job security, and anonymous access gaps. Critical for apps handling
  PII or multi-tenant data where a single RLS gap exposes every user's records.
  Use when: "supabase audit", "check rls", "rls audit", "supabase security",
  "check storage policies", "supabase check". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - supabase audit
  - check rls
  - rls audit
  - supabase security
  - check storage policies
---

# /supabase-audit

Supabase security audit — RLS, storage, auth, Edge Functions, and key hygiene.

RLS misconfiguration is the most common Supabase security failure. A single table
without a policy exposes every row to any authenticated (or anonymous) user. This
audit finds those gaps before an attacker does.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Check for Supabase config
ls supabase/ 2>/dev/null | xargs echo "Supabase dir contents:"
cat supabase/config.toml 2>/dev/null | grep -E "project_id|[db]|auth" | head -20 || echo "No supabase/config.toml found"

# Check for Supabase client usage
grep -rn "createClient\|supabase\." \
  --include="*.ts" --include="*.tsx" --include="*.js" . 2>/dev/null | \
  grep -v ".git/\|node_modules/" | head -5 | xargs echo "Supabase client usage found:"
```

Read CLAUDE.md for the Supabase project ref and any known security decisions.

## Step 1: Row-Level Security coverage

This is the critical step. RLS off on a table = all rows visible to any authenticated user.

```bash
# Find all migration files that create tables
find supabase/migrations -name "*.sql" 2>/dev/null | sort | xargs grep -l "CREATE TABLE" 2>/dev/null

# Tables with RLS enabled
grep -rn "ENABLE ROW LEVEL SECURITY\|enable row level security\|ALTER TABLE.*ENABLE RLS" \
  supabase/migrations/ 2>/dev/null | head -40

# Tables with RLS disabled (explicit)
grep -rn "DISABLE ROW LEVEL SECURITY\|disable row level security" \
  supabase/migrations/ 2>/dev/null | head -20

# Policy definitions
grep -rn "CREATE POLICY\|create policy" \
  supabase/migrations/ 2>/dev/null | head -40
```

Cross-reference: for every `CREATE TABLE` found, verify there is a matching `ENABLE ROW LEVEL SECURITY` and at least one `CREATE POLICY`. Tables with RLS enabled but zero policies behave like RLS is off (default deny for authenticated users, but check anon access separately).

Report each table as:
- **SECURED** — RLS enabled + policies present
- **RLS ONLY** — RLS enabled but no policies (effectively blocking all access — may be intentional for internal-only tables)
- **EXPOSED** — no RLS, no policies (critical if table contains user data)

## Step 2: Policy correctness scan

```bash
# Policies that use auth.uid() correctly
grep -rn "auth\.uid()\|auth\.role()" \
  supabase/migrations/ 2>/dev/null | head -30

# Overly permissive policies (true = allow everyone)
grep -rn "USING (true)\|WITH CHECK (true)" \
  supabase/migrations/ 2>/dev/null | head -20

# Policies referencing user_id or owner columns
grep -rn "user_id\s*=\s*auth\.uid()\|owner\s*=\s*auth\.uid()" \
  supabase/migrations/ 2>/dev/null | head -20
```

Flag any policy with `USING (true)` or `WITH CHECK (true)` on a table containing PII — these allow any authenticated user to read/write all rows.

## Step 3: Storage bucket security

```bash
# Bucket definitions in migrations or seed files
grep -rn "storage\.buckets\|INSERT INTO storage\.buckets\|createBucket\|upsert_bucket" \
  supabase/migrations/ supabase/seed.sql 2>/dev/null | head -20

# Storage policies
grep -rn "storage\.objects\|CREATE POLICY.*storage\|bucket_id" \
  supabase/migrations/ 2>/dev/null | head -20

# Client-side bucket access (public vs private usage)
grep -rn "storage\|getPublicUrl\|createSignedUrl\|download" \
  --include="*.ts" --include="*.tsx" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -20
```

For each bucket: is it public or private? If public, what types of files are stored (user PII docs should never be in a public bucket)? If private, are signed URL TTLs reasonable (< 1 hour for sensitive content)?

## Step 4: Service role key exposure

The `service_role` key bypasses ALL RLS. It must never reach the browser.

```bash
# service_role key usage in client-side code (CRITICAL)
grep -rn "service_role\|SUPABASE_SERVICE_ROLE\|SERVICE_ROLE_KEY" \
  --include="*.ts" --include="*.tsx" --include="*.js" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|\.env\b" | head -20

# Check if service_role key is in any committed env files
grep -rn "service_role" \
  --include="*.env*" --include="*.yaml" --include="*.yml" . 2>/dev/null | \
  grep -v ".git/\|example\|sample" | head -10

# Check which env vars are prefixed VITE_ or NEXT_PUBLIC_ (these go to browser bundle)
grep -rn "VITE_.*SUPABASE\|NEXT_PUBLIC_.*SUPABASE" \
  --include="*.env*" --include="*.ts" --include="*.tsx" . 2>/dev/null | \
  grep -v ".git/\|example" | head -10
```

Any `VITE_` or `NEXT_PUBLIC_` prefixed Supabase key is exposed to the browser. Only `SUPABASE_ANON_KEY` (read-only, RLS-gated) should ever be in the browser bundle. The `service_role` key belongs only in Edge Functions and server-side code.

## Step 5: Edge Function auth and secret handling

```bash
# Edge function files
find supabase/functions -name "*.ts" 2>/dev/null | head -20

# Functions that verify JWT / auth header
grep -rn "Authorization\|jwt\|auth\.getUser\|verifyJWT" \
  supabase/functions/ 2>/dev/null | head -20

# Functions that use Deno.env for secrets
grep -rn "Deno\.env\.get\|SUPABASE_SERVICE_ROLE\|Deno\.env\.toObject" \
  supabase/functions/ 2>/dev/null | head -20

# CORS configuration in edge functions
grep -rn "Access-Control-Allow-Origin\|\*" \
  supabase/functions/ 2>/dev/null | grep -i "cors\|origin\|header" | head -10
```

Flag: functions with `Access-Control-Allow-Origin: *` that also use the service_role key, functions that don't verify the caller's JWT, and any function that logs full request bodies (which may contain PII).

## Step 6: Auth configuration audit

```bash
# supabase/config.toml auth section
grep -A 40 "\[auth\]" supabase/config.toml 2>/dev/null | head -50

# Check for anonymous sign-ins being enabled
grep -n "enable_anonymous_sign_ins\|anonymous" supabase/config.toml 2>/dev/null

# Email confirmation required?
grep -n "enable_confirmations\|email_confirm" supabase/config.toml 2>/dev/null

# OAuth providers configured
grep -n "\[auth\.external\." supabase/config.toml 2>/dev/null | head -10
```

Check:
- Is `enable_anonymous_sign_ins` off? (anonymous users can still trigger RLS if policies aren't tight)
- Is email confirmation required? (for apps with PII, unverified emails are a risk)
- Are password min-length requirements set?
- Are OAuth providers correctly configured (callback URLs, client ID/secret in vault)?

## Step 7: pg_cron and scheduled job security

```bash
# cron job definitions
grep -rn "cron\|pg_cron\|schedule" \
  supabase/migrations/ 2>/dev/null | grep -v ".git/" | head -20

# What do the cron jobs do?
grep -rn "cron\.schedule\|pg_cron" \
  supabase/migrations/ 2>/dev/null | head -10
```

For each scheduled job: does it run as a privileged role? Does it perform data deletion or modification? Could a compromised job exfiltrate data through a public endpoint?

## Step 8: Client-side query patterns

```bash
# Queries without .eq(user_id) filter (potential cross-user data access)
grep -rn "\.from(" \
  --include="*.ts" --include="*.tsx" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | \
  grep -v "\.eq\|\.filter\|\.match\|single()\|maybeSingle()" | head -30

# Realtime subscriptions — are they scoped to the user?
grep -rn "\.channel\|\.subscribe\|realtime" \
  --include="*.ts" --include="*.tsx" . 2>/dev/null | \
  grep -v ".git/\|node_modules/" | head -20
```

RLS enforces the filter server-side regardless of what the client query includes — a `.from('items')` without `.eq('user_id', ...)` still returns only the current user's rows when RLS is correctly configured. The purpose of this step is to verify RLS IS correctly configured (Step 2), not to add redundant client-side filters. Flag unscoped queries only when the corresponding table has no RLS policy or the policy doesn't include a user-scoping condition. Realtime subscriptions need RLS too; a channel that subscribes to `*` on a table without user-scoped RLS policies will receive all inserts.

## Step 9: Compile findings and score

**Supabase Security Score: X/10**

| Check | Status | Notes |
|---|---|---|
| RLS coverage | PASS / WARN / FAIL | X tables secured, Y exposed |
| Policy correctness | PASS / WARN / FAIL | overly permissive policies |
| Storage bucket security | PASS / WARN / FAIL | public buckets with PII |
| service_role key isolation | PASS / WARN / FAIL | browser-side exposure |
| Edge Function auth | PASS / WARN / FAIL | unauthenticated functions |
| Auth configuration | PASS / WARN / FAIL | anonymous sign-ins, no email confirm |
| pg_cron security | PASS / WARN / FAIL | privileged scheduled jobs |
| Client query patterns | PASS / WARN / FAIL | unscoped queries |

Scoring: 10 = clean. Deduct 2 per FAIL, 1 per WARN.

**FAIL items** require fixes before next deploy. Produce the specific migration or code change needed.

For RLS FAILs, generate the correcting migration:
```sql
-- Example fix for an exposed table
ALTER TABLE [table_name] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only see their own [table_name]"
  ON [table_name]
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

Ask before applying: "I found X critical issues. Fix them now?"
