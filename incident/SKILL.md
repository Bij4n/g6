---
name: incident
version: 1.0.0
description: |
  Production incident response. Structured triage when something is broken right now:
  establish scope and severity, identify affected users, find root cause, communicate
  status, deploy a fix, verify recovery, and write the post-mortem.
  Different from /investigate (development debugging) — this is for live production fires.
  Use when: "incident", "something is broken", "production is down", "site is down",
  "users can't login", "payments are failing", "we have an incident". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
  - WebSearch
triggers:
  - incident
  - production is down
  - site is down
  - something is broken in production
  - payments are failing
  - we have an incident
---

# /incident

Production incident response — structured triage, fix, recovery, post-mortem.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
INCIDENT_START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "INCIDENT_START: $INCIDENT_START"
```

**Stop. Breathe. Work the problem in order. Panic makes incidents longer.**

## Step 1: Declare and scope — answer these four questions first

Ask the user (or infer from their description):

1. **What is broken?** (specific symptom, not a guess at cause)
2. **Who is affected?** (all users / specific plan tier / specific action / one user)
3. **Since when?** (exact time if known, or "approximately X minutes ago")
4. **Is there an obvious recent cause?** (last deploy, config change, third-party outage)

Classify severity:

| Severity | Definition |
|---|---|
| **P0** | Complete outage or data loss risk. All users affected. Revenue stopped. |
| **P1** | Major feature broken. Significant portion of users affected. |
| **P2** | Degraded experience. Workaround exists. Small % affected. |
| **P3** | Minor issue. No user impact on core flows. |

## Step 2: Immediate triage — check the obvious first

```bash
# Recent deploys (did something just ship?)
git log --oneline -10 2>/dev/null
git log --since="2 hours ago" --oneline 2>/dev/null

# Recent config changes
git log --oneline --all -- .env* config/ 2>/dev/null | head -10

# Error rates in logs (if log files accessible locally)
find . -name "*.log" -newer /tmp 2>/dev/null | head -5
tail -50 log/production.log 2>/dev/null | grep -i "error\|exception\|fatal" | tail -20
```

Check in this order — stop when you find the cause:
1. Was there a deploy in the last 2 hours? → likely cause
2. Did a third-party service go down? (Stripe, Render, Vercel status pages)
3. Did a certificate expire?
4. Did the database run out of connections or disk?
5. Did a background job queue back up?

```bash
# Check third-party status (note URLs to check manually)
echo "Check these status pages:"
echo "  Stripe:  https://status.stripe.com"
echo "  Render:  https://status.render.com"
echo "  Vercel:  https://www.vercel-status.com"
echo "  GitHub:  https://githubstatus.com"
```

## Step 3: Gather evidence — don't fix yet

```bash
# Application error logs
tail -100 log/production.log 2>/dev/null | grep -E "ERROR|FATAL|Exception|500" | tail -30

# Database connectivity
grep -rn "PG::ConnectionBad\|OperationalError\|could not connect\|connection refused" \
  log/production.log 2>/dev/null | tail -10

# Sidekiq / background job failures
grep -rn "retry_count\|dead\|failed" log/sidekiq*.log 2>/dev/null | tail -20

# Memory / disk (if accessible)
df -h 2>/dev/null | head -5
free -h 2>/dev/null | head -3
```

Write down what you find. The post-mortem needs a timeline.

## Step 4: Communicate status (before fixing)

For P0/P1, communicate to affected parties BEFORE spending more than 5 minutes investigating. Template:

```
STATUS UPDATE — [time]
We are aware of an issue affecting [what].
Impact: [who is affected and how]
We are actively investigating.
Next update in 15 minutes.
```

For SaaS products: post to your status page, Slack, or wherever users check.

**Do not communicate a root cause until you are certain.** "We're investigating" is correct. "It's probably X" creates confusion if you're wrong.

## Step 5: Identify the root cause

Use `/investigate` methodology:

```bash
# What changed recently?
git diff HEAD~3..HEAD --stat 2>/dev/null | head -20

# Are error rates correlated with a specific endpoint?
grep -E "GET|POST|PUT|DELETE" log/production.log 2>/dev/null | \
  grep " 5[0-9][0-9] " | awk '{print $7}' | sort | uniq -c | sort -rn | head -20

# Specific exception types
grep -oE "[A-Z][a-zA-Z]+Error|[A-Z][a-zA-Z]+Exception" log/production.log 2>/dev/null | \
  sort | uniq -c | sort -rn | head -10

# Database errors
grep -i "deadlock\|timeout\|connection\|disk full\|out of memory\|too many connections" \
  log/production.log 2>/dev/null | tail -20
```

Do not guess. The root cause is the specific change, failure, or condition that triggered the symptom. "The deploy broke it" is not a root cause. "The deploy added a missing DB index that caused query timeouts under load" is.

## Step 6: Fix and verify

Once root cause is confirmed:

**If a bad deploy:** Roll back first, ask questions later.
```bash
git log --oneline -5  # find the last good commit
# Then: revert the bad commit or redeploy the previous version
```

**If a config/env issue:** Fix the config, restart the service.

**If a third-party outage:** No fix possible — communicate ETA from their status page, activate any fallback if available.

**If a data issue:** Fix data before code. Confirm scope of affected records before touching anything.

After fixing:
```bash
# Verify the fix
echo "Check these manually:"
echo "1. Hit the broken endpoint/flow directly"
echo "2. Check error rate in logs has dropped"
echo "3. Check any background jobs are processing again"
echo "4. Confirm affected users can complete the action that was broken"
```

## Step 7: All-clear communication

```
STATUS UPDATE — [time] — RESOLVED
The issue affecting [what] has been resolved as of [time].
Root cause: [one sentence]
All systems are operating normally.
We will publish a post-mortem [timeframe].
```

## Step 8: Write the post-mortem

Generate `docs/postmortems/YYYY-MM-DD-[slug].md`:

```markdown
# Post-Mortem: [Title]

**Date:** [date]
**Severity:** P[0-3]
**Duration:** [start] → [end] ([X minutes/hours])
**Author:** $(git config user.name 2>/dev/null || echo "[your name]")

## Summary
[2-3 sentences. What broke, why, and how it was resolved.]

## Timeline
| Time (UTC) | Event |
|---|---|
| HH:MM | Incident detected |
| HH:MM | Investigation started |
| HH:MM | Root cause identified |
| HH:MM | Fix deployed |
| HH:MM | Recovery confirmed |

## Root Cause
[Specific technical explanation. No vague language.]

## Impact
- Users affected: [estimate]
- Duration: [X minutes]
- Revenue impact: [if applicable]

## What went wrong
[The specific failure — technical details]

## What went right
[What worked well in the response]

## Action items
| Item | Owner | Due |
|---|---|---|
| [Specific prevention step] | [owner] | [date] |
| [Monitoring improvement] | [owner] | [date] |
| [Process change] | [owner] | [date] |
```

Ask: "Write the post-mortem now? I'll need the timeline details from you."

## Incident principles

- **Fix first, understand second** (for P0). Restore service, then find root cause.
- **Communicate early and often.** Silence is worse than uncertainty.
- **Don't make it worse.** If unsure about a fix, roll back instead of forward.
- **No blame.** Post-mortems are blameless. Systems fail, not people.
- **Every incident is a gift.** It shows you something your monitoring missed.
