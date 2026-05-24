---
name: env-audit
version: 1.0.0
description: |
  Environment variable hygiene audit. Extracts every env var reference from code,
  compares against .env.example, finds secrets hardcoded in source, checks that
  Render and Vercel deployment configs are complete, and flags undocumented vars.
  Essential for multi-project setups and onboarding new developers.
  Use when: "env audit", "check env vars", "env variables", "missing env vars",
  "update env example", "check secrets". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - env audit
  - check env vars
  - missing env vars
  - update env example
---

# /env-audit

Environment variable hygiene — extract, compare, and document every env var in the project.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/gstack/bin/gstack-update-check 2>/dev/null || .claude/skills/gstack/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Detect stack
if [ -f "Gemfile" ]; then echo "STACK: Rails"
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then echo "STACK: Python"
elif [ -f "package.json" ]; then echo "STACK: Node"
fi

# Check what env files exist
ls .env .env.example .env.local .env.development .env.production .env.test 2>/dev/null | xargs echo "Env files found:"
```

## Step 1: Extract all env var references from source code

```bash
# Ruby / Rails
grep -rn "ENV\['\|ENV\[\"\|ENV\.fetch\|credentials\." \
  --include="*.rb" . 2>/dev/null | \
  grep -v ".git/\|#\|test\|spec" | \
  grep -oE "ENV\[['\"][A-Z0-9_]+['\"]" | \
  sort -u | sed "s/ENV\[//;s/['\"]//g"

# Python
grep -rn "os\.environ\|os\.getenv\|settings\." \
  --include="*.py" . 2>/dev/null | \
  grep -v ".git/\|#\|test" | \
  grep -oE "os\.environ\.get\(['\"][A-Z0-9_]+['\"]|os\.getenv\(['\"][A-Z0-9_]+['\"]|os\.environ\[['\"][A-Z0-9_]+['\"]" | \
  grep -oE "[A-Z0-9_]{3,}" | sort -u

# Node / TypeScript
grep -rn "process\.env\." \
  --include="*.ts" --include="*.js" --include="*.tsx" . 2>/dev/null | \
  grep -v ".git/\|//\|test" | \
  grep -oE "process\.env\.[A-Z0-9_]+" | \
  sed "s/process\.env\.//" | sort -u
```

Collect the full list. This is the **required set**.

## Step 2: Compare against .env.example

```bash
# What's documented in .env.example
cat .env.example 2>/dev/null | grep -v "^#\|^$" | cut -d= -f1 | sort
```

Diff the required set (Step 1) against what's in `.env.example`. Produce two lists:
- **Missing from .env.example** — used in code but not documented (new devs will be missing these)
- **Dead in .env.example** — documented but no longer referenced in code (stale, should be removed)

## Step 3: Check for hardcoded secrets

```bash
# Live Stripe keys in source (critical)
grep -rn "sk_live_\|pk_live_" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" \
  --include="*.yml" --include="*.yaml" . 2>/dev/null | \
  grep -v ".git/\|\.enc\|test\|spec\|example" | head -10

# Generic secret patterns (passwords, tokens, keys hardcoded)
grep -rn "password\s*=\s*['\"][^${\|secret\s*=\s*['\"][^${\|api_key\s*=\s*['\"][^${" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test\|spec\|example\|ENV\|os\.environ\|getenv\|bcrypt\|digest" | head -20

# Private keys or certs committed to repo
find . -name "*.pem" -o -name "*.key" -o -name "id_rsa" -o -name "*.p12" 2>/dev/null | \
  grep -v ".git/" | head -10

# .env files accidentally committed
git ls-files | grep -E "^\.env$|^\.env\." | grep -v "example\|sample\|template" 2>/dev/null | head -10
```

## Step 4: Check .gitignore coverage

```bash
# Ensure all real .env files are gitignored
for f in .env .env.local .env.development .env.production .env.test; do
  if [ -f "$f" ]; then
    if git check-ignore -q "$f" 2>/dev/null; then
      echo "GITIGNORED: $f ✓"
    else
      echo "NOT GITIGNORED: $f ← RISK"
    fi
  fi
done

# Check .gitignore for env patterns
grep -n "\.env\b\|\.env\." .gitignore 2>/dev/null | head -10
```

## Step 5: Deployment completeness check

**Render (render.yaml or dashboard):**
```bash
cat render.yaml 2>/dev/null | grep -E "key:|value:|envVarGroups:" | head -30
# Cross-reference required vars against render.yaml env section
```

**Vercel (vercel.json or dashboard):**
```bash
cat vercel.json 2>/dev/null | grep -A2 "env\|buildEnv" | head -20
# Note: most Vercel env vars are set in dashboard, not committed to repo
```

Ask the user: "Do you want me to compare the required vars against what's set in Render/Vercel? If yes, I'll need you to run `vercel env ls` or share the render.yaml env section."

## Step 6: Generate updated .env.example

If `.env.example` is missing entries or has stale ones, produce an updated version:

For each required var (from Step 1), add an entry in `.env.example` with:
- The var name
- A placeholder value that makes the format obvious (e.g., `STRIPE_SECRET_KEY=sk_test_...`)
- A comment explaining what it's for if the name isn't self-evident

Group related vars together (Stripe, DB, email, etc.).

Ask before writing: "I found X missing and Y stale entries. Update .env.example now?"

## Step 7: Report

```
Env Audit — [project] — [branch]
==================================
Vars in code:         X unique env vars referenced
Documented in .env.example: Y
Missing from .env.example:  Z (new devs will hit errors without these)
Stale in .env.example:      W (referenced but no longer in code)
Hardcoded secrets:    NONE / CRITICAL: X found
Gitignore coverage:   OK / RISK: X .env files not ignored
Deployment (Render/Vercel): checked / not checked
```

Output the missing-from-.env.example list prominently — these are the ones that break local setup for new developers.
