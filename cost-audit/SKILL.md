---
name: cost-audit
preamble-tier: 2
version: 1.0.0
description: |
  Burn-rate audit for a founder with no finance team. Finds every recurring cost
  the codebase implies — cloud + deploy hosts, managed services (DB, auth,
  storage, queue, email, SMS), LLM/AI API spend, third-party SaaS, and payment
  processing fees — estimates a rough monthly total, and hunts waste (idle tiers,
  missing caching that inflates API bills, always-on that could be serverless,
  free-tier swaps). Runs quick (biggest line items) or full (every recurring cost
  + a ranked optimization plan). Estimates from code + config, not your invoices.
  Use when: "cost audit", "what's my burn", "cloud bill", "am I overpaying",
  "reduce spend", "how much does this cost to run", "aws bill", "api costs". (g6)
  Proactively suggest when the user mentions a surprising bill, runway, or wanting
  to cut spend.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - Agent
  - WebSearch
  - AskUserQuestion
triggers:
  - cost audit
  - what's my burn
  - reduce spend
  - am i overpaying
  - how much does this cost to run
  - api costs
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

**This estimates spend from what the code and config reveal, not from your actual
invoices.** It tells you where the money *goes* and where it *leaks* — real numbers
come from each provider's dashboard. Say this plainly in the report so nobody reads
the estimate as a bill. When a real usage number is knowable (a live API you can
query, a config that pins a tier), prefer it over a guess and label which is which.

Read CLAUDE.md for stack context — it often already names the deploy hosts,
managed services, and payment setup, which saves a discovery pass.

## Step 1: Confirm scope

Ask (or infer): quick scan (the handful of line items that dominate the bill) or
full audit (every recurring cost plus a ranked optimization plan)?

- **Quick**: deploy/cloud host, database, and the single most expensive dependency
  (usually an LLM API or a data-heavy service)
- **Full**: everything below, plus the waste hunt and the optimization plan

Also ask roughly what stage they're at — pre-launch, a few users, or scaling —
because the same code costs wildly different amounts at 10 vs 10,000 users, and
the advice changes with it.

## Step 2: Deploy hosts and cloud infrastructure

Where the app runs is usually the first or second biggest line.

```bash
# Deploy + infra config — each file implies a paid platform and a tier
ls -1 vercel.json render.yaml fly.toml railway.json app.yaml Procfile \
  netlify.toml docker-compose.yml Dockerfile serverless.yml \
  .github/workflows/*.yml 2>/dev/null

# Cloud provider SDKs / clients in code
grep -rniE "aws-sdk|boto3|@google-cloud|azure|@vercel|render|fly\.io|railway|heroku|digitalocean|cloudflare" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.json" --include="*.toml" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock" | head -30
```

For each host, note what tier the config pins (instance size, region count,
always-on vs scale-to-zero) and roughly what that tier lists at. Always-on small
instances that idle 90% of the day are the classic first waste flag.

## Step 3: Managed services — the per-service subscriptions

Every managed dependency is a recurring bill with a free tier you eventually
outgrow.

```bash
# Database, auth, storage, queue, cache, search
grep -rniE "supabase|planetscale|neon|mongodb|atlas|redis|upstash|elasticsearch|algolia|meilisearch|clerk|auth0|firebase|s3\.amazonaws|cloudinary|uploadthing|rabbitmq|sqs|kafka" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.env*" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock\|test\|spec" | head -40

# Email / SMS / notifications (metered — scales with users)
grep -rniE "sendgrid|mailgun|postmark|resend|ses|twilio|vonage|onesignal|pusher|knock" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.env*" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock" | head -20

# Observability / analytics (often the sneaky-big bill at scale)
grep -rniE "sentry|datadog|newrelic|honeycomb|logrocket|fullstory|mixpanel|amplitude|segment|posthog|bugsnag" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.env*" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock" | head -20
```

For each service, note whether usage scales with users (metered — email, SMS,
storage, logs) or is a flat seat/tier. Metered services are where a launch spike
turns a $0 free tier into a four-figure surprise.

## Step 4: LLM / AI API spend — usually the single scariest line

For an AI-native product this dominates everything else and grows with usage. Look
at model choice, whether prompt caching is on, and whether retries or loops
multiply calls.

```bash
# Which providers + models, and how calls are made
grep -rniE "anthropic|openai|claude-|gpt-4|gpt-3|gemini|mistral|cohere|replicate|together\.ai|groq|bedrock" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock\|test\|spec" | head -30

# Cost multipliers: caching off, big max_tokens, retries/loops, no streaming cutoff
grep -rniE "max_tokens|cache_control|prompt_cache|temperature|n_retries|max_retries|for .* in range|while true" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -iE "token|cache|retr|model" | grep -v ".git/\|node_modules\|test" | head -20
```

Read the actual call sites. Flag: a frontier model used where a cheaper/smaller
one would do, prompt caching left off on repeated large system prompts, unbounded
`max_tokens`, retry loops that silently 3x cost on transient errors, and per-request
work that could be batched. For anything Claude/Anthropic-related, load the
`claude-api` skill before quoting model IDs or prices — don't estimate token cost
from memory.

## Step 5: Payment processing fees

Not a subscription, but a real percentage off the top of every dollar.

```bash
grep -rniE "stripe|paddle|lemonsqueezy|braintree|paypal|chargebee|recurly" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.env*" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock" | head -20
```

Note the processor and the headline rate (Stripe's standard is ~2.9% + $0.30/txn).
Flag places where fees stack — payouts to third parties, currency conversion,
subscription proration churn — and micro-transactions where the fixed per-txn fee
eats a huge share of a small charge.

## Step 6: The waste hunt

This is where the report earns its keep. For each cost found above, ask the founder
questions in money terms:

- **Idle / over-provisioned.** Always-on instances that could scale to zero, a
  paid tier three sizes above current load, duplicate services doing one job.
- **Missing caching.** Uncached API calls, LLM calls without prompt caching, no
  CDN in front of static assets, DB queries hitting the wire every request. Every
  cache miss is a metered call you paid for twice.
- **Free-tier / self-host swaps.** Cross-reference /self-host-audit and
  /degoogle — a managed service you could self-host, or a Google/paid dependency
  with a free privacy-respecting equivalent, is a recurring cost you can delete.
- **Redundant tooling.** Two analytics vendors, two error monitors, an unused
  service still billing.

## Step 7: Compile the burn estimate and optimization plan

Open with the disclaimer from the preamble, then:

**Estimated monthly burn: ~$X (low) – $Y (high)**

| Line item | Category | Est. $/mo | Scales with | Confidence |
|---|---|---|---|---|
| ... | host / managed / AI / SaaS / fees | ... | flat / users / usage | pinned / estimated |

Then the **optimization plan**, ranked by dollars-saved-per-hour-of-effort:

1. **Highest leverage first** — the change that cuts the most spend for the least
   work (often: turn on prompt caching, scale-to-zero an idle host, drop a
   redundant vendor).
2. ... each with the estimated monthly saving and a one-line how.

Close with the three moves that matter most this month and a note that the numbers
are code-derived estimates — confirm against each provider's dashboard before
acting on anything large.
