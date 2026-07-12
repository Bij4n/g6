---
name: kill-switch
preamble-tier: 2
version: 1.0.0
description: |
  Emergency containment map for a founder with no ops team. Inventories every lever
  you can pull when something's on fire — where secrets live and how to rotate them,
  feature flags and existing kill switches, deploy rollback commands, session/token
  revocation, payment pause, and how to cut off a compromised integration — then
  gives you an ordered playbook for the specific situation (leaked key, breach,
  runaway cost, bad deploy). Report-first: nothing destructive runs without your
  explicit confirmation. Also flags the switches you're MISSING so you can add them
  before you need them. The first five minutes; /incident is the full response.
  Use when: "kill switch", "we're compromised", "leaked a key", "rotate secrets",
  "shut it down", "runaway costs", "roll back the deploy", "contain this",
  "emergency shutdown", "revoke access". (g6)
  Proactively suggest the moment the user reports a leaked secret, a breach, or
  spend spiralling out of control.
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
  - kill switch
  - we're compromised
  - leaked a key
  - rotate secrets
  - shut it down
  - runaway costs
  - roll back the deploy
  - emergency shutdown
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

**Safety contract — state this to the user up front and hold to it:** this skill
touches production. It *reads and maps* freely, but it never runs a destructive or
irreversible command (key rotation, revocation, teardown, rollback, disabling a
service) without showing you the exact command and getting an explicit "yes" for
that specific action. When containment and caution conflict, surface the trade-off
and let the founder choose — don't decide unilaterally to nuke something. This
mirrors /careful; if the session isn't already in careful mode, behave as if it
is.

**Never print a secret value.** When you find a key, name *where it lives*, never
what it is. If a real key value appears in output, treat that as its own finding.

## Step 1: Read the situation

Ask what's happening — the playbook branches on it:

1. **Leaked secret / key** (committed, logged, pasted, in a screenshot)
2. **Breach / unauthorized access** (someone's in who shouldn't be)
3. **Runaway cost** (a bill or usage graph going vertical)
4. **Bad deploy** (a release broke prod)
5. **Not sure yet** — start with the inventory (Step 2) and triage from there

If life-safety, legal, or customer-data disclosure obligations are in play, say so
plainly — those need a human decision and often counsel, not just a code lever.

## Step 2: Inventory the levers

Build the kill-switch map from the codebase. This is the reusable part — run it
even when nothing's on fire, so the map exists before you need it.

```bash
# WHERE SECRETS LIVE (names/locations only — never values)
ls -1 .env .env.* config/credentials*.yml* config/master.key 2>/dev/null
grep -rlniE "secret|api_key|token|password|credential|private_key" \
  --include="*.env*" --include="*.yml" --include="*.ts" --include="*.py" --include="*.rb" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock\|example\|sample" | head -20

# EXISTING KILL SWITCHES / FEATURE FLAGS (what can you already turn off?)
grep -rniE "feature_flag|feature\.enabled|flipper|launchdarkly|unleash|ENABLE_|DISABLE_|kill_switch|maintenance_mode|read_only" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.env*" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock" | head -20

# DEPLOY / ROLLBACK levers
ls -1 vercel.json render.yaml fly.toml Procfile .github/workflows/*.yml 2>/dev/null

# AUTH / SESSION revocation surface
grep -rniE "session|jwt|refresh_token|revoke|sign_out|invalidate|devise|clerk|auth0|supabase.auth" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -iE "revoke|invalidate|sign_out|expire|logout_all" | grep -v ".git/\|node_modules\|test" | head -15

# BILLING controls (pause charges, cap usage)
grep -rniE "stripe|paddle|billing|subscription|usage_limit|rate_limit|quota" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.env*" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock\|test" | head -15
```

From this, produce the **lever map**: for each system (secrets, flags, deploy,
auth, billing, each integration), where the switch is and how it's thrown —
config change, dashboard action, or command. Note which levers exist vs which are
missing (Step 5).

## Step 3: The playbook for the situation

Give the ordered response for the situation named in Step 1. Present it as numbered
steps; run destructive ones only on per-step confirmation (Step 4).

- **Leaked secret / key**
  1. Identify every place the key is valid (which provider, which env).
  2. **Rotate first, revoke second** — mint the new key, deploy it, *then* revoke
     the old one, so you don't take yourself down mid-response.
  3. Purge the leaked value from git history / logs / wherever it surfaced.
  4. Check the provider's usage logs for calls made with the leaked key.

- **Breach / unauthorized access**
  1. Revoke active sessions / refresh tokens (the "sign out everywhere" lever).
  2. Rotate the credentials that could have been taken.
  3. Disable new signups / lock the affected accounts if the flag exists.
  4. Snapshot logs *now* — preserve evidence before rotation churns it.

- **Runaway cost**
  1. Identify the specific service driving spend (cross-ref /cost-audit).
  2. Throw its kill switch — cap the quota, disable the feature flag, or scale the
     host to zero. Kill the *loop* if a retry/cron is multiplying calls.
  3. Cap the account limit in the provider dashboard so it can't recur tonight.

- **Bad deploy**
  1. Roll back to the last known-good release (the host's rollback command).
  2. Re-verify with a canary pass (/canary / /land-and-deploy).
  3. Only then debug the bad release on a branch.

## Step 4: Execute (confirmation-gated)

For each destructive step the founder approves, show the exact command, run it, and
report the result before moving on. Rules:

- One irreversible action at a time — confirm, run, verify, then the next.
- Never batch destructive commands behind a single "yes."
- If a command would take the whole app down, say that explicitly before running.
- Read-only checks (usage logs, git history search, listing sessions) don't need
  confirmation — run them freely to inform the founder's decision.

## Step 5: The switches you're missing

The most valuable output when nothing is actually on fire. Flag every lever that
*should* exist but doesn't:

- No feature flag around a risky integration → you can't turn it off without a deploy.
- No "sign out everywhere" / bulk session revocation → slow breach response.
- No deploy rollback path → a bad release means a forward-fix under pressure.
- Secrets with no documented rotation procedure → panic rotation loses state.
- No usage cap on a metered/LLM API → runaway cost has no ceiling.

For each gap, give the one concrete thing to add and why it matters at 3am.

## Step 6: After-action

Close with: what was pulled, what's now in a degraded state and needs restoring
(re-enable that flag, bring the host back up), and the handoff to /incident for
full triage, user comms, and the post-mortem. Kill-switch stops the bleeding;
/incident runs the recovery.
