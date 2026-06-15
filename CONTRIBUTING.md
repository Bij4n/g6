# Contributing to g6

Thanks for wanting to make g6 better. Whether you're fixing a typo in a skill prompt or building an entirely new workflow, this guide will get you up and running fast.

## Quick start

g6 skills are Markdown files that Claude Code discovers from a `skills/` directory. Normally they live at `~/.claude/skills/g6/` (your global install). But when you're developing g6 itself, you want Claude Code to use the skills *in your working tree* — so edits take effect instantly without copying or deploying anything.

That's what dev mode does. It symlinks your repo into the local `.claude/skills/` directory so Claude Code reads skills straight from your checkout.

```bash
git clone https://github.com/Bij4n/g6.git && cd g6
bun install                    # install dependencies
bin/dev-setup                  # activate dev mode
```

> **Full clone vs shallow.** The README's user-facing install uses `--depth 1` for speed. As a contributor, use a full clone (no `--depth` flag) — you'll need history for `git log`, `git blame`, `git bisect`, and reviewing PRs against earlier versions. If you already have a `--depth 1` clone from following the README, promote it to a full clone with `git fetch --unshallow`.

Now edit any `SKILL.md`, invoke it in Claude Code (e.g. `/review`), and see your changes live. When you're done developing:

```bash
bin/dev-teardown               # deactivate — back to your global install
```

## Operational self-improvement

g6 automatically learns from failures. At the end of every skill session, the agent
reflects on what went wrong (CLI errors, wrong approaches, project quirks) and logs
operational learnings to `~/.gstack/projects/{slug}/learnings.jsonl`. Future sessions
surface these learnings automatically, so g6 gets smarter on your codebase over time.

No setup needed. Learnings are logged automatically. View them with `/learn`.

### The contributor workflow

1. **Use g6 normally** — operational learnings are captured automatically
2. **Check your learnings:** `/learn` or `ls ~/.gstack/projects/*/learnings.jsonl`
3. **Fork and clone g6** (if you haven't already)
4. **Symlink your fork into the project where you hit the bug:**
   ```bash
   # In your core project (the one where g6 annoyed you)
   ln -sfn /path/to/your/g6-fork .claude/skills/g6
   cd .claude/skills/g6 && bun install && bun run build && ./setup
   ```
   Setup creates per-skill directories with SKILL.md symlinks inside (`qa/SKILL.md -> gstack/qa/SKILL.md`)
   and asks your prefix preference. Pass `--no-prefix` to skip the prompt and use short names.
5. **Fix the issue** — your changes are live immediately in this project
6. **Test by actually using g6** — do the thing that annoyed you, verify it's fixed
7. **Open a PR from your fork**

This is the best way to contribute: fix g6 while doing your real work, in the
project where you actually felt the pain.

### Session awareness

When you have 3+ g6 sessions open simultaneously, every question tells you which project, which branch, and what's happening. No more staring at a question thinking "wait, which window is this?" The format is consistent across all skills.

## Working on g6 inside the g6 repo

When you're editing g6 skills and want to test them by actually using g6
in the same repo, `bin/dev-setup` wires this up. It creates `.claude/skills/`
symlinks (gitignored) pointing back to your working tree, so Claude Code uses
your local edits instead of the global install.

```
gstack/                          <- your working tree
├── .claude/skills/              <- created by dev-setup (gitignored)
│   ├── gstack -> ../../         <- symlink back to repo root
│   ├── review/                  <- real directory (short name, default)
│   │   └── SKILL.md -> gstack/review/SKILL.md
│   ├── ship/                    <- or gstack-review/, gstack-ship/ if --prefix
│   │   └── SKILL.md -> gstack/ship/SKILL.md
│   └── ...                      <- one directory per skill
├── review/
│   └── SKILL.md                 <- edit this, test with /review
├── ship/
│   └── SKILL.md
├── browse/
│   ├── src/                     <- TypeScript source
│   └── dist/                    <- compiled binary (gitignored)
└── ...
```

Setup creates real directories (not symlinks) at the top level with a SKILL.md
symlink inside. This ensures Claude discovers them as top-level skills, not nested
under `gstack/`. Names depend on your prefix setting (`~/.gstack/config.yaml`).
Short names (`/review`, `/ship`) are the default. Run `./setup --prefix` if you
prefer namespaced names (`/gstack-review`, `/gstack-ship`).

## Day-to-day workflow

```bash
# 1. Enter dev mode
bin/dev-setup

# 2. Edit a skill
vim review/SKILL.md

# 3. Test it in Claude Code — changes are live
#    > /review

# 4. Editing browse source? Rebuild the binary
bun run build

# 5. Done for the day? Tear down
bin/dev-teardown
```

## Testing & evals

### Setup

```bash
# 1. Copy .env.example and add your API key
cp .env.example .env
# Edit .env → set ANTHROPIC_API_KEY=sk-ant-...

# 2. Install deps (if you haven't already)
bun install
```

Bun auto-loads `.env` — no extra config. Conductor workspaces inherit `.env` from the main worktree automatically (see "Conductor workspaces" below).

### Test tiers

| Tier | Command | Cost | What it tests |
|------|---------|------|---------------|
| 1 — Static | `bun test` | Free | Command validation, snapshot flags, SKILL.md correctness, TODOS-format.md refs, observability unit tests |
| 2 — E2E | `bun run test:e2e` | ~$3.85 | Full skill execution via `claude -p` subprocess |
| 3 — LLM eval | `bun run test:evals` | ~$0.15 standalone | LLM-as-judge scoring of generated SKILL.md docs |
| 2+3 | `bun run test:evals` | ~$4 combined | E2E + LLM-as-judge (runs both) |

```bash
bun test                     # Tier 1 only (runs on every commit, <5s)
bun run test:e2e             # Tier 2: E2E only (needs EVALS=1, can't run inside Claude Code)
bun run test:evals           # Tier 2 + 3 combined (~$4/run)
```

### Tier 1: Static validation (free)

Runs automatically with `bun test`. No API keys needed.

- **Skill parser tests** (`test/skill-parser.test.ts`) — Extracts every `$B` command from SKILL.md bash code blocks and validates against the command registry in `browse/src/commands.ts`. Catches typos, removed commands, and invalid snapshot flags.
- **Skill validation tests** (`test/skill-validation.test.ts`) — Validates that SKILL.md files reference only real commands and flags, and that command descriptions meet quality thresholds.
- **Generator tests** (`test/gen-skill-docs.test.ts`) — Tests the template system: verifies placeholders resolve correctly, output includes value hints for flags (e.g. `-d <N>` not just `-d`), enriched descriptions for key commands (e.g. `is` lists valid states, `press` lists key examples).

### Tier 2: E2E via `claude -p` (~$3.85/run)

Spawns `claude -p` as a subprocess with `--output-format stream-json --verbose`, streams NDJSON for real-time progress, and scans for browse errors. This is the closest thing to "does this skill actually work end-to-end?"

```bash
# Must run from a plain terminal — can't nest inside Claude Code or Conductor
EVALS=1 bun test test/skill-e2e-*.test.ts
```

- Gated by `EVALS=1` env var (prevents accidental expensive runs)
- Auto-skips if running inside Claude Code (`claude -p` can't nest)
- API connectivity pre-check — fails fast on ConnectionRefused before burning budget
- Real-time progress to stderr: `[Ns] turn T tool #C: Name(...)`
- Saves full NDJSON transcripts and failure JSON for debugging
- Tests live in `test/skill-e2e-*.test.ts` (split by category), runner logic in `test/helpers/session-runner.ts`

### E2E observability

When E2E tests run, they produce machine-readable artifacts in `~/.gstack-dev/`:

| Artifact | Path | Purpose |
|----------|------|---------|
| Heartbeat | `e2e-live.json` | Current test status (updated per tool call) |
| Partial results | `evals/_partial-e2e.json` | Completed tests (survives kills) |
| Progress log | `e2e-runs/{runId}/progress.log` | Append-only text log |
| NDJSON transcripts | `e2e-runs/{runId}/{test}.ndjson` | Raw `claude -p` output per test |
| Failure JSON | `e2e-runs/{runId}/{test}-failure.json` | Diagnostic data on failure |

**Live dashboard:** Run `bun run eval:watch` in a second terminal to see a live dashboard showing completed tests, the currently running test, and cost. Use `--tail` to also show the last 10 lines of progress.log.

**Eval history tools:**

```bash
bun run eval:list            # list all eval runs (turns, duration, cost per run)
bun run eval:compare         # compare two runs — shows per-test deltas + Takeaway commentary
bun run eval:summary         # aggregate stats + per-test efficiency averages across runs
```

**Eval comparison commentary:** `eval:compare` generates natural-language Takeaway sections interpreting what changed between runs — flagging regressions, noting improvements, calling out efficiency gains (fewer turns, faster, cheaper), and producing an overall summary. This is driven by `generateCommentary()` in `eval-store.ts`.

Artifacts are never cleaned up — they accumulate in `~/.gstack-dev/` for post-mortem debugging and trend analysis.

### Tier 3: LLM-as-judge (~$0.15/run)

Uses Claude Sonnet to score generated SKILL.md docs on three dimensions:

- **Clarity** — Can an AI agent understand the instructions without ambiguity?
- **Completeness** — Are all commands, flags, and usage patterns documented?
- **Actionability** — Can the agent execute tasks using only the information in the doc?

Each dimension is scored 1-5. Threshold: every dimension must score **≥ 4**. There's also a regression test that compares generated docs against the hand-maintained baseline from `origin/main` — generated must score equal or higher.

```bash
# Needs ANTHROPIC_API_KEY in .env — included in bun run test:evals
```

- Uses `claude-sonnet-4-6` for scoring stability
- Tests live in `test/skill-llm-eval.test.ts`
- Calls the Anthropic API directly (not `claude -p`), so it works from anywhere including inside Claude Code

### CI

A GitHub Action (`.github/workflows/skill-docs.yml`) runs `bun run gen:skill-docs --dry-run` on every push and PR. If the generated SKILL.md files differ from what's committed, CI fails. This catches stale docs before they merge.

Tests run against the browse binary directly — they don't require dev mode.

## Editing SKILL.md files

SKILL.md files are **generated** from `.tmpl` templates. Don't edit the `.md` directly — your changes will be overwritten on the next build.

```bash
# 1. Edit the template
vim SKILL.md.tmpl              # or browse/SKILL.md.tmpl

# 2. Regenerate for all hosts
bun run gen:skill-docs --host all

# 3. Check health (reports all hosts)
bun run skill:check

# Or use watch mode — auto-regenerates on save
bun run dev:skill
```

For template authoring best practices (natural language over bash-isms, dynamic branch detection, `{{BASE_BRANCH_DETECT}}` usage), see CLAUDE.md's "Writing SKILL templates" section.

To add a browse command, add it to `browse/src/commands.ts`. To add a snapshot flag, add it to `SNAPSHOT_FLAGS` in `browse/src/snapshot.ts`. Then rebuild.

## Jargon list (V1 writing style)

gstack's Writing Style section (injected into every tier-≥2 skill's preamble)
glosses technical terms on first use per skill invocation. The list of terms
that qualify for glossing lives at `scripts/jargon-list.json` — ~50 curated
high-frequency terms (idempotent, race condition, N+1, backpressure, etc.).
Terms not on the list are assumed plain-English enough.

**Adding or removing a term:** open a PR editing `scripts/jargon-list.json`.
Run `bun run gen:skill-docs` after the edit — terms are baked into every
generated SKILL.md at gen time, so changes take effect only after regeneration.
No runtime loading; no user-side override. The repo list is the source of truth.

Good candidates for addition: high-frequency terms that non-technical users
encounter in review output without context (common database/concurrency
terminology, security jargon, frontend framework concepts). Don't add terms
that only appear in one or two niche skills — the cost-to-value trade isn't
worth the review overhead.

## Multi-host development

gstack generates SKILL.md files for 8 hosts from one set of `.tmpl` templates.
Each host is a typed config in `hosts/*.ts`. The generator reads these configs
to produce host-appropriate output (different frontmatter, paths, tool names).

**Supported hosts:** Claude (primary), Codex, Factory, Kiro, OpenCode, Slate, Cursor, OpenClaw.

### Generating for all hosts

```bash
# Generate for a specific host
bun run gen:skill-docs                    # Claude (default)
bun run gen:skill-docs --host codex       # Codex
bun run gen:skill-docs --host opencode    # OpenCode
bun run gen:skill-docs --host all         # All 8 hosts

# Or use build, which does all hosts + compiles binaries
bun run build
```

### What changes between hosts

Each host config (`hosts/*.ts`) controls:

| Aspect | Example (Claude vs Codex) |
|--------|---------------------------|
| Output directory | `{skill}/SKILL.md` vs `.agents/skills/gstack-{skill}/SKILL.md` |
| Frontmatter | Full (name, description, hooks, version) vs minimal (name + description) |
| Paths | `~/.claude/skills/g6` vs `$GSTACK_ROOT` |
| Tool names | "use the Bash tool" vs same (Factory rewrites to "run this command") |
| Hook skills | `hooks:` frontmatter vs inline safety advisory prose |
| Suppressed sections | None vs Codex self-invocation sections stripped |

See `scripts/host-config.ts` for the full `HostConfig` interface.

### Testing host output

```bash
# Run all static tests (includes parameterized smoke tests for all hosts)
bun test

# Check freshness for all hosts
bun run gen:skill-docs --host all --dry-run

# Health dashboard covers all hosts
bun run skill:check
```

### Adding a new host

See [docs/ADDING_A_HOST.md](docs/ADDING_A_HOST.md) for the full guide. Short version:

1. Create `hosts/myhost.ts` (copy from `hosts/opencode.ts`)
2. Add to `hosts/index.ts`
3. Add `.myhost/` to `.gitignore`
4. Run `bun run gen:skill-docs --host myhost`
5. Run `bun test` (parameterized tests auto-cover it)

Zero generator, setup, or tooling code changes needed.

### Adding a new skill

When you add a new skill template, all hosts get it automatically:
1. Create `{skill}/SKILL.md.tmpl`
2. Run `bun run gen:skill-docs --host all`
3. The dynamic template discovery picks it up, no static list to update
4. Commit `{skill}/SKILL.md`, external host output is generated at setup time and gitignored

## Conductor workspaces

If you're using [Conductor](https://conductor.build) to run multiple Claude Code sessions in parallel, `conductor.json` wires up workspace lifecycle automatically:

| Hook | Script | What it does |
|------|--------|-------------|
| `setup` | `bin/dev-setup` | Copies `.env` from main worktree, installs deps, symlinks skills |
| `archive` | `bin/dev-teardown` | Removes skill symlinks, cleans up `.claude/` directory |

When Conductor creates a new workspace, `bin/dev-setup` runs automatically. It detects the main worktree (via `git worktree list`), copies your `.env` so API keys carry over, and sets up dev mode — no manual steps needed.

**First-time setup:** Put your `ANTHROPIC_API_KEY` in `.env` in the main repo (see `.env.example`). Every Conductor workspace inherits it automatically.

**`GSTACK_*` env prefix (Conductor-injected keys).** Conductor explicitly strips `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from every workspace's process env. The `.env` copy path doesn't restore them either — the strip happens after env inheritance. Users who want paid evals, `/sync-gbrain` embeddings, or `claude-agent-sdk` calls to work in a Conductor workspace must set `GSTACK_ANTHROPIC_API_KEY` and `GSTACK_OPENAI_API_KEY` in Conductor's workspace env config; Conductor passes those through untouched. On the gstack side, TS entry points import `lib/conductor-env-shim.ts` as a side effect, which promotes `GSTACK_FOO_API_KEY` to `FOO_API_KEY` when the canonical name is empty. If you add a new TS entry point that hits a paid API, add `import "../lib/conductor-env-shim";` to the top of the file. Today the shim is imported from `bin/gstack-gbrain-sync.ts`, `bin/gstack-model-benchmark`, `scripts/preflight-agent-sdk.ts`, and `test/helpers/e2e-helpers.ts`.

## Things to know

- **SKILL.md files are generated.** Edit the `.tmpl` template, not the `.md`. Run `bun run gen:skill-docs` to regenerate.
- **TODOS.md is the unified backlog.** Organized by skill/component with P0-P4 priorities. `/ship` auto-detects completed items. All planning/review/retro skills read it for context.
- **Browse source changes need a rebuild.** If you touch `browse/src/*.ts`, run `bun run build`.
- **Dev mode shadows your global install.** Project-local skills take priority over `~/.claude/skills/g6`. `bin/dev-teardown` restores the global one.
- **Conductor workspaces are independent.** Each workspace is its own git worktree. `bin/dev-setup` runs automatically via `conductor.json`.
- **`.env` propagates across worktrees.** Set it once in the main repo, all Conductor workspaces get it.
- **`.claude/skills/` is gitignored.** The symlinks never get committed.
- **Never write raw `ln -snf` in `setup`.** Every link site in `setup` MUST route through the `_link_or_copy SRC DST` helper near the `IS_WINDOWS` detection. The helper preserves `ln -snf` on Unix and switches to `cp -R` / `cp -f` on Windows without Developer Mode, where plain `ln -snf` produces frozen file copies that don't refresh on `git pull`. `test/setup-windows-fallback.test.ts` enforces this with a static invariant — a single raw `ln` call outside the helper body fails CI.

## Testing your changes in a real project

**This is the recommended way to develop g6.** Symlink your g6 checkout
into the project where you actually use it, so your changes are live while you
do real work.

### Step 1: Symlink your checkout

```bash
# In your core project (not the g6 repo)
ln -sfn /path/to/your/g6-checkout .claude/skills/g6
```

### Step 2: Run setup to create per-skill symlinks

The `gstack` symlink alone isn't enough. Claude Code discovers skills through
individual top-level directories (`qa/SKILL.md`, `ship/SKILL.md`, etc.), not through
the `gstack/` directory itself. Run `./setup` to create them:

```bash
cd .claude/skills/g6 && bun install && bun run build && ./setup
```

Setup will ask whether you want short names (`/qa`) or namespaced (`/gstack-qa`).
Your choice is saved to `~/.gstack/config.yaml` and remembered for future runs.
To skip the prompt, pass `--no-prefix` (short names) or `--prefix` (namespaced).

### Step 3: Develop

Edit a template, run `bun run gen:skill-docs`, and the next `/review` or `/qa`
call picks it up immediately. No restart needed.

### Going back to the stable global install

Remove the project-local symlink. Claude Code falls back to `~/.claude/skills/g6/`:

```bash
rm .claude/skills/g6
```

The per-skill directories (`qa/`, `ship/`, etc.) contain SKILL.md symlinks that point
to `gstack/...`, so they'll resolve to the global install automatically.

### Switching prefix mode

If you installed g6 with one prefix setting and want to switch:

```bash
cd .claude/skills/g6 && ./setup --no-prefix   # switch to /qa, /ship
cd .claude/skills/g6 && ./setup --prefix       # switch to /gstack-qa, /gstack-ship
```

Setup cleans up the old symlinks automatically. No manual cleanup needed.

### Alternative: point your global install at a branch

If you don't want per-project symlinks, you can switch the global install:

```bash
cd ~/.claude/skills/g6
git fetch origin
git checkout origin/<branch>
bun install && bun run build && ./setup
```

This affects all projects. To revert: `git checkout main && git pull && bun run build && ./setup`.

## Community PR triage (wave process)

When community PRs accumulate, batch them into themed waves:

1. **Categorize** — group by theme (security, features, infra, docs)
2. **Deduplicate** — if two PRs fix the same thing, pick the one that
   changes fewer lines. Close the other with a note pointing to the winner.
3. **Collector branch** — create `pr-wave-N`, merge clean PRs, resolve
   conflicts for dirty ones, verify with `bun test && bun run build`
4. **Close with context** — every closed PR gets a comment explaining
   why and what (if anything) supersedes it. Contributors did real work;
   respect that with clear communication.
5. **Ship as one PR** — single PR to main with all attributions preserved
   in merge commits. Include a summary table of what merged and what closed.

See [PR #205](../../pull/205) (v0.8.3) for the first wave as an example.

## Upgrade migrations

When a release changes on-disk state (directory structure, config format, stale
files) in ways that `./setup` alone can't fix, add a migration script so existing
users get a clean upgrade.

### When to add a migration

- Changed how skill directories are created (symlinks vs real dirs)
- Renamed or moved config keys in `~/.gstack/config.yaml`
- Need to delete orphaned files from a previous version
- Changed the format of `~/.gstack/` state files

Don't add a migration for: new features (users get them automatically), new
skills (setup discovers them), or code-only changes (no on-disk state).

### How to add one

1. Create `gstack-upgrade/migrations/v{VERSION}.sh` where `{VERSION}` matches
   the VERSION file for the release that needs the fix.
2. Make it executable: `chmod +x gstack-upgrade/migrations/v{VERSION}.sh`
3. The script must be **idempotent** (safe to run multiple times) and
   **non-fatal** (failures are logged but don't block the upgrade).
4. Include a comment block at the top explaining what changed, why the
   migration is needed, and which users are affected.

Example:

```bash
#!/usr/bin/env bash
# Migration: v0.15.2.0 — Fix skill directory structure
# Affected: users who installed with --no-prefix before v0.15.2.0
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
"$SCRIPT_DIR/bin/gstack-relink" 2>/dev/null || true
```

### How it runs

During `/gstack-upgrade`, after `./setup` completes (Step 4.75), the upgrade
skill scans `gstack-upgrade/migrations/` and runs every `v*.sh` script whose
version is newer than the user's old version. Scripts run in version order.
Failures are logged but never block the upgrade.

### Testing migrations

Migrations are tested as part of `bun test` (tier 1, free). The test suite
verifies that all migration scripts in `gstack-upgrade/migrations/` are
executable and parse without syntax errors.

## Shipping your changes

When you're happy with your skill edits:

```bash
/ship
```

This runs tests, reviews the diff, triages Greptile comments (with 2-tier escalation), manages TODOS.md, bumps the version, and opens a PR. See `ship/SKILL.md` for the full workflow.

## Slop-scan: AI code quality, not AI code hiding

We use [slop-scan](https://github.com/benvinegar/slop-scan) to catch patterns where
AI-generated code is genuinely worse than what a human would write. We are NOT trying
to pass as human code. We are AI-coded and proud of it. The goal is code quality.

```bash
npx slop-scan scan .          # human-readable report
npx slop-scan scan . --json   # machine-readable for diffing
```

Config: `slop-scan.config.json` at repo root (currently excludes `**/vendor/**`).

### What to fix (genuine quality improvements)

- **Empty catches around file ops** — use `safeUnlink()` (ignores ENOENT, rethrows
  EPERM/EIO). A swallowed EPERM in cleanup means silent data loss.
- **Empty catches around process kills** — use `safeKill()` (ignores ESRCH, rethrows
  EPERM). A swallowed EPERM means you think you killed something you didn't.
- **Redundant `return await`** — remove when there's no enclosing try block. Saves a
  microtask, signals intent.
- **Typed exception catches** — `catch (err) { if (!(err instanceof TypeError)) throw err }`
  is genuinely better than `catch {}` when the try block does URL parsing or DOM work.
  You know what error you expect, so say so.

### What NOT to fix (linter gaming, not quality)

- **String-matching on error messages** — `err.message.includes('closed')` is brittle.
  Playwright/Chrome can change wording anytime. If a fire-and-forget operation can fail
  for ANY reason and you don't care, `catch {}` is the correct pattern.
- **Adding comments to exempt pass-through wrappers** — "alias for active session" above
  a method just to trip slop-scan's exemption rule is noise, not documentation.
- **Converting extension catch-and-log to selective rethrow** — Chrome extensions crash
  entirely on uncaught errors. If the catch logs and continues, that IS the right pattern
  for extension code. Don't make it throw.
- **Tightening best-effort cleanup paths** — shutdown, emergency cleanup, and disconnect
  code should use `safeUnlinkQuiet()` (swallows ALL errors). A cleanup path that throws
  on EPERM means the rest of cleanup doesn't run. That's worse.

### Utilities in `browse/src/error-handling.ts`

| Function | Use when | Behavior |
|----------|----------|----------|
| `safeUnlink(path)` | Normal file deletion | Ignores ENOENT, rethrows others |
| `safeUnlinkQuiet(path)` | Shutdown/emergency cleanup | Swallows all errors |
| `safeKill(pid, signal)` | Sending signals | Ignores ESRCH, rethrows others |
| `isProcessAlive(pid)` | Boolean process checks | Returns true/false, never throws |

### Score tracking

Baseline (2026-04-09, before cleanup): 100 findings, 432.8 score, 2.38 score/file.
After cleanup: 90 findings, 358.1 score, 1.96 score/file.

Don't chase the number. Fix patterns that represent actual code quality problems.
Accept findings where the "sloppy" pattern is the correct engineering choice.

## CHANGELOG + VERSION style

**Versioning invariant (workspace-aware ship).** VERSION is a monotonic ordered
release identifier, not a strict semver commitment. The bump level
(major/minor/patch/micro) expresses intent at ship time. Queue-advancing past a
claimed version within the same bump level is explicitly permitted — if branch A
claims v1.7.0.0 as a MINOR and branch B is also a MINOR, B lands at v1.8.0.0
(still a MINOR relative to main). Downstream consumers must NOT rely on
"MINOR = feature-only, PATCH = fix-only" as a strict contract. This is why
`bin/gstack-next-version` advances within the chosen bump level rather than
repicking the level when collisions happen.

**Scale-aware bumps — use common sense.** When the diff is big, bump MINOR (or
MAJOR), not PATCH. PATCH is for bug fixes and small additions; MINOR is for
substantial new capability or substantial reduction; MAJOR is for breaking
changes. Rough guideposts (don't treat as rules, treat as smell-checks):

- **PATCH (X.Y.Z+1.0)**: bug fix, doc tweak, small additive change, single
  test/file added. Net diff under ~500 lines, no new user-facing capability.
- **MINOR (X.Y+1.0.0)**: new capability shipped (skill, harness, command, big
  refactor), substantial code reduction (compression, migration), or coordinated
  multi-file change. Net diff over ~2000 lines added/removed, OR a user-visible
  feature you'd put in a tweet.
- **MAJOR (X+1.0.0.0)**: breaking change to public surface (CLI flag rename,
  skill removed, config format changed), OR a release big enough to be the
  headline of a blog post.

If you find yourself debating "is 10K added + 24K removed really a PATCH?" — it
isn't. Bump MINOR. Same for "this adds a whole new test harness with 6 new E2E
tests + helper utilities" — MINOR. The bump level is communication to the user
about what kind of release this is; don't undersell it.

When merging origin/main brings a higher VERSION, re-evaluate the bump level
against the SCALE of your branch's work, not just whether main moved forward.
If main bumped MINOR and your branch is also a substantial change, you bump
MINOR again on top (e.g., main at v1.14.0.0, your branch lands v1.15.0.0).

**VERSION and CHANGELOG are branch-scoped.** Every feature branch that ships gets its
own version bump and CHANGELOG entry. The entry describes what THIS branch adds —
not what was already on main.

**The CHANGELOG entry is the diff between main and the shipping branch — what users
get when they upgrade. NOT how the branch got there.** A reader landing on the entry
should learn what they can do now that they couldn't before; they should not learn
about the branch's internal version bumps, the bugs we caught and fixed mid-branch,
the plan reviews we ran, or the commits we squashed. That is branch development
narrative. It belongs in PR descriptions and commit messages, not CHANGELOG.

**Never reference branch-internal versions in a CHANGELOG entry.** If your branch
bumped VERSION from v1.5.0.0 → v1.5.1.0 → v1.6.0.0 during development and only the
final v1.6.0.0 ships to main, the entry must read as if v1.5.1.0 never existed.
Concretely, NEVER write:
- "v1.5.1.0 had a bug that v1.6.0.0 fixes" — readers don't know about v1.5.1.0; it's
  a branch-internal artifact.
- "The shipping headline of v1.5.1.0 was broken because..." — same reason. From main's
  perspective, v1.5.1.0 was never released.
- "Pre-fix tests encoded the broken behavior" — that's a contributor's victory lap,
  not a user benefit.
- "Two surgical edits, both in the dispatch path" — micro-narrative of the patch.

Instead, describe the released system: "Browser-skills run end-to-end with the
expected tab-access semantics." If a property of the shipped system is worth calling
out (e.g., "skill spawns get permissive tab access; pair-agent tunnel tokens require
ownership"), document it as a property, not as a fix. The shipped system is what
the user gets; the path to that system is invisible to them.

**When to write the CHANGELOG entry:**
- At `/ship` time (Step 13), not during development or mid-branch.
- The entry covers ALL commits on this branch vs the base branch.
- Never fold new work into an existing CHANGELOG entry from a prior version that
  already landed on main. If main has v0.10.0.0 and your branch adds features,
  bump to v0.10.1.0 with a new entry — don't edit the v0.10.0.0 entry.

**Key questions before writing:**
1. What branch am I on? What did THIS branch change?
2. Is the base branch version already released? (If yes, bump and create new entry.)
3. Does an existing entry on this branch already cover earlier work? (If yes, replace
   it with one unified entry for the final version.)

**Merging main does NOT mean adopting main's version.** When you merge origin/main into
a feature branch, main may bring new CHANGELOG entries and a higher VERSION. Your branch
still needs its OWN version bump on top. If main is at v0.13.8.0 and your branch adds
features, bump to v0.13.9.0 with a new entry. Never jam your changes into an entry that
already landed on main. Your entry goes on top because your branch lands next.

**After merging main, always check:**
- Does CHANGELOG have your branch's own entry separate from main's entries?
- Is VERSION higher than main's VERSION?
- Is your entry the topmost entry in CHANGELOG (above main's latest)?
If any answer is no, fix it before continuing.

**After any CHANGELOG edit that moves, adds, or removes entries,** immediately run
`grep "^## \[" CHANGELOG.md` to verify no duplicates and a sensible reverse-chronological
order. Gaps between version numbers are fine. A branch that ships at v1.6.4.0 without
a prior v1.5.2.0 or v1.5.3.0 entry on main is correct — those were branch-internal
version numbers that never landed. Do not back-fill gaps with placeholder entries.

**Never orphan branch-internal versions.** If your branch bumped VERSION several times
during development (v1.5.1.0 → v1.5.2.0 → v1.6.4.0, say) and those earlier entries were
never released to main, the final ship consolidates ALL of them into a single entry at
the final version (v1.6.4.0). Collapse them — delete the old entries and move their
content into the final entry, re-version table columns accordingly. Readers see one
release, not a branch diary. Gaps are fine (v1.6.3.0 → v1.6.4.0 with no v1.5.x
in between on main is correct).

CHANGELOG.md is **for users**, not contributors. Write it like product release notes:

- Lead with what the user can now **do** that they couldn't before. Sell the feature.
- Use plain language, not implementation details. "You can now..." not "Refactored the..."
- **Never mention TODOS.md, internal tracking, eval infrastructure, or contributor-facing
  details.** These are invisible to users and meaningless to them.
- Put contributor/internal changes in a separate "For contributors" section at the bottom.
- Every entry should make someone think "oh nice, I want to try that."
- No jargon: say "every question now tells you which project and branch you're in" not
  "AskUserQuestion format standardized across skill templates via preamble resolver."

**Only document what shipped between main and this change.** Readers do not care how
we got here. Keep out of the CHANGELOG, always:

- Branch resyncs, merge commits with main, rebase activity.
- Plan approvals, review outcomes (CEO / eng / design / outside-voice / codex findings),
  AskUserQuestion decisions, scope negotiations.
- "Work queued," "plan approved," "in-progress," "will ship later" — the CHANGELOG
  documents what DID ship, not what MIGHT ship.
- Version-bump housekeeping when no user-facing work actually landed.

If the diff between the base branch version and this version has no user-facing change
(only merges, only CHANGELOG edits, only placeholder work), the honest entry is one
sentence: "Version bump for branch-ahead discipline. No user-facing changes yet." Stop
there. Do not pad. Do not explain the plan that will ship eventually. Do not narrate
the branch's history. When real work lands, the entry will replace this at /ship time.

### Release-summary format (every `## [X.Y.Z]` entry)

Every version entry in `CHANGELOG.md` MUST start with a release-summary section in
the GStack/Garry voice, one viewport's worth of prose + tables that lands like a
verdict, not marketing. The itemized changelog (subsections, bullets, files) goes
BELOW that summary, separated by a `### Itemized changes` header.

The release-summary section gets read by humans, by the auto-update agent, and by
anyone deciding whether to upgrade. The itemized list is for agents that need to
know exactly what changed.

Structure for the top of every `## [X.Y.Z]` entry:

1. **Two-line bold headline** (10-14 words total). Should land like a verdict, not
   marketing. Sound like someone who shipped today and cares whether it works.
2. **Lead paragraph** (3-5 sentences). What shipped, what changed for the user.
   Specific, concrete, no AI vocabulary, no em dashes, no hype.
3. **A "The X numbers that matter" section** with:
   - One short setup paragraph naming the source of the numbers (real production
     deployment OR a reproducible benchmark, name the file/command to run).
   - A table of 3-6 key metrics with BEFORE / AFTER / Δ columns.
   - A second optional table for per-category breakdown if relevant.
   - 1-2 sentences interpreting the most striking number in concrete user terms.
4. **A "What this means for [audience]" closing paragraph** (2-4 sentences) tying
   the metrics to a real workflow shift. End with what to do.

Voice rules for the release summary:
- No em dashes (use commas, periods, "...").
- No AI vocabulary (delve, robust, comprehensive, nuanced, fundamental, etc.) or
  banned phrases ("here's the kicker", "the bottom line", etc.).
- Real numbers, real file names, real commands. Not "fast" but "~30s on 30K pages."
- Short paragraphs, mix one-sentence punches with 2-3 sentence runs.
- Connect to user outcomes: "the agent does ~3x less reading" beats "improved precision."
- Be direct about quality. "Well-designed" or "this is a mess." No dancing.

Source material:
- CHANGELOG previous entry for prior context.
- Benchmark files or `/retro` output for headline numbers.
- Recent commits (`git log <prev-version>..HEAD --oneline`) for what shipped.
- Don't make up numbers. If a metric isn't in a benchmark or production data,
  don't include it. Say "no measurement yet" if asked.

Target length: ~250-350 words for the summary. Should render as one viewport.

### Itemized changes (below the release summary)

Write `### Itemized changes` and continue with the detailed subsections (Added,
Changed, Fixed, For contributors). Same rules as the user-facing voice guidance
above, plus:

- **Always credit community contributions.** When an entry includes work from a
  community PR, name the contributor with `Contributed by @username`. Contributors
  did real work. Thank them publicly every time, no exceptions.
