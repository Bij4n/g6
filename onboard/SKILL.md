---
name: onboard
version: 1.0.0
description: |
  Generates a structured onboarding guide for a new developer joining a project.
  Reads the codebase, maps architecture, documents how to run locally, identifies
  key files, flags gotchas, and produces a ONBOARDING.md they can follow from day one.
  Pairs with /mentor for in-session teaching. Perfect for mentees.
  Use when: "onboard", "new developer", "onboarding guide", "help someone get started",
  "write onboarding docs", "I'm adding someone to this project". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - onboard
  - new developer
  - onboarding guide
  - adding someone to this project
---

# /onboard

Generate a complete onboarding guide for a developer joining this project.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Project fingerprint
echo "=== Project fingerprint ==="
ls package.json Gemfile requirements.txt pyproject.toml go.mod Cargo.toml 2>/dev/null | head -5
cat .ruby-version .node-version .python-version .tool-versions 2>/dev/null | head -5
git log --oneline -5 2>/dev/null

# Directory structure (top level)
ls -la | grep "^d" | awk '{print $NF}' | grep -v "^\." | head -20
```

## Step 1: Understand the project

Read in this order (skip files that don't exist):

1. `README.md` — what it is and the existing setup instructions
2. `CLAUDE.md` — AI-specific conventions and commands
3. `package.json` / `Gemfile` / `requirements.txt` / `pyproject.toml` — dependencies and scripts
4. `config/` or `src/config/` — environment and app configuration
5. `docker-compose.yml` / `Dockerfile` — local setup requirements

```bash
# Key entry points
find . -maxdepth 3 \( \
  -name "main.py" -o -name "app.py" -o -name "server.py" \
  -o -name "application.rb" -o -name "config.ru" \
  -o -name "index.ts" -o -name "server.ts" -o -name "app.ts" \
  -o -name "main.ts" \
\) 2>/dev/null | grep -v ".git/\|node_modules\|vendor" | head -10

# Routes / API surface
find . -maxdepth 4 \( \
  -name "routes.rb" -o -name "routes.py" -o -name "router.ts" \
  -o -name "*routes*.py" -o -name "*router*.ts" \
\) 2>/dev/null | grep -v ".git/\|node_modules\|vendor\|test\|spec" | head -10
```

## Step 2: Document local setup requirements

```bash
# Required tools / versions
cat .ruby-version 2>/dev/null && echo "Ruby version required"
cat .node-version .nvmrc 2>/dev/null && echo "Node version required"
cat .python-version 2>/dev/null && echo "Python version required"
cat .tool-versions 2>/dev/null

# Services required locally
grep -rn "redis\|sidekiq\|celery\|rabbitmq\|elasticsearch\|postgres\|mysql\|mongo" \
  docker-compose.yml config/database.yml requirements.txt Gemfile 2>/dev/null | \
  grep -v ".git/\|test\|#" | head -20

# Database setup commands
grep -rn "db:create\|db:migrate\|db:seed\|createdb\|alembic\|flask db" \
  Makefile README.md CLAUDE.md 2>/dev/null | head -10
```

## Step 3: Extract the "how to run locally" steps

From README, Makefile, package.json scripts, and CLAUDE.md, reconstruct:

```bash
# package.json scripts
cat package.json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'  {k}: {v}') for k,v in d.get('scripts',{}).items()]" 2>/dev/null

# Makefile targets
grep -E "^[a-z].*:" Makefile 2>/dev/null | head -20

# Procfile (Heroku/Foreman/Overmind)
cat Procfile Procfile.dev 2>/dev/null
```

## Step 4: Map key files and directories

For each major directory, write one sentence explaining what lives there. Standard patterns:

**Rails:**
- `app/models/` — data layer
- `app/controllers/` — request handling
- `app/views/` — templates
- `app/jobs/` — background jobs (Sidekiq)
- `config/routes.rb` — URL routing
- `db/schema.rb` — database structure
- `spec/` or `test/` — tests

**FastAPI:**
- `app/routers/` or `api/` — endpoint handlers
- `app/models/` or `schemas/` — Pydantic models
- `app/db/` — database session and models
- `tests/` — tests
- `alembic/` — database migrations

**React/Vite:**
- `src/components/` — UI components
- `src/pages/` — page-level components
- `src/hooks/` — shared React hooks
- `src/api/` or `src/lib/` — API client
- `public/` — static assets

```bash
# Find the actual structure and annotate it
find . -maxdepth 2 -type d | grep -v ".git\|node_modules\|vendor\|__pycache__\|\.next\|dist\|build" | sort | head -40
```

## Step 5: Identify gotchas

Look for things that commonly trip up new developers:

```bash
# Non-standard setup steps
grep -rn "IMPORTANT\|NOTE:\|WARNING:\|gotcha\|must run\|before you\|first time" \
  README.md CLAUDE.md 2>/dev/null | grep -v ".git/" | head -20

# Custom binstubs or wrapper scripts
ls bin/ 2>/dev/null | head -20

# Environment-specific behavior
grep -rn "Rails\.env\|RAILS_ENV\|APP_ENV\|NODE_ENV\|ENVIRONMENT" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test\|spec" | head -20

# Required background processes
grep -rn "sidekiq\|celery\|rq\|bull\|worker" \
  Procfile Procfile.dev README.md 2>/dev/null | head -10

# Known issues / workarounds
grep -rn "workaround\|hack\|fixme\|TODO\|bug:" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test\|spec" | head -20
```

## Step 6: Identify first tasks for a new developer

Based on the codebase complexity and open TODOs, suggest 3 good starter tasks:
- One that requires reading but no writing (get familiar)
- One small bug fix or UI tweak (make a real change safely)
- One that touches the main data model (understand the core)

```bash
# Open TODOs and FIXMEs
grep -rn "TODO\|FIXME\|HACK\|XXX" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.tsx" . 2>/dev/null | \
  grep -v ".git/\|test\|spec\|node_modules" | head -20
```

## Step 7: Write ONBOARDING.md

Produce a `ONBOARDING.md` file at the project root with this structure:

```markdown
# Onboarding — [Project Name]

## What this is
[2-3 sentences from README]

## Prerequisites
[Exact versions and install commands for required tools]

## Local setup
[Step-by-step numbered list — copy-paste ready]

## How to run
[Start command(s), what URLs to open, what to expect]

## Project structure
[Directory map with one-line descriptions]

## Key files to read first
[Ordered list — start here, then here, then here]

## Gotchas
[Things that commonly trip up new developers]

## Running tests
[Exact test command(s)]

## First tasks
[3 suggested starter issues or areas to explore]

## Who to ask
[Left blank — fill in yourself]
```

Ask before writing: "Write ONBOARDING.md now?"

After writing, commit it: `git add ONBOARDING.md && git commit -m "add ONBOARDING.md"`
