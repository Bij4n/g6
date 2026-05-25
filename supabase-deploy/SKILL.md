---
name: supabase-deploy
version: 1.0.0
description: |
  Safe Supabase migration deployment. Diffs local migrations against what's
  applied in production, flags destructive changes (column drops, NOT NULL
  without defaults, index drops on large tables), runs migrations with a
  dry-run confirmation step, and verifies RLS is intact post-deploy.
  Use when: "deploy migrations", "push migrations", "supabase deploy",
  "apply migrations to prod", "run supabase migrations". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - deploy migrations
  - push migrations
  - supabase deploy
  - apply migrations to prod
---

# /supabase-deploy

Safe Supabase migration deployment — diff, review, confirm, apply, verify.

Never run migrations blind to production. This skill diffs first, flags
destructive changes, and verifies RLS is intact after every deploy.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Check Supabase CLI
if command -v supabase >/dev/null 2>&1; then
  echo "SUPABASE_CLI: $(supabase --version 2>/dev/null | head -1)"
else
  echo "SUPABASE_CLI: not found"
fi

# Project ref from config
grep -E "project_id|project_ref" supabase/config.toml 2>/dev/null | head -2 || echo "No supabase/config.toml found"

# Count local migrations
find supabase/migrations -name "*.sql" 2>/dev/null | wc -l | xargs echo "Local migrations:"
```

Read CLAUDE.md for the Supabase project ref. If no Supabase CLI is installed, tell the user to run `npm install -g supabase` or `brew install supabase/tap/supabase` and stop.

## Step 1: Check what's applied in production

```bash
supabase migration list --project-ref <ref> 2>/dev/null | head -40
```

If this fails (not linked or not logged in), run:
```bash
supabase login
supabase link --project-ref <ref>
supabase migration list
```

Note which migrations are `APPLIED` vs `PENDING`. These are the migrations that will run.

## Step 2: Preview the pending migrations

For each pending migration file, read its content and classify every statement:

```bash
for f in supabase/migrations/*.sql; do
  echo "=== $(basename $f) ==="
  cat "$f"
  echo
done
```

Classify each statement as one of:
- **SAFE** — `CREATE TABLE`, `ALTER TABLE ADD COLUMN (nullable)`, `CREATE INDEX CONCURRENTLY`, `CREATE POLICY`
- **REVIEW** — `ALTER TABLE ADD COLUMN NOT NULL` without a default, `DROP INDEX`, `ALTER TABLE ALTER COLUMN TYPE`
- **DESTRUCTIVE** — `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM` without WHERE

Flag every REVIEW and DESTRUCTIVE statement prominently. For each:
- **NOT NULL without default**: will lock the table while backfilling. On large tables (>100K rows) this causes downtime. Fix: add the column nullable, backfill, then add the constraint.
- **DROP COLUMN / DROP TABLE**: permanent. Verify it's not referenced in Edge Functions, client queries, or RLS policies.
- **Type change**: may fail if existing data can't be cast. Check for `USING` clause.

## Step 3: RLS pre-flight snapshot

Before applying anything, snapshot the current RLS state:

```bash
# List tables with RLS status (requires psql connection)
PGPASSWORD="" psql "$DATABASE_URL" -c "
  SELECT schemaname, tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename;" 2>/dev/null || echo "No direct DB connection — skipping pre-flight snapshot"
```

If no direct connection, note which tables have RLS enabled based on the migration history.

## Step 4: Confirm with user

Present a deploy summary:

```
Supabase Deploy Summary — [project] — [branch]
================================================
Pending migrations: X
  - [filename] — SAFE / REVIEW / DESTRUCTIVE

Destructive changes: [list or NONE]
Review items:       [list or NONE]
```

Ask: "Deploy these X migrations to production?"

If any DESTRUCTIVE statements exist, require explicit confirmation: "This includes destructive changes. Type 'yes, drop it' to confirm."

**If user declines:** stop. Do not apply anything.

## Step 5: Apply migrations

```bash
supabase db push --project-ref <ref>
```

If this fails, capture the error and diagnose:
- **"column already exists"** — migration was partially applied. Check `supabase migration list` for status.
- **"violates not-null constraint"** — existing rows have NULL in a new NOT NULL column. Need a backfill migration first.
- **"permission denied"** — service_role key may not have schema modification permissions. Check Supabase dashboard roles.
- **"deadlock detected"** — concurrent writes during migration. Retry or schedule during low-traffic window.

## Step 6: Post-deploy RLS verification

After successful apply, verify RLS is intact:

```bash
supabase db diff --project-ref <ref> 2>/dev/null | head -20
```

If diff is empty, local and remote are in sync. If not, something unexpected changed — flag it.

Also spot-check that the tables most critical to your app still have RLS enabled:

```bash
PGPASSWORD="" psql "$DATABASE_URL" -c "
  SELECT tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public' AND rowsecurity = false
  ORDER BY tablename;" 2>/dev/null || echo "Skipping — no direct connection"
```

Any table with `rowsecurity = false` that holds user data is a risk. Flag it.

## Step 7: Report

```
Deploy complete — [project] — [timestamp]
==========================================
Migrations applied: X
Duration:           ~Xs
RLS tables intact:  PASS / WARN (X tables without RLS)
Post-deploy diff:   clean / X unexpected changes

Applied:
  - [migration filename] ✓
```

If any post-deploy issues were found, list them with remediation steps.
