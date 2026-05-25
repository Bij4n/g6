---
name: api-audit
preamble-tier: 2
version: 1.0.0
description: |
  REST / FastAPI audit: authentication flow, API key exposure, rate limiting,
  input validation, CORS, OpenAPI spec accuracy, and TILA/APR compliance hooks
  for financial APIs. Works with FastAPI, Flask, Express, and Rails API.
  Use when: "api audit", "check the api", "rate limiting review",
  "api security", "check my endpoints". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
  - WebSearch
triggers:
  - api audit
  - check the api
  - api security
  - rate limiting review
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Detect framework
if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  echo "FRAMEWORK: Python"
  grep -E "fastapi|flask|django" requirements.txt pyproject.toml 2>/dev/null | head -3
elif [ -f "Gemfile" ]; then
  echo "FRAMEWORK: Ruby/Rails"
elif [ -f "package.json" ]; then
  echo "FRAMEWORK: Node"
  grep -E '"express"|"hono"|"fastify"' package.json 2>/dev/null | head -3
fi
```

Read CLAUDE.md and the project's main router/app file to understand the endpoint surface.

## Step 1: Map the API surface

```bash
# FastAPI routes
grep -rn "@app\.\|@router\.\|APIRouter\|include_router" \
  --include="*.py" . 2>/dev/null | grep -v ".git/\|test\|#" | head -40

# Rails routes
cat config/routes.rb 2>/dev/null | grep -E "resources|get|post|put|patch|delete|namespace|scope" | head -40

# Express / Node routes
grep -rn "app\.get\|app\.post\|router\.get\|router\.post" \
  --include="*.ts" --include="*.js" . 2>/dev/null | grep -v ".git/\|test" | head -40
```

List every public endpoint. Mark each as: **authenticated**, **unauthenticated**, or **unclear**.

## Step 2: Authentication audit

```bash
# API key / Bearer token auth
grep -rn "api_key\|bearer\|Authorization\|x-api-key\|verify_token\|get_current_user\|Depends(" \
  --include="*.py" --include="*.rb" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test\|#" | head -30

# Endpoints missing auth dependency (FastAPI)
grep -rn "@router\.\|@app\." --include="*.py" . 2>/dev/null | \
  grep -v "Depends\|test\|.git/" | head -20

# Check for timing-safe comparison on API keys
grep -rn "hmac\|compare_digest\|secrets\.compare_digest\|ActiveSupport::SecurityUtils" \
  --include="*.py" --include="*.rb" . 2>/dev/null | head -10
```

Flag: endpoints that should be authenticated but have no auth dependency. Flag: API key comparison using `==` instead of timing-safe compare.

## Step 3: Rate limiting check

```bash
# Rate limiting libraries
grep -rn "slowapi\|flask_limiter\|rack-attack\|express-rate-limit\|throttle\|rate_limit" \
  --include="*.py" --include="*.rb" --include="*.ts" --include="*.js" \
  Gemfile requirements.txt pyproject.toml package.json . 2>/dev/null | \
  grep -v ".git/\|test" | head -20

# Per-key vs global rate limiting
grep -rn "RateLimit\|Limiter\|throttle" --include="*.py" --include="*.rb" . 2>/dev/null | \
  grep -v ".git/\|test" | head -20
```

Flag: no rate limiting found on public endpoints. Flag: global rate limit only (not per-API-key), which lets one user exhaust capacity.

## Step 4: Input validation

```bash
# FastAPI / Pydantic models
grep -rn "BaseModel\|Field\|validator\|model_validator" \
  --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -30

# Check for unvalidated inputs (raw dict access without Pydantic)
grep -rn "request\.json()\|request\.body\|request\.dict()" \
  --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -20

# Rails strong params
grep -rn "permit\|require(" app/controllers/ 2>/dev/null | head -20

# SQL injection risks (raw queries)
grep -rn "execute(\|raw_query\|text(\s*[\"']SELECT" \
  --include="*.py" --include="*.rb" . 2>/dev/null | grep -v ".git/\|test" | head -20
```

## Step 5: CORS configuration

```bash
# CORS setup
grep -rn "CORSMiddleware\|cors\|CORS\|allow_origins\|Access-Control" \
  --include="*.py" --include="*.rb" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test" | head -20
```

Flag: `allow_origins=["*"]` in production. Flag: missing CORS config on an API that serves browser clients.

## Step 6: API key exposure audit

```bash
# API keys in responses (accidentally echoed back)
grep -rn "api_key\|secret\|token" app/ 2>/dev/null | \
  grep -i "response\|jsonify\|return\|render" | grep -v ".git/\|test\|#" | head -20

# Keys in error messages
grep -rn "except\|rescue\|HTTPException" --include="*.py" --include="*.rb" . 2>/dev/null | \
  grep -v ".git/\|test" | head -20

# Environment variable usage (good) vs hardcoded (bad)
grep -rn "sk_live_\|sk_test_\|api_key\s*=\s*['\"][a-zA-Z0-9]" \
  --include="*.py" --include="*.rb" . 2>/dev/null | \
  grep -v ".git/\|test\|os\.environ\|ENV\[" | head -20
```

## Step 7: Financial API compliance (if applicable)

If this is a financial API (amortization, loan calculations, APR):

```bash
# APR / TILA references
grep -rn "apr\|tila\|annual_percentage\|finance_charge\|reg_z" \
  --include="*.py" --include="*.rb" . 2>/dev/null | grep -iv "test" | head -20

# Rounding / precision handling
grep -rn "Decimal\|round(\|\.quantize\|money\|Money" \
  --include="*.py" --include="*.rb" . 2>/dev/null | grep -v ".git/\|test" | head -20
```

Flag: APR calculations using float arithmetic (use Decimal). Flag: no TILA disclosure endpoint for consumer-facing APIs.

## Step 8: OpenAPI spec accuracy

```bash
# Check if OpenAPI spec exists and is auto-generated vs stale manual
ls openapi.json openapi.yaml docs/openapi.* 2>/dev/null

# FastAPI auto-generates — confirm it's enabled
grep -rn "include_in_schema\|openapi_url\|docs_url" --include="*.py" . 2>/dev/null | head -10

# Confirm response models are typed (not just dict return)
grep -rn "response_model=\|responses={" --include="*.py" . 2>/dev/null | head -20
```

## Step 9: Report

```
API Audit Report — [project] — [branch]
========================================
Endpoints found:    X total (Y authenticated, Z public)
Auth coverage:      PASS / X endpoints missing auth
Rate limiting:      configured / NOT FOUND
Input validation:   Pydantic/strong params / X unvalidated inputs
CORS:               OK / WARN (wildcard) / NOT CONFIGURED
Key exposure:       PASS / X risks found
Financial compliance: N/A / PASS / WARN / FAIL
OpenAPI spec:       auto-generated / manual / not found
```

List every FAIL with file:line and fix. List WARNs with recommended action.
