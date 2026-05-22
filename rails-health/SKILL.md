---
name: rails-health
preamble-tier: 2
version: 1.0.0
description: |
  Rails 8 health dashboard: credentials hygiene, Sidekiq queue depth,
  N+1 query detection, schema drift (pending migrations), gem vulnerability
  scan, and Stripe webhook security. Built for Rails 8 + Postgres + Sidekiq stacks.
  Use when: "rails health", "check sidekiq", "pending migrations",
  "rails audit", "check the rails app". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - rails health
  - check sidekiq
  - pending migrations
  - rails audit
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/gstack/bin/gstack-update-check 2>/dev/null || .claude/skills/gstack/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "Rails version: $(grep -m1 "^gem ['\"]rails['\"]" Gemfile 2>/dev/null || echo 'not found')"
echo "Ruby version: $(cat .ruby-version 2>/dev/null || ruby --version 2>/dev/null | head -1 || echo 'unknown')"
```

Read CLAUDE.md and the project Gemfile for stack context.

## Step 1: Credentials and secrets hygiene

```bash
# Hardcoded secrets in non-credential files
grep -rn "sk_live_\|sk_test_\|AKIA\|secret_key_base\s*=" \
  --include="*.rb" --include="*.yml" --include="*.yaml" --include="*.env" . 2>/dev/null | \
  grep -v "credentials\|\.enc\|test\|spec\|example\|.git/" | head -20

# Secrets accidentally committed (check git log for .env files)
git log --all --full-history --name-only --format="" -- "*.env" "*.env.local" "*.env.production" 2>/dev/null | \
  grep -v "^$" | head -10

# Rails credentials structure
ls -la config/credentials/ 2>/dev/null || echo "config/credentials/ not found"
ls config/credentials.yml.enc config/master.key 2>/dev/null || echo "No credentials.yml.enc found"

# Ensure master.key is gitignored
grep "master.key\|credentials.yml.enc" .gitignore 2>/dev/null || echo "WARNING: master.key may not be in .gitignore"
```

## Step 2: Pending migrations check

```bash
# Find migration files and check for pending state
ls db/migrate/ 2>/dev/null | wc -l | xargs echo "Total migrations:"
ls db/migrate/ 2>/dev/null | tail -5

# Schema version match
grep "ActiveRecord::Schema\[" db/schema.rb 2>/dev/null | head -1

# Check for timestamps in migrations that don't match schema version
SCHEMA_VER=$(grep -m1 "version:" db/schema.rb 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "unknown")
echo "Schema version: $SCHEMA_VER"

# Check for structural changes (added columns) not yet reflected
git diff HEAD~5..HEAD -- db/migrate/ 2>/dev/null | grep "^+.*def change\|^+.*add_column\|^+.*create_table" | head -20
```

## Step 3: N+1 query detection

```bash
# Bullet gem configured?
grep -rn "bullet\|Bullet" Gemfile config/ 2>/dev/null | grep -v ".git/" | head -10

# Common N+1 patterns (missing includes/preload)
grep -rn "\.each\b\|\.map\b" app/views/ 2>/dev/null | \
  grep -v ".git/\|#\|<%#" | head -20

# Controllers loading associations without eager loading
grep -rn "@[a-z_]*\.each\b" app/views/ 2>/dev/null | grep -v ".git/" | head -10

# Check for counter_cache usage on belongs_to
grep -rn "counter_cache" app/models/ 2>/dev/null | head -10
```

Report: list of likely N+1 hotspots with file:line.

## Step 4: Sidekiq queue health

```bash
# Sidekiq configuration
cat config/sidekiq.yml 2>/dev/null || echo "No config/sidekiq.yml found"

# Worker files
find app/jobs app/workers -name "*.rb" 2>/dev/null | head -20

# Check retry configuration
grep -rn "sidekiq_options\|retry:\|dead:" app/jobs/ app/workers/ 2>/dev/null | head -20

# Check for jobs without error handling
grep -rn "def perform" app/jobs/ app/workers/ 2>/dev/null | head -20

# Scheduled jobs (sidekiq-cron or whenever)
cat config/schedule.rb 2>/dev/null || grep -rn "cron\|every\b" config/ 2>/dev/null | grep -v ".git/" | head -10
```

Flag: jobs with no retry config, jobs that perform external HTTP calls without timeout, jobs that don't handle exceptions.

## Step 5: Gem security scan

```bash
# Outdated gems with known CVEs (if bundler-audit installed)
if command -v bundle-audit >/dev/null 2>&1; then
  bundle-audit check --update 2>/dev/null | head -30
else
  echo "bundler-audit not installed — run: gem install bundler-audit"
  # Fall back to checking Gemfile.lock age
  find . -name "Gemfile.lock" -mtime +30 -print 2>/dev/null | head -5 | xargs -I{} echo "Gemfile.lock not updated in 30+ days: {}"
fi

# Check Rails version against known CVE advisories
RAILS_VER=$(grep -m1 "^gem ['\"]rails['\"]" Gemfile 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
echo "Rails: $RAILS_VER (verify against https://rubyonrails.org/security)"

# Check for gems with no recent activity (unmaintained)
grep -E "gem ['\"]" Gemfile | grep -v "#" | wc -l | xargs echo "Total Gemfile dependencies:"
```

## Step 6: Stripe webhook security (if applicable)

```bash
# Check for webhook endpoint
grep -rn "webhook\|stripe_webhook\|StripeWebhook" app/ config/routes.rb 2>/dev/null | grep -v ".git/" | head -10

# Verify webhook signature verification is present
grep -rn "construct_event\|Stripe::Webhook\|webhook_secret\|STRIPE_WEBHOOK_SECRET" app/ 2>/dev/null | grep -v ".git/" | head -10

# Ensure raw body is preserved for Stripe signature verification
grep -rn "raw_post\|request\.body\.read\|skip_before_action.*verify_authenticity" app/ 2>/dev/null | head -10
```

Flag: webhook endpoints that don't call `Stripe::Webhook.construct_event`, endpoints without CSRF protection bypass for raw body, missing `STRIPE_WEBHOOK_SECRET` env var reference.

## Step 7: Health report

Produce a dashboard:

```
Rails Health Report — [project] — [branch]
==========================================
Credentials:     PASS / WARN / FAIL
Pending migrations: X pending / up to date
N+1 hotspots:    X found (see below)
Sidekiq:         X workers, config OK / issues found
Gem security:    X CVEs / clean / audit unavailable
Stripe webhooks: secured / MISSING VERIFICATION
```

List every FAIL with file:line and a one-line fix.
List every WARN with a recommended action.
