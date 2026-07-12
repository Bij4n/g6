---
name: walkthrough
preamble-tier: 2
version: 1.0.0
description: |
  Narrates a codebase or a specific subsystem for a newcomer: entry points, how a
  request flows through the system, the key files, the mental model to hold, and
  the gotchas. Maps the code first, then tells the story top-down and interactively.
  Complements /onboard (which writes a static ONBOARDING.md) — this one is a
  conversation you can steer.
  Use when: "give me a walkthrough", "how does this codebase work", "walk me
  through the auth flow", "explain this subsystem", "how does a request flow
  through this", "onboard me to this repo". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
triggers:
  - give me a walkthrough
  - how does this codebase work
  - walk me through
  - explain this subsystem
  - onboard me to this repo
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

This is an interactive tour, not a document generator. The goal is for the reader
to leave with a mental model they can navigate on their own. If they want a
written artifact to keep, that's `/onboard`; point them there and offer to run it
after.

Read CLAUDE.md and any README for the project's own description of itself before
you start mapping. The maintainers' framing beats one you reverse-engineer.

## Step 1: Scope the tour

If the repo is large, don't try to narrate the whole thing. Ask what to focus on:
a subsystem (auth, billing, the request pipeline), a single feature end-to-end, or
a high-level "how does this whole thing fit together" overview. Also calibrate the
reader's level (beginner / intermediate / advanced) so you know how much to assume.

Get a quick sense of size and shape before deciding:

```bash
# Top-level layout and rough size
ls -la
git ls-files 2>/dev/null | sed 's@/.*@@' | sort | uniq -c | sort -rn | head -20

# Languages / stack signals
ls package.json Cargo.toml go.mod pyproject.toml Gemfile pom.xml 2>/dev/null
```

## Step 2: Find the entry points

Every codebase has doors you come in through. Locate them before telling the story:

```bash
# Executables, servers, main functions, route registration
grep -rniE "def main|func main|if __name__|app\.(get|post|listen)|createServer|addEventListener\(.DOMContentLoaded|export default" \
  --include="*.py" --include="*.go" --include="*.ts" --include="*.js" --include="*.rb" --include="*.rs" . 2>/dev/null | grep -v ".git/\|test\|spec" | head -30

# Config that declares entry points (scripts, bin, start commands)
grep -nE '"main"|"bin"|"scripts"|"start"' package.json 2>/dev/null | head -20
```

Name the doors: the CLI command, the HTTP server boot, the background worker, the
build entry. These anchor everything that follows.

## Step 3: Trace one path through the system

The clearest way to teach a codebase is to follow a single real path end to end,
not to describe every layer in the abstract. Pick the most representative flow for
the scoped area (e.g. "an incoming request for X" or "the CLI `foo` command") and
walk it hop by hop.

Use Read to open each file and Grep to follow the call chain to the next hop:

```bash
# Follow a symbol to its definition and its callers
grep -rn "functionName" --include="*.ext" . 2>/dev/null | grep -v ".git/" | head -20
```

Narrate the flow as a numbered sequence: request enters here, gets validated
there, hits this handler, touches this data layer, returns through here. Name the
`file:line` at each hop so the reader can open it themselves.

## Step 4: Draw the mental model

Step back from the specific path and give the model that makes the rest of the
code predictable. What are the 3-6 core concepts or components, how do they relate,
and what's the one organizing idea. A short ASCII sketch of the layers or the data
flow often lands better than paragraphs. Keep it to the abstractions that actually
recur in this codebase, not generic architecture.

## Step 5: Point out the key files

List the 5-10 files that matter most for the scoped area, each with one line on
what it owns and why the reader will keep coming back to it. Distinguish the files
you edit often from the ones you rarely touch but must understand. Skip generated
files and vendored code.

## Step 6: Call out the gotchas

The things that would cost a newcomer an afternoon. Look for and surface:

- Non-obvious coupling (change A, B breaks, and nothing says so).
- Naming that misleads (a "Manager" that's actually a queue, a "temporary"
  workaround that's load-bearing).
- Global state, singletons, or init order that has to happen just so.
- Conventions the code assumes but never documents.

Pull real examples from the code you just read, with `file:line`. If CLAUDE.md or
comments already warn about something, echo it — those warnings exist for a reason.

## Step 7: Hand off

Close with where to go next: the natural first change a newcomer could make safely,
the test command to verify they didn't break anything (from CLAUDE.md), and an
offer to zoom into any part of the tour or run `/onboard` to capture it as a doc.
Invite the reader to point at a piece they want to go deeper on — the tour is
theirs to steer.
