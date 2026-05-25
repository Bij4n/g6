---
name: multi-tenant-audit
version: 1.0.0
description: |
  Multi-tenant and multi-surface isolation audit. Checks for cross-tenant data
  leakage, shared state risks, brand config isolation, subdomain routing
  correctness, and auth scoping gaps. Covers both database-level tenancy
  (RLS, foreign key scoping) and application-level tenancy (brand config,
  subdomain detection, shared caches). Works with Rails, Supabase, and
  Next.js multi-surface architectures.
  Use when: "multi-tenant audit", "tenant isolation", "check tenant leakage",
  "b2b isolation", "brand isolation audit". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - multi-tenant audit
  - tenant isolation
  - check tenant leakage
  - brand isolation audit
  - b2b isolation
---

# /multi-tenant-audit

Multi-tenant isolation audit — database, application, auth, and shared state.

The failure mode is always the same: one tenant sees another tenant's data, files,
or UI. This audit finds the gaps before a real user does.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Detect tenancy model
echo "=== Tenancy signals ==="
grep -rn "tenant\|firm\|organization\|account_id\|org_id\|company_id\|brand\|surface" \
  --include="*.rb" --include="*.ts" --include="*.tsx" --include="*.py" \
  --include="*.yml" --include="*.yaml" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test\|spec\|#" | \
  grep -oE "(tenant|firm|organization|account_id|org_id|brand|surface)" | \
  sort | uniq -c | sort -rn | head -10
```

Read CLAUDE.md for how tenancy is structured in this project. Note the tenancy model:
- **Row-level** (Supabase RLS, Rails `default_scope`) — one DB, scoped queries
- **Schema-level** (one Postgres schema per tenant) — complete DB separation
- **Application-level** (brand config, subdomain routing) — same data, different UI
- **Hybrid** (multiple surfaces with shared backend, like B2B + B2C on same DB)

## Step 1: Database-level tenant scoping

### For Supabase / RLS projects

```bash
# Tables that reference a tenant/firm/org foreign key
grep -rn "firm_id\|tenant_id\|organization_id\|account_id\|org_id" \
  supabase/migrations/ 2>/dev/null | \
  grep "REFERENCES\|foreign key\|FOREIGN KEY" | head -20

# RLS policies that scope by tenant FK
grep -rn "firm_id\s*=\|tenant_id\s*=\|org_id\s*=" \
  supabase/migrations/ 2>/dev/null | \
  grep "USING\|WITH CHECK\|CREATE POLICY" | head -20

# Tables with tenant FK but no RLS policy scoping by that FK
grep -rn "CREATE TABLE\|ALTER TABLE" supabase/migrations/ 2>/dev/null | \
  grep -i "firm\|tenant\|org" | head -10
```

Cross-reference: every table with a `firm_id` / `tenant_id` column should have an RLS policy that filters `WHERE firm_id = auth.jwt() ->> 'firm_id'` or equivalent. A table with the FK column but no scoped policy is a full cross-tenant read vulnerability.

### For Rails / ActiveRecord projects

```bash
# Models with tenant scoping (default_scope, acts_as_tenant, etc.)
grep -rn "default_scope\|acts_as_tenant\|belongs_to :tenant\|belongs_to :organization\|belongs_to :firm" \
  app/models/ 2>/dev/null | head -20

# Controllers that set tenant context
grep -rn "Current\.\|set_tenant\|current_tenant\|current_firm\|current_organization" \
  app/controllers/ 2>/dev/null | head -20

# Scopes that might be missing tenant filter
grep -rn "\.all\b\|\.where\b" app/controllers/ 2>/dev/null | \
  grep -v "current_user\|current_tenant\|current_firm\|#" | head -20
```

## Step 2: Application-level brand/surface isolation

For projects with multiple brand surfaces (B2C + B2B, or multi-brand config):

```bash
# Brand config isolation (Rails)
find . -name "brand.yml" -o -name "brand*.rb" -o -name "*brand*config*" 2>/dev/null | \
  grep -v ".git/\|node_modules/" | head -10

# Subdomain/hostname routing
grep -rn "request\.subdomain\|request\.host\|hostname\|Surface\.\|surface_from" \
  --include="*.rb" --include="*.ts" --include="*.tsx" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test\|spec" | head -20

# Surface detection at boot
grep -rn "surface\b" \
  --include="*.ts" --include="*.tsx" . 2>/dev/null | \
  grep -v ".git/\|node_modules/\|test" | head -20
```

Check: Is surface/brand detection happening at the right layer (request boundary, not deep in business logic)? Can a user on the B2C surface access B2B routes by changing a URL? Can a user on firm A's subdomain access firm B's data by guessing IDs?

## Step 3: Auth scoping

```bash
# JWT claims used for tenant scoping
grep -rn "jwt\|claim\|role\b\|firm_id\|tenant_id" \
  supabase/functions/ 2>/dev/null | \
  grep -v ".git/\|node_modules/" | head -20

# Rails: current_user tenant association
grep -rn "current_user\.\(firm\|tenant\|organization\|account\)" \
  app/controllers/ app/models/ 2>/dev/null | head -20

# Role-based access per tenant
grep -rn "role\b\|permission\b\|policy\b\|authorize\b\|pundit\|cancan" \
  app/models/ app/policies/ 2>/dev/null | head -20
```

Flag: auth flows where the tenant context is derived from user input (URL params, request body) rather than the authenticated session. A user who can set their own `firm_id` in a request can impersonate any tenant.

## Step 4: Shared state risks

```bash
# Caching — are cache keys tenant-scoped?
grep -rn "Rails\.cache\|cache_key\|fetch\b" \
  app/ 2>/dev/null | grep -v ".git/\|test\|spec\|#" | \
  grep -v "tenant\|firm\|current_user\|current_firm" | head -20

# Background jobs — are they scoped to a tenant?
grep -rn "perform_later\|perform_async\|delay\b" \
  app/ 2>/dev/null | grep -v ".git/\|test\|spec" | head -20

# File storage — are uploads tenant-scoped?
grep -rn "has_one_attached\|has_many_attached\|ActiveStorage\|bucket\|upload" \
  app/models/ app/controllers/ 2>/dev/null | head -20
```

For caches: a cache key of just `"user_#{user.id}"` is fine; a key of `"dashboard_stats"` shared across all tenants is a leak. Every cached value derived from tenant data must include the tenant ID in the key.

For background jobs: a job that enqueues without tenant context and queries `Model.all` will process every tenant's data. Jobs should receive and set tenant context explicitly.

For file storage: ensure uploaded files are stored under a tenant-scoped path (`/firms/#{firm_id}/...`) and that signed URL generation verifies the requesting user belongs to the owning tenant.

## Step 5: ID enumeration / IDOR check

```bash
# Direct record lookups without tenant scope check
grep -rn "\.find\b\|\.find_by\b\|params\[:id\]" \
  app/controllers/ 2>/dev/null | \
  grep -v "current_user\|current_firm\|current_tenant\|scope\|#" | head -20

# API endpoints that take an ID param
grep -rn "params\[:.*_id\]\|params\[\".*_id\"\]" \
  app/controllers/ 2>/dev/null | grep -v ".git/\|test\|spec" | head -20
```

A lookup like `Record.find(params[:id])` without a tenant scope check allows any authenticated user to access any record by guessing its ID. Every `find` in a multi-tenant system should be `current_tenant.records.find(params[:id])`.

## Step 6: Compile findings

**Tenant Isolation Score: X/10**

| Check | Status | Issues |
|---|---|---|
| DB tenant scoping | PASS / WARN / FAIL | tables missing tenant FK scope |
| RLS policy coverage | PASS / WARN / FAIL | policies without tenant filter |
| Brand/surface isolation | PASS / WARN / FAIL | surface detection gaps |
| Auth tenant binding | PASS / WARN / FAIL | tenant from user input |
| Cache key scoping | PASS / WARN / FAIL | unscoped cache keys |
| Background job scoping | PASS / WARN / FAIL | jobs without tenant context |
| File storage scoping | PASS / WARN / FAIL | unscoped storage paths |
| IDOR / ID enumeration | PASS / WARN / FAIL | unscoped record lookups |

Scoring: 10 = clean. Deduct 2 per FAIL, 1 per WARN.

For each FAIL: provide the specific file:line and the minimal fix.

For RLS FAIL, generate the correcting policy. For Rails IDOR FAIL, show the scoped lookup pattern.
