---
name: explain-diff
preamble-tier: 2
version: 1.0.0
description: |
  Explains the current git diff (or a named PR) in plain language, calibrated to
  the reader's level. Walks through what changed and why, what could break, and
  what to test. Detects the base branch dynamically. Good for code-review learning
  and onboarding new engineers to a change.
  Use when: "explain this diff", "walk me through the PR", "what changed here",
  "explain my changes", "review this for me to learn", "what does this branch do". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
triggers:
  - explain this diff
  - explain my changes
  - walk me through the pr
  - what changed here
  - what does this branch do
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

This is a teaching walkthrough of a code change, not a merge gate. It explains a
diff so the reader understands it, learns from it, and knows what to check. For a
correctness review that hunts for bugs, use `/code-review` or `/review` instead.

Read CLAUDE.md for stack context (language, test command, how the project builds).
Reference it when you explain what to test.

## Step 1: Calibrate the reader's level

Ask ONE question (or infer from context if obvious): beginner (new to the
language/framework), intermediate (comfortable coding, learning this codebase), or
advanced (experienced, wants the tradeoffs and edge cases). Set explanation depth
for every step below from the answer.

## Step 2: Find the base branch and load the diff

Never hardcode `main`/`master`. Detect the base dynamically.

```bash
# Preferred: the PR's own base, if a PR exists for this branch
_BASE=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || true)

# Fallback: the remote's default branch
[ -z "$_BASE" ] && _BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

# Last resort: whichever of main/master exists
[ -z "$_BASE" ] && _BASE=$(git rev-parse --verify --quiet main >/dev/null && echo main || echo master)
echo "BASE: $_BASE"

# The diff to explain: uncommitted work if present, else branch vs base
git status --short
git diff --stat "$_BASE"...HEAD 2>/dev/null | tail -30
```

If the user named a specific PR (e.g. "explain PR 42"), load that instead:

```bash
gh pr diff 42 2>/dev/null | head -400   # replace 42 with the PR number
```

Decide what to explain: if there are uncommitted changes, ask whether they mean
the working-tree changes or the whole branch. Default to the branch vs base when
unsure.

## Step 3: Group the change into a story

Read the full diff (`git diff "$_BASE"...HEAD`, or the specific files). Don't
narrate it file-by-file top to bottom. Group hunks into 2-5 logical changes and
name each one in plain terms, for example:

- "Adds a retry around the payment call"
- "Renames `user_id` to `account_id` everywhere"
- "New migration that adds a `deleted_at` column"

Order the groups by importance, most load-bearing first. Mechanical noise
(renames, formatting, generated files) goes last and gets one line.

## Step 4: For each change — what and why

For every group from Step 3, explain in prose calibrated to the level:

- **What it does** — the behavior before and after, in everyday language.
- **Why** — the problem it solves or the reason it was written this way. If the
  reason isn't obvious from the diff, say so and give the most likely intent
  rather than inventing certainty.
- **How it fits** — what else in the codebase touches this. Use Grep/Read to
  confirm callers and dependents instead of guessing.

For beginners, lead with an analogy and show the smallest illustrative snippet.
For advanced readers, skip the basics and go straight to the tradeoff.

## Step 5: What could break

The most useful part of reading a diff is seeing the blast radius. Call out:

- Callers of any changed function or renamed symbol (find them, don't assume).
- Data changes that are hard to reverse (migrations, deletions, format changes).
- Behavior that changed silently (a default flipped, an error now swallowed).
- Edge cases the diff doesn't handle (empty input, nulls, concurrency, failure
  of an external call).

Be concrete: name the `file:line` and the specific scenario. If nothing looks
risky, say that plainly rather than manufacturing concern.

## Step 6: What to test

Turn the risks into a short checklist the reader can actually run. Pull the test
command from CLAUDE.md; if it isn't documented, say which command you'd use and
why, and offer to record it in CLAUDE.md.

- The one or two tests that most directly cover this change.
- Manual checks for anything not covered by automated tests.
- What "it works" looks like versus what a regression would look like.

## Step 7: Close with the takeaway

Two or three sentences: the single most important thing this change does, the one
risk worth watching, and (for a learner) one pattern here worth remembering. End
with something specific the reader can carry to the next diff they review.
