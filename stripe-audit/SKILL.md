---
name: stripe-audit
preamble-tier: 2
version: 1.0.0
description: |
  Stripe integration security audit: webhook signature verification, live vs test
  key hygiene, price ID validation, idempotency key usage, customer data handling,
  subscription state machine correctness, and shared-account multi-product isolation.
  Critical for solo operators running multiple products under one Stripe account.
  Use when: "stripe audit", "check stripe", "webhook security", "stripe review". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - stripe audit
  - check stripe
  - webhook security
  - stripe review
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"

# Detect Stripe integration
grep -rn "stripe\|Stripe" Gemfile requirements.txt pyproject.toml package.json 2>/dev/null | grep -v ".git/\|test" | head -5
```

Read CLAUDE.md for Stripe account context (shared account, price IDs, product IDs).

## Step 1: Key hygiene — live vs test isolation

```bash
# Check which key is configured in each env
grep -rn "STRIPE_SECRET_KEY\|stripe\.secret_key\|stripe_secret" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.env*" \
  --include="*.yml" --include="*.yaml" . 2>/dev/null | grep -v ".git/\|test" | head -20

# Live key in non-production config is a critical failure
grep -rn "sk_live_" \
  --include="*.env.development" --include="*.env.test" \
  --include="*.env.local" config/environments/development.rb \
  config/environments/test.rb . 2>/dev/null | grep -v ".git/" | head -10

# Test key in production config is a revenue failure
grep -rn "sk_test_" \
  --include="*.env.production" config/environments/production.rb . 2>/dev/null | \
  grep -v ".git/\|example" | head -10

# Hardcoded keys in source (should always be env vars)
grep -rn '"sk_live_\|'"'"'sk_live_\|"sk_test_\|'"'"'sk_test_' \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test\|spec\|example" | head -10
```

**CRITICAL**: `sk_live_` in any non-production config = immediate fail. Hardcoded in source = immediate fail.

## Step 2: Webhook endpoint security

```bash
# Find webhook endpoints
grep -rn "webhook\|stripe_webhook\|/webhook\|/stripe" \
  --include="*.rb" --include="*.py" --include="*.ts" config/routes.rb . 2>/dev/null | \
  grep -v ".git/\|test\|#" | head -20

# Signature verification — this MUST be present on every Stripe webhook handler
grep -rn "construct_event\|Stripe::Webhook\|stripe\.webhooks\.construct_event\|webhook_secret\|STRIPE_WEBHOOK_SECRET" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test" | head -20

# Raw body preservation (Rails: skip_before_action or raw_post)
grep -rn "raw_post\|request\.body\.read\|skip_before_action.*verify_authenticity\|protect_from_forgery" \
  app/controllers/ 2>/dev/null | head -10

# Python: raw body for FastAPI/Flask
grep -rn "await request\.body()\|request\.get_data(raw\|request\.stream\.read" \
  --include="*.py" . 2>/dev/null | head -10
```

Flag: any webhook handler without `construct_event`. This allows replay attacks and spoofed events.

## Step 3: Idempotency key usage

```bash
# Check payment creation calls for idempotency keys
grep -rn "PaymentIntent.create\|Charge.create\|Subscription.create\|Customer.create" \
  --include="*.rb" --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -20

# Idempotency key usage
grep -rn "idempotency_key\|idempotency-key\|Idempotency" \
  --include="*.rb" --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -10
```

Flag: `PaymentIntent.create` or `Charge.create` calls without `idempotency_key`. Network retries without idempotency keys can double-charge customers.

## Step 4: Price ID and product ID validation

```bash
# Price IDs hardcoded in source (should be env vars)
grep -rn "price_[a-zA-Z0-9_]*\|prod_[a-zA-Z0-9_]*" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test\|PRICE_ID\|PRODUCT_ID\|ENV\|os\.environ\|price_data" | head -20

# Verify price IDs are referenced via env vars
grep -rn "STRIPE_PRICE_ID\|STRIPE_PRODUCT_ID\|price_id\|product_id" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test" | head -20
```

## Step 5: Subscription state machine

```bash
# Webhook events handled
grep -rn "customer\.subscription\|invoice\.payment\|payment_intent\|checkout\.session" \
  --include="*.rb" --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -20

# Check that cancellation/failure is handled (not just success)
grep -rn "subscription.deleted\|payment_failed\|invoice.payment_failed\|customer.subscription.updated" \
  --include="*.rb" --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -10
```

Critical events that MUST be handled:
- `customer.subscription.deleted` — user cancelled or payment failed → revoke access
- `invoice.payment_failed` — card declined → notify user, start dunning
- `invoice.payment_succeeded` — renew access
- `checkout.session.completed` — provision access after successful checkout

Flag any missing handlers.

## Step 6: Multi-product account isolation (shared Stripe account)

For solo operators running multiple products on one account:

```bash
# Check that each product routes to the correct application
grep -rn "STRIPE_PRODUCT_ID\|product_id\|metadata\[.product.\]\|metadata\[.app.\]" \
  --include="*.rb" --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -20

# Webhook routing — does the handler verify the event belongs to this app?
grep -rn "metadata\|product_id\|application_id" \
  --include="*.rb" --include="*.py" . 2>/dev/null | \
  grep -i "webhook\|event\|object" | grep -v ".git/\|test" | head -20
```

Flag: webhook handlers that don't verify the event's `metadata` or `product_id` match the current application. On a shared account, a webhook from Product A can accidentally be processed by Product B's handler.

## Step 7: Customer data handling

```bash
# Check what customer data is stored locally vs fetched live from Stripe
grep -rn "stripe_customer_id\|customer_id\|stripe_id" \
  --include="*.rb" --include="*.py" . 2>/dev/null | grep -v ".git/\|test" | head -20

# PII stored in Stripe metadata (avoid storing sensitive data in metadata)
grep -rn "metadata\s*=\s*{" --include="*.rb" --include="*.py" . 2>/dev/null | \
  grep -v ".git/\|test" | head -10
```

Flag: full credit card numbers, SSNs, or health data stored in Stripe metadata (not permitted by Stripe ToS).

## Step 8: Report

```
Stripe Audit — [project] — [branch]
=====================================
Key hygiene:          PASS / CRITICAL (live key in dev)
Webhook verification: PASS / CRITICAL (missing construct_event)
Idempotency keys:     PASS / WARN (X payment calls missing)
Price IDs:            PASS / WARN (hardcoded in source)
Subscription events:  X/4 critical events handled
Multi-product isolation: PASS / WARN / N/A
Customer data:        PASS / WARN
```

CRITICAL findings must be fixed before any production traffic.
WARN findings should be fixed before next deploy.
