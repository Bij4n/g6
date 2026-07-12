---
name: solo-standup
preamble-tier: 2
version: 1.0.0
description: |
  A daily standup for a team of one. Pulls together what actually moved (recent
  commits, merged PRs), what's in flight (open PRs, uncommitted work, the current
  branch), what's queued (TODOS, FIXMEs, saved context), and what's blocking you
  (failing CI, stale branches, reviews waiting) — then gives you a crisp
  Shipped / In progress / Blocked summary and picks the one thing most worth doing
  today. Momentum and focus for a founder with no one to report to. Forward-looking
  daily companion to /retro's weekly look back.
  Use when: "standup", "solo standup", "what did I do", "where am I", "what should
  I work on today", "catch me up", "daily check-in", "what's in flight". (g6)
  Proactively suggest at the start of a work session when the user seems to be
  reorienting after time away.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - Agent
  - AskUserQuestion
triggers:
  - standup
  - solo standup
  - what did i do
  - where am i
  - what should i work on today
  - catch me up
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

This is a focus tool, not a report you file for anyone. A solo founder loses more
time to *reorientation* — "wait, where was I?" — than to any single hard problem.
The job here is to rebuild that context fast and end on one clear next action, not
to produce a status document. Keep it short. The value is the last line.

## Step 1: Pick the window

Ask (or infer): since when? Default to the last working day. Options: since
yesterday, since the last commit, since a named date, or since the last standup if
one was saved. Establish the window in prose — the steps below reference it.

## Step 2: What moved

```bash
# Commits in the window (adjust --since to the window from Step 1)
git log --since="1 day ago" --pretty=format:"%h %s (%cr)" --no-merges 2>/dev/null | head -30

# Merged PRs in the window
gh pr list --state merged --limit 10 --json number,title,mergedAt \
  --jq '.[] | "#\(.number) \(.title) — merged \(.mergedAt)"' 2>/dev/null || echo "(gh unavailable — skip PR data)"
```

Group the commits by theme, not chronologically — the founder wants "I shipped the
billing flow and fixed two auth bugs," not a raw log. If nothing landed in the
window, say so plainly; a dry spell is signal, not something to pad.

## Step 3: What's in flight

```bash
# Uncommitted work — the most likely place "where was I" lives
git status --short 2>/dev/null | head -20
git diff --stat 2>/dev/null | tail -5

# Open PRs (yours), with review + CI state
gh pr list --state open --limit 15 \
  --json number,title,isDraft,reviewDecision,statusCheckRollup \
  --jq '.[] | "#\(.number) \(.title) [draft:\(.isDraft)] review:\(.reviewDecision // "none")"' 2>/dev/null || true

# Branches with unmerged work (stale-branch radar)
git for-each-ref --sort=-committerdate refs/heads/ \
  --format='%(refname:short) — %(committerdate:relative)' 2>/dev/null | head -10
```

Uncommitted changes and the current branch are the fastest way back into the work.
Lead the "in progress" section with them.

## Step 4: What's queued

```bash
# Project TODO lists
ls -1 TODOS.md TODO.md ROADMAP.md 2>/dev/null && head -40 TODOS.md TODO.md 2>/dev/null

# In-code work markers touched recently
grep -rniE "TODO|FIXME|HACK|XXX" --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -v ".git/\|node_modules\|lock" | head -20
```

Also check for g6 saved context: if `~/.gstack-dev/plans/` exists or a
/context-save state is around, surface the most recent "remaining work" note —
that's often the truest queue. Don't dump every TODO; pick the ones that are ripe.

## Step 5: What's blocking

Scan what you gathered for friction the founder should clear before starting
something new:

- Open PRs stuck waiting on review or with failing CI (they block the merge queue).
- Uncommitted work sitting for more than a day (risk of loss / merge pain).
- Stale branches that should be merged or deleted.
- Anything in TODOS explicitly marked blocked or waiting-on.

If nothing's blocking, say so — a clear runway is worth stating.

## Step 6: The standup

Keep it tight. Four headers, a few bullets each, then the one line that matters:

**Shipped** (since {window})
- grouped, plain-language wins

**In progress**
- current branch / uncommitted work first, then open PRs

**Blocked / waiting**
- only real blockers, or "nothing blocking"

**Today's one thing**
> The single highest-leverage next action, chosen from everything above. Not a
> list — one action, with a sentence on why it's the one. This is a founder's
> scarcest decision: what to do *now*. Make the call.

For a weekly look back with shipping streaks and per-project breakdowns instead of
a daily forward view, point them at /retro. To bank this context before stepping
away, /context-save.
