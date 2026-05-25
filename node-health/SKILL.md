---
name: node-health
version: 1.0.0
description: |
  Node.js / Express health dashboard: npm dependency CVE scan, outdated
  packages, Express security middleware (helmet, rate-limit, CORS, CSRF),
  SQL and MongoDB injection risks, authentication hygiene (session secret,
  bcrypt, JWT), environment / secrets hygiene, error handling completeness,
  and process management. Works with Express, Fastify, Koa, and plain Node.
  Use when: "node health", "express audit", "npm security", "node audit",
  "check the node app", "express security". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - node health
  - express audit
  - npm security
  - node audit
  - check the node app
  - express security
---

# /node-health

Node.js / Express health dashboard — dependencies, security middleware, injection risks, auth, error handling.

Run this before deploying a Node app. Catches the class of bugs that npm audit misses: unsafe query building, missing security headers, weak session config, unhandled rejections that crash the process.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Node and package manager
node --version 2>/dev/null || echo "Node: not found in PATH"
npm --version 2>/dev/null | xargs echo "npm:"
[ -f yarn.lock ] && echo "Package manager: yarn"
[ -f pnpm-lock.yaml ] && echo "Package manager: pnpm"
[ -f bun.lockb ] && echo "Package manager: bun"

# Framework detection
if [ -f package.json ]; then
  echo "=== Framework ==="
  node -e "const p=require('./package.json'); const deps={...p.dependencies,...p.devDependencies}; ['express','fastify','koa','hapi','nestjs'].forEach(f=>deps[f]&&console.log(f+': '+deps[f]))" 2>/dev/null
  echo "Node engine requirement: $(node -e "const p=require('./package.json'); console.log(p.engines&&p.engines.node||'not specified')" 2>/dev/null)"
fi

# Lockfile present?
ls package-lock.json yarn.lock pnpm-lock.yaml bun.lockb 2>/dev/null || echo "WARNING: No lockfile found"
```

Read CLAUDE.md and `package.json` for stack context.

## Step 1: Dependency vulnerability scan

```bash
# npm audit (requires lockfile)
if [ -f package-lock.json ]; then
  npm audit --audit-level=moderate 2>/dev/null | tail -30
elif [ -f yarn.lock ]; then
  yarn audit 2>/dev/null | tail -20 || echo "yarn audit failed — check yarn version"
else
  echo "No lockfile — cannot run audit. Run: npm install"
fi
```

```bash
# Outdated packages
npm outdated 2>/dev/null | head -30 || echo "npm outdated failed"

# Check for packages with known bad history (manually flag these)
node -e "
const p = require('./package.json');
const deps = {...(p.dependencies||{}), ...(p.devDependencies||{})};
const watch = ['lodash', 'moment', 'request', 'node-uuid', 'grunt', 'bower'];
watch.forEach(pkg => {
  if (deps[pkg]) console.log('LEGACY: ' + pkg + '@' + deps[pkg] + ' — consider replacing');
});
" 2>/dev/null
```

Flag:
- **Critical/High CVEs**: must fix before deploy
- **Moderate CVEs**: fix within the sprint
- **Legacy packages**: `request` (deprecated), `moment` (heavy, prefer `dayjs`), `node-uuid` (use `crypto.randomUUID()`)
- **No lockfile**: dependency versions are non-deterministic across installs

## Step 2: Express security middleware

```bash
# helmet — sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
grep -rn "helmet\b" --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test\|#" | head -10

# express-rate-limit or equivalent
grep -rn "rateLimit\|rate.limit\|express-rate-limit\|slowDown\|throttle" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# CORS configuration
grep -rn "cors\b\|CORS\|Access-Control-Allow-Origin" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# CSRF protection
grep -rn "csurf\|csrf\|_csrf\|csrfToken" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# Body size limits (prevents request bombing)
grep -rn "limit:\|bodyParser\|express.json\|express.urlencoded" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10
```

Flag each missing middleware:
- **No helmet**: response headers expose Express version, allow clickjacking, no HSTS
- **No rate limiting**: brute-force and scraping risk on auth and API endpoints
- **CORS `*` in production**: any origin can call your API with user credentials
- **No CSRF on state-changing forms**: session-based apps must use csurf or SameSite=Strict cookies
- **No body size limit**: a 1GB POST body can OOM the process

## Step 3: SQL injection risks

```bash
# Raw query string concatenation — the classic injection pattern
grep -rn "query\s*(" --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test\|spec" | \
  grep '"\s*+\|`.*\${\|'\''.*+' | head -20

# pg / mysql / mysql2 usage
grep -rn "db\.query\|pool\.query\|connection\.query\|client\.query" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -20

# Knex / Sequelize / TypeORM (safer ORMs)
grep -rn "knex\|sequelize\|typeorm\|prisma" \
  --include="*.js" --include="*.ts" package.json 2>/dev/null | \
  grep -v ".git/\|node_modules/" | head -10
```

For every `db.query()` call found, check whether it uses parameterized queries (`$1`, `?`, or named params) or string concatenation. String concatenation is always wrong:

```
BAD:  db.query("SELECT * FROM users WHERE id = " + req.params.id)
GOOD: db.query("SELECT * FROM users WHERE id = $1", [req.params.id])
```

## Step 4: MongoDB injection risks (if applicable)

```bash
# Check for MongoDB / Mongoose usage
grep -rn "mongoose\|mongodb\|MongoClient" package.json \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# $where clause (executes arbitrary JS on the server — always dangerous)
grep -rn '\$where\b' --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# User-controlled query operators (operator injection)
grep -rn "req\.body\|req\.query\|req\.params" --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | \
  grep -A2 "find\|findOne\|update\|remove" | head -20

# mongo-sanitize or express-mongo-sanitize installed?
grep -rn "mongo.sanitize\|mongo_sanitize\|express-mongo-sanitize" \
  package.json --include="*.js" . 2>/dev/null | grep -v "node_modules/" | head -5
```

Flag:
- **Any `$where` usage**: executes JavaScript on the MongoDB server — remove immediately
- **Request body piped directly to a Mongoose query** without sanitization: allows operator injection (`{ $gt: "" }` bypasses string equality checks)
- **No mongo-sanitize**: if user input reaches any Mongoose query, `express-mongo-sanitize` should be in the middleware chain

## Step 5: Authentication hygiene

```bash
# Session secret strength
grep -rn "session\b.*secret\|secret.*session" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# Hardcoded session secret (must be from env)
grep -rn "secret\s*:\s*['\"][^'\"]\{1,30\}['\"]" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test\|process\.env\|example" | head -10

# Password hashing
grep -rn "bcrypt\|argon2\|scrypt\|pbkdf2" \
  --include="*.js" --include="*.ts" package.json . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# Weak hashing (SHA1/MD5 for passwords — wrong choice)
grep -rn "createHash\s*(['\"]md5\|createHash\s*(['\"]sha1" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# JWT secret / algorithm
grep -rn "jwt\.sign\|jsonwebtoken\|sign\s*(" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# Passport.js strategy
grep -rn "passport\b\|LocalStrategy\|JwtStrategy" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -15
```

Flag:
- **Session secret hardcoded** (not from `process.env`): rotate it and move to env
- **Session secret < 32 chars**: brute-forceable — use `crypto.randomBytes(64).toString('hex')`
- **MD5 or SHA1 for passwords**: one-way hashes with no work factor — must use bcrypt/argon2
- **JWT using `algorithm: 'none'`**: strips signature verification — explicit algo required
- **JWT secret hardcoded**: same risk as session secret

## Step 6: Environment and secrets hygiene

```bash
# .env files that should be gitignored
git ls-files --error-unmatch .env .env.local .env.production 2>/dev/null && \
  echo "FAIL: .env file is tracked by git" || echo "PASS: .env not tracked"

# Check .gitignore covers .env variants
grep -E "^\.env" .gitignore 2>/dev/null | head -5 || echo "WARNING: .env not in .gitignore"

# Hardcoded secrets in source
grep -rn "sk_live_\|sk_test_\|AKIA[A-Z0-9]\|xoxb-\|ghp_\|ghs_" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test\|example" | head -10

# process.env usage vs hardcoded
grep -rn "process\.env\." --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | wc -l | xargs echo "process.env references:"

# .env.example present? (documents required vars)
ls .env.example .env.sample 2>/dev/null || echo "No .env.example — contributors won't know what vars are needed"
```

## Step 7: Error handling

```bash
# Global error middleware (Express: 4-arg function at end of middleware chain)
grep -rn "app\.use.*err\|function.*err.*req.*res.*next\|(err,\s*req,\s*res,\s*next)" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10

# Unhandled promise rejection handler
grep -rn "unhandledRejection\|uncaughtException" \
  --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/" | head -10

# Async route handlers without try/catch (Express doesn't catch async errors by default pre-5.x)
grep -rn "async.*function\|async (req" --include="*.js" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -20

# express-async-errors or similar wrapper installed?
grep -rn "express-async-errors\|express-async-handler\|asyncHandler" \
  package.json --include="*.js" . 2>/dev/null | grep -v "node_modules/" | head -5
```

Flag:
- **No global error middleware**: unhandled errors return 500 with stack trace exposed to users
- **No `unhandledRejection` handler**: a rejected promise anywhere crashes the Node process in older versions (< 15)
- **Async route handlers without try/catch in Express 4**: `await` failures in a route become unhandled rejections and crash the process. Fix: wrap with `express-async-errors` (one `require` at app top) or per-route try/catch

## Step 8: Process management

```bash
# Check for process manager config
ls ecosystem.config.js ecosystem.config.cjs pm2.config.js Procfile 2>/dev/null || \
  echo "No PM2/Foreman config found"

# nodemon in prod dependencies (should be devDependency only)
node -e "
const p = require('./package.json');
if (p.dependencies && p.dependencies.nodemon) {
  console.log('WARN: nodemon in dependencies (not devDependencies) — will run in production');
}
" 2>/dev/null

# Start script
node -e "const p=require('./package.json'); console.log('start:', p.scripts&&p.scripts.start||'NOT DEFINED')" 2>/dev/null

# Check for cluster mode (multi-core utilization)
grep -rn "cluster\b\|numCPUs\|pm2.*cluster\|instances:" \
  --include="*.js" --include="*.ts" ecosystem.config.js pm2.config.js . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -10
```

## Step 9: Health report

```
Node.js Health Report — [project] — [branch]
=============================================
Node version:       X.X.X (LTS: yes / no / unknown)
Framework:          Express X.X / Fastify / Koa / plain Node

Dependency CVEs:    X critical, Y high, Z moderate / CLEAN
Outdated packages:  X packages behind / UP TO DATE
Legacy packages:    [list or NONE]

Security middleware:
  helmet:           PRESENT / MISSING
  rate-limit:       PRESENT / MISSING
  CORS:             configured (origin: X) / MISSING / WILDCARD (*)
  CSRF:             PRESENT / MISSING / N/A (API only)
  body size limit:  PRESENT / MISSING

SQL injection:      PASS / X parameterized / Y UNSAFE concatenations
MongoDB injection:  PASS / $where found / unsanitized input / N/A
Auth hygiene:       PASS / WARN / FAIL — [details]
Secrets hygiene:    PASS / .env tracked / hardcoded secrets found
Error handling:     PASS / no global handler / async routes unprotected
Process manager:    PM2 / Foreman / NONE

Overall: HEALTHY / DEGRADED / CRITICAL
```

**CRITICAL** — any of: CVE with public exploit, SQL injection via string concatenation, session secret hardcoded in source, passwords hashed with MD5/SHA1, `$where` clause in production queries, `.env` committed to git.

**DEGRADED** — missing security middleware (helmet/rate-limit), async routes without error wrapping, no global error handler, moderate CVEs unpatched.

**HEALTHY** — no CRITICAL findings, DEGRADED items have a clear remediation plan.

For each FAIL: provide file:line and the minimal code change to fix it.
