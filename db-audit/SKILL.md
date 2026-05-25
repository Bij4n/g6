---
name: db-audit
version: 1.0.0
description: |
  Postgres health audit: missing indexes on foreign keys and query columns,
  table bloat, connection pool sizing, slow query patterns, SQLAlchemy and
  ActiveRecord N+1 risks at the database level. Works statically (code analysis)
  and live (psql connection if available). Covers Rails and FastAPI stacks.
  Use when: "db audit", "database health", "check indexes", "slow queries",
  "postgres audit", "check the database". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - db audit
  - database health
  - check indexes
  - slow queries
  - postgres audit
---

# /db-audit

Postgres health audit — static analysis + live DB checks if a connection is available.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Detect stack
if [ -f "Gemfile" ]; then
  echo "STACK: Rails"
  grep -m1 "^gem ['\"]rails['\"]" Gemfile 2>/dev/null || true
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  echo "STACK: Python"
  grep -E "sqlalchemy|databases|asyncpg|psycopg" requirements.txt pyproject.toml 2>/dev/null | head -3 || true
fi

# Check if psql is available
command -v psql >/dev/null 2>&1 && echo "PSQL: available" || echo "PSQL: not in PATH (static analysis only)"
```

## Step 1: Connection pool configuration

**Rails:**
```bash
cat config/database.yml 2>/dev/null | grep -A5 "production:\|pool:\|timeout:\|checkout_timeout:" | head -30
# Check for DATABASE_URL usage
grep -rn "DATABASE_URL\|pool:\|db_pool" config/ .env* 2>/dev/null | grep -v ".git/" | head -10
```

**FastAPI / SQLAlchemy:**
```bash
grep -rn "pool_size\|max_overflow\|pool_timeout\|pool_recycle\|create_engine\|AsyncSession" \
  --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -20
```

Flag: Rails pool < 5 on production. SQLAlchemy `pool_size` not set (defaults to 5, too low for concurrent API traffic). `pool_timeout` not set (can cause silent hangs under load).

## Step 2: Missing indexes — static analysis

**Rails (check migrations for unindexed foreign keys and common query columns):**
```bash
# Foreign keys without add_index
grep -rn "add_reference\|add_foreign_key\|_id\b" db/migrate/ 2>/dev/null | \
  grep -v "index:\s*true\|add_index\|#" | head -20

# Check schema for indexed vs unindexed foreign keys
grep -A1 "t\.bigint\|t\.integer\|t\.references" db/schema.rb 2>/dev/null | \
  grep -B1 "null: false" | grep "_id\b" | head -20

# Existing indexes
grep "add_index" db/schema.rb 2>/dev/null | wc -l | xargs echo "Total indexes:"
```

**FastAPI / SQLAlchemy:**
```bash
grep -rn "ForeignKey\|relationship\|Column\|index=True\|Index(" \
  --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -30

# ForeignKey columns without index=True
grep -rn "ForeignKey(" --include="*.py" . 2>/dev/null | grep -v "index=True\|.git/\|test" | head -20
```

## Step 3: Query pattern analysis (N+1 risks)

```bash
# Rails: scopes and associations without includes
grep -rn "has_many\|has_one\|belongs_to" app/models/ 2>/dev/null | grep -v "#\|.git/" | head -20

# Bullet gem configured?
grep -rn "Bullet\|bullet" Gemfile config/ 2>/dev/null | grep -v ".git/" | head -5

# Rails: controller actions loading without eager loading
grep -rn "\.all\b\|\.find_each\|\.each\b" app/controllers/ 2>/dev/null | \
  grep -v "includes\|eager_load\|preload\|.git/\|#" | head -20

# FastAPI: SQLAlchemy lazy loading (default, causes N+1)
grep -rn "lazy=\|selectinload\|joinedload\|subqueryload" \
  --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -20

# Unguarded lazy relationships (no loading strategy = N+1 risk)
grep -rn "relationship(" --include="*.py" . 2>/dev/null | \
  grep -v "lazy=\|selectinload\|joinedload\|.git/\|test" | head -20
```

## Step 4: Live database checks (if psql available)

If a DB connection is available, ask the user for the connection string or check for DATABASE_URL:

```bash
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ] && [ -f ".env" ]; then
  DB_URL=$(grep "^DATABASE_URL=" .env 2>/dev/null | cut -d= -f2-)
fi
if [ -z "$DB_URL" ] && [ -f "config/database.yml" ]; then
  echo "Rails DB config found — run: rails db (or check config/database.yml for connection details)"
fi
echo "DB_URL configured: $([ -n "$DB_URL" ] && echo yes || echo no)"
```

If connected, run these queries:

```sql
-- Table sizes (find bloated tables)
SELECT schemaname, tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS index_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 15;

-- Sequential scans (tables being scanned without index use)
SELECT relname, seq_scan, idx_scan,
  seq_scan - idx_scan AS diff
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_scan DESC
LIMIT 10;

-- Unused indexes (waste space and slow writes)
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND indexname NOT LIKE '%pkey'
ORDER BY tablename;

-- Long-running queries (if pg_stat_activity available)
SELECT pid, now() - query_start AS duration, query, state
FROM pg_stat_activity
WHERE state != 'idle'
AND query_start < now() - interval '30 seconds'
ORDER BY duration DESC;
```

Run via: `psql "$DB_URL" -c "<query>"` for each.

## Step 5: Schema hygiene

```bash
# Rails: check for missing timestamps
grep -rn "create_table" db/migrate/ 2>/dev/null | head -5
grep -v "timestamps\|created_at\|updated_at" db/schema.rb 2>/dev/null | \
  grep "create_table" | head -10

# Check for string columns that should be enums
grep -rn "t\.string.*status\|t\.string.*state\|t\.string.*type\b" db/schema.rb 2>/dev/null | head -10

# Very wide tables (>20 columns = likely needs decomposition)
awk '/create_table/{tbl=$0; count=0} /t\./{count++} /^end/{if(count>20) print tbl, count, "columns"}' \
  db/schema.rb 2>/dev/null | head -10
```

## Step 6: Report

```
DB Audit — [project] — [branch]
=================================
Stack:            Rails/FastAPI + Postgres
Connection pool:  OK (N=X) / WARN (too small) / NOT CONFIGURED
Missing indexes:  X foreign keys unindexed (see below)
N+1 risks:        X unguarded relationships / Bullet configured: yes/no
Table bloat:      (live only) X tables >1GB
Sequential scans: (live only) X high-scan tables
Unused indexes:   (live only) X indexes never hit
Schema hygiene:   OK / X issues
```

List every finding with file:line (static) or table name (live) and a one-line fix for each.

**Priority order for fixes:** Missing indexes on foreign keys → N+1 relationships → Pool sizing → Unused indexes → Bloat.
