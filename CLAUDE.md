# gstack development

## Commands

```bash
bun install          # install dependencies
bun test             # run free tests (browse + snapshot + skill validation)
bun run test:evals   # run paid evals: LLM judge + E2E (diff-based, ~$4/run max)
bun run test:evals:all  # run ALL paid evals regardless of diff
bun run test:gate    # run gate-tier tests only (CI default, blocks merge)
bun run test:periodic  # run periodic-tier tests only (weekly cron / manual)
bun run test:e2e     # run E2E tests only (diff-based, ~$3.85/run max)
bun run test:e2e:all # run ALL E2E tests regardless of diff
bun run eval:select  # show which tests would run based on current diff
bun run dev <cmd>    # run CLI in dev mode, e.g. bun run dev goto https://example.com
bun run build        # gen docs + compile binaries
bun run gen:skill-docs  # regenerate SKILL.md files from templates
bun run skill:check  # health dashboard for all skills
bun run dev:skill    # watch mode: auto-regen + validate on change
bun run eval:list    # list all eval runs from ~/.gstack-dev/evals/
bun run eval:compare # compare two eval runs (auto-picks most recent)
bun run eval:summary # aggregate stats across all eval runs
bun run slop          # full slop-scan report (all files)
bun run slop:diff     # slop findings in files changed on this branch only
```

`test:evals` requires `ANTHROPIC_API_KEY`. Codex E2E tests (`test/codex-e2e.test.ts`)
use Codex's own auth from `~/.codex/` config — no `OPENAI_API_KEY` env var needed.

**Where the keys live on this machine.** Conductor workspaces don't inherit the
user's interactive shell env, so `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` aren't
in the default process env. Before running any paid eval / E2E, source them from
`~/.zshrc` (that's where Garry keeps them):

```bash
bash -c '
  eval "$(grep -E "^export (ANTHROPIC_API_KEY|OPENAI_API_KEY)=" ~/.zshrc)"
  export ANTHROPIC_API_KEY OPENAI_API_KEY
  EVALS=1 EVALS_TIER=periodic bun test test/skill-e2e-<whatever>.test.ts
'
```

Do not echo the key value anywhere (stdout, logs, shell history). The grep+eval
pattern keeps it in process env only. When passing to a test's Agent SDK, do NOT
pass `env: {...}` to `runAgentSdkTest` — the SDK's auth pipeline doesn't pick up
the key the same way when env is supplied as an object (confirmed failure mode).
Instead, mutate `process.env.ANTHROPIC_API_KEY` ambiently before the call and
restore in `finally`.
E2E tests stream progress in real-time (tool-by-tool via `--output-format stream-json
--verbose`). Results are persisted to `~/.gstack-dev/evals/` with auto-comparison
against the previous run.

**Diff-based test selection:** `test:evals` and `test:e2e` auto-select tests based
on `git diff` against the base branch. Each test declares its file dependencies in
`test/helpers/touchfiles.ts`. Changes to global touchfiles (session-runner, eval-store,
touchfiles.ts itself) trigger all tests. Use `EVALS_ALL=1` or the `:all` script
variants to force all tests. Run `eval:select` to preview which tests would run.

**Two-tier system:** Tests are classified as `gate` or `periodic` in `E2E_TIERS`
(in `test/helpers/touchfiles.ts`). CI runs only gate tests (`EVALS_TIER=gate`);
periodic tests run weekly via cron or manually. Use `EVALS_TIER=gate` or
`EVALS_TIER=periodic` to filter. When adding new E2E tests, classify them:
1. Safety guardrail or deterministic functional test? -> `gate`
2. Quality benchmark, Opus model test, or non-deterministic? -> `periodic`
3. Requires external service (Codex, Gemini)? -> `periodic`

## Testing

```bash
bun run test         # run before every commit — free, ~5-6 min, ~4500 tests
bun run test:evals   # run before shipping — paid, diff-based (~$4/run max)
```

`bun run test` runs skill validation, gen-skill-docs quality checks, and browse
integration tests. `bun run test:evals` runs LLM-judge quality evals and E2E
tests via `claude -p`. Both must pass before creating a PR.

**Reading the result — three things will mislead you:**

1. **No `Ran N tests across M files` line means the run died early.** Everything runs
   in one bun process, so any `process.exit()` reachable from a test ends it, racing
   the reporter. Until v1.46.1.0 that produced exit 0 with no summary after ~180 of
   265 files. Never trust a count without that line.
2. **The failure count is not yet stable.** Nine runs of one commit spanned 10 to 26,
   and which files fail moves too. Suite order determines the outcome; TODOS P1 has the
   trigger and a 10-file reproducer. Do not quote one run's number as the result, and
   do not attribute a swing to machine load without measuring — the quietest runs have
   been the worst.
3. **`--ignore <bare path>` silently matches nothing.** Only globs work. If you exclude
   a suite, verify by test count, not by exit status.

Suites pass alone and fail in the full run routinely. Confirm any single failure in
isolation before believing it, and re-run on `main` before calling it pre-existing.

## Project structure

```
gstack/
├── browse/          # Headless browser CLI (Playwright)
│   ├── src/         # CLI + server + commands
│   │   ├── commands.ts  # Command registry (single source of truth)
│   │   └── snapshot.ts  # SNAPSHOT_FLAGS metadata array
│   ├── test/        # Integration tests + fixtures
│   └── dist/        # Compiled binary
├── hosts/           # Typed host configs (one per AI agent)
│   ├── claude.ts    # Primary host config
│   ├── codex.ts, factory.ts, kiro.ts  # Existing hosts
│   ├── opencode.ts, slate.ts, cursor.ts, openclaw.ts  # IDE hosts
│   ├── hermes.ts, gbrain.ts  # Agent runtime hosts
│   └── index.ts     # Registry: exports all, derives Host type
├── scripts/         # Build + DX tooling
│   ├── gen-skill-docs.ts  # Template → SKILL.md generator (config-driven)
│   ├── host-config.ts     # HostConfig interface + validator
│   ├── host-config-export.ts  # Shell bridge for setup script
│   ├── host-adapters/     # Host-specific adapters (OpenClaw tool mapping)
│   ├── resolvers/   # Template resolver modules (preamble, design, review, gbrain, etc.)
│   ├── skill-check.ts     # Health dashboard
│   └── dev-skill.ts       # Watch mode
├── test/            # Skill validation + eval tests
│   ├── helpers/     # skill-parser.ts, session-runner.ts, llm-judge.ts, eval-store.ts
│   ├── fixtures/    # Ground truth JSON, planted-bug fixtures, eval baselines
│   ├── skill-validation.test.ts  # Tier 1: static validation (free, <1s)
│   ├── gen-skill-docs.test.ts    # Tier 1: generator quality (free, <1s)
│   ├── skill-llm-eval.test.ts   # Tier 3: LLM-as-judge (~$0.15/run)
│   └── skill-e2e-*.test.ts       # Tier 2: E2E via claude -p (~$3.85/run, split by category)
├── qa-only/         # /qa-only skill (report-only QA, no fixes)
├── plan-design-review/  # /plan-design-review skill (report-only design audit)
├── design-review/    # /design-review skill (design audit + fix loop)
├── ship/            # Ship workflow skill
├── review/          # PR review skill
├── plan-ceo-review/ # /plan-ceo-review skill
├── plan-eng-review/ # /plan-eng-review skill
├── autoplan/        # /autoplan skill (auto-review pipeline: CEO → design → eng)
├── benchmark/       # /benchmark skill (performance regression detection)
├── canary/          # /canary skill (post-deploy monitoring loop)
├── codex/           # /codex skill (multi-AI second opinion via OpenAI Codex CLI)
├── land-and-deploy/ # /land-and-deploy skill (merge → deploy → canary verify)
├── office-hours/    # /office-hours skill (YC Office Hours — startup diagnostic + builder brainstorm)
├── investigate/     # /investigate skill (systematic root-cause debugging)
├── retro/           # Retrospective skill (includes /retro global cross-project mode)
├── bin/             # CLI utilities (gstack-repo-mode, gstack-slug, gstack-config, etc.)
├── document-release/ # /document-release skill (post-ship doc updates + Diataxis coverage map)
├── document-generate/ # /document-generate skill (Diataxis doc generator: tutorial/how-to/reference/explanation)
├── cso/             # /cso skill (OWASP Top 10 + STRIDE security audit)
├── design-consultation/ # /design-consultation skill (design system from scratch)
├── design-shotgun/  # /design-shotgun skill (visual design exploration)
├── open-g6-browser/  # /open-g6-browser skill (launch g6 Browser)
├── connect-chrome/  # symlink → open-g6-browser (backwards compat)
├── design/          # Design binary CLI (GPT Image API)
│   ├── src/         # CLI + commands (generate, variants, compare, serve, etc.)
│   ├── test/        # Integration tests
│   └── dist/        # Compiled binary
├── extension/       # Chrome extension (side panel + activity feed + CSS inspector)
├── lib/             # Shared libraries (worktree.ts)
├── docs/designs/    # Design documents
├── setup-deploy/    # /setup-deploy skill (one-time deploy config)
├── .github/         # CI workflows + Docker image
│   ├── workflows/   # evals.yml (E2E on Ubicloud), skill-docs.yml, actionlint.yml
│   └── docker/      # Dockerfile.ci (pre-baked toolchain + Playwright/Chromium)
├── contrib/         # Contributor-only tools (never installed for users)
│   └── add-host/    # /gstack-contrib-add-host skill
├── setup            # One-time setup: build binary + symlink skills
├── SKILL.md         # Generated from SKILL.md.tmpl (don't edit directly)
├── SKILL.md.tmpl    # Template: edit this, run gen:skill-docs
├── ETHOS.md         # Builder philosophy (Boil the Lake, Search Before Building)
└── package.json     # Build scripts for browse
```

## SKILL.md workflow

SKILL.md files are **generated** from `.tmpl` templates. To update docs:

1. Edit the `.tmpl` file (e.g. `SKILL.md.tmpl` or `browse/SKILL.md.tmpl`)
2. Run `bun run gen:skill-docs` (or `bun run build` which does it automatically)
3. Commit both the `.tmpl` and generated `.md` files

To add a new browse command: add it to `browse/src/commands.ts` and rebuild.
To add a snapshot flag: add it to `SNAPSHOT_FLAGS` in `browse/src/snapshot.ts` and rebuild.

**Token ceiling:** Generated SKILL.md files trip a warning above 160KB (~40K tokens).
This is a "watch for feature bloat" guardrail, not a hard gate. Modern flagship
models have 200K-1M context windows, so 40K is 4-20% of window, and prompt caching
makes the marginal cost of larger skills small. The ceiling exists to catch runaway
preamble/resolver growth, not to force compression on carefully-tuned big skills
(`ship`, `plan-ceo-review`, `office-hours` legitimately pack 25-35K tokens of
behavior). If you blow past 40K, the right fix is usually: (1) look at WHAT grew,
(2) if one resolver added 10K+ in a single PR, question whether it belongs inline
or as a reference doc, (3) only compress carefully-tuned prose as a last resort —
cuts to the coverage audit, review army, or voice directive have real quality cost.

**Merge conflicts on SKILL.md files:** NEVER resolve conflicts on generated SKILL.md
files by accepting either side. Instead: (1) resolve conflicts on the `.tmpl` templates
and `scripts/gen-skill-docs.ts` (the sources of truth), (2) run `bun run gen:skill-docs`
to regenerate all SKILL.md files, (3) stage the regenerated files. Accepting one side's
generated output silently drops the other side's template changes.

## Platform-agnostic design

Skills must NEVER hardcode framework-specific commands, file patterns, or directory
structures. Instead:

1. **Read CLAUDE.md** for project-specific config (test commands, eval commands, etc.)
2. **If missing, AskUserQuestion** — let the user tell you or let gstack search the repo
3. **Persist the answer to CLAUDE.md** so we never have to ask again

This applies to test commands, eval commands, deploy commands, and any other
project-specific behavior. The project owns its config; gstack reads it.

## Writing SKILL templates

SKILL.md.tmpl files are **prompt templates read by Claude**, not bash scripts.
Each bash code block runs in a separate shell — variables do not persist between blocks.

Rules:
- **Use natural language for logic and state.** Don't use shell variables to pass
  state between code blocks. Instead, tell Claude what to remember and reference
  it in prose (e.g., "the base branch detected in Step 0").
- **Don't hardcode branch names.** Detect `main`/`master`/etc dynamically via
  `gh pr view` or `gh repo view`. Use `{{BASE_BRANCH_DETECT}}` for PR-targeting
  skills. Use "the base branch" in prose, `<base>` in code block placeholders.
- **Keep bash blocks self-contained.** Each code block should work independently.
  If a block needs context from a previous step, restate it in the prose above.
- **Express conditionals as English.** Instead of nested `if/elif/else` in bash,
  write numbered decision steps: "1. If X, do Y. 2. Otherwise, do Z."

## Writing style (V1)

Default output from every tier-≥2 skill follows the Writing Style section in
`scripts/resolvers/preamble.ts`: jargon glossed on first use (curated list in
`scripts/jargon-list.json`, baked at gen-skill-docs time), questions framed in
outcome terms ("what breaks for your users if...") not implementation terms,
short sentences, decisions close with user impact. Power users who want the
tighter V0 prose set `gstack-config set explain_level terse` (binary switch,
no middle mode). See `docs/designs/PLAN_TUNING_V1.md` for the full design
rationale. The review pacing overhaul that originally tried to ride alongside
writing-style was extracted to V1.1 — see `docs/designs/PACING_UPDATES_V0.md`.

## Browser interaction

When you need to interact with a browser (QA, dogfooding, cookie setup), use the
`/browse` skill or run the browse binary directly via `$B <command>`. NEVER use
`mcp__claude-in-chrome__*` tools — they are slow, unreliable, and not what this
project uses.

**Two rules that cost hours when broken** (full versions in `browse/SKILL.md`;
repeated here because driving `$B` directly skips that file):

- **Never throw away browse output.** Failures go to stderr with a non-zero exit.
  Send a state-changing command (`click`, `fill`, `select`, `press`, `goto`) to
  `/dev/null` and a broken command becomes indistinguishable from a working one —
  you'll debug the app instead of the command. Chain with `&&`, not `;`. Don't pipe
  a command whose exit code you rely on unless you `set -o pipefail` first, because
  a pipe reports the *last* command's status. Success means the event was
  dispatched, not that a handler ran: confirm the side effect with `snapshot -D`,
  `is visible`, or a read from the DB/API.
- **Refs are renumbered by every snapshot.** `@e5` is a position in the last
  snapshot's output, not a stable element id. Re-read the numbers from the newest
  snapshot every time; never carry a ref number across a `snapshot`, a click, a
  fill on a controlled input, or a navigation.

**Sidebar / server / security internals.** Before modifying `sidepanel.js`,
`background.js`, `content.js`, `terminal-agent.ts`, `server.ts`,
`sse-session-cookie.ts`, `tunnel-denial-log.ts`, or any sidebar/security module,
read the operational invariants in
[ARCHITECTURE.md](ARCHITECTURE.md#sidebar--security-operational-invariants) and
`docs/designs/SIDEBAR_MESSAGE_FLOW.md`. They cover the Terminal-PTY surface,
WebSocket `Sec-WebSocket-Protocol` auth, cross-pane PTY injection, the `/health`
token rule, dual-listener tunnel security, Unicode egress sanitization, setup
symlink hardening, and the six-layer prompt-injection stack with its thresholds
and env knobs (`GSTACK_SECURITY_OFF`, `GSTACK_SECURITY_ENSEMBLE`). Silent failures
here usually trace to not understanding the cross-component flow.

## Dev symlink awareness

When developing gstack, `.claude/skills/g6` may be a symlink back to this
working directory (gitignored). This means skill changes are **live immediately**,
great for rapid iteration, risky during big refactors where half-written skills
could break other Claude Code sessions using gstack concurrently.

**Check once per session:** Run `ls -la .claude/skills/g6` to see if it's a
symlink or a real copy. If it's a symlink to your working directory, be aware that:
- Template changes + `bun run gen:skill-docs` immediately affect all gstack invocations
- Breaking changes to SKILL.md.tmpl files can break concurrent g6 sessions
- During large refactors, remove the symlink (`rm .claude/skills/g6`) so the
  global install at `~/.claude/skills/g6/` is used instead

**Prefix setting:** Setup creates real directories (not symlinks) at the top level
with a SKILL.md symlink inside (e.g., `qa/SKILL.md -> gstack/qa/SKILL.md`). This
ensures Claude discovers them as top-level skills, not nested under `gstack/`.
Names are either short (`qa`) or namespaced (`gstack-qa`), controlled by
`skill_prefix` in `~/.gstack/config.yaml`. Pass `--no-prefix` or `--prefix` to
skip the interactive prompt.

**Note:** Vendoring g6 into a project's repo is deprecated. Use global install
+ `./setup --team` instead. See README.md for team mode instructions.

**For plan reviews:** When reviewing plans that modify skill templates or the
gen-skill-docs pipeline, consider whether the changes should be tested in isolation
before going live (especially if the user is actively using g6 in other windows).

**Upgrade migrations:** When a change modifies on-disk state (directory structure,
config format, stale files) in ways that could break existing user installs, add a
migration script to `gstack-upgrade/migrations/`. Read CONTRIBUTING.md's "Upgrade
migrations" section for the format and testing requirements. The upgrade skill runs
these automatically after `./setup` during `/g6-upgrade`.

## Compiled binaries — NEVER commit browse/dist/ or design/dist/

The `browse/dist/` and `design/dist/` directories contain compiled Bun binaries
(`browse`, `find-browse`, `design`, ~58MB each). These are Mach-O arm64 only — they
do NOT work on Linux, Windows, or Intel Macs. The `./setup` script already builds
from source for every platform, so the checked-in binaries are redundant. They are
tracked by git due to a historical mistake and should eventually be removed with
`git rm --cached`.

**NEVER stage or commit these files.** They show up as modified in `git status`
because they're tracked despite `.gitignore` — ignore them. When staging files,
always use specific filenames (`git add file1 file2`) — never `git add .` or
`git add -A`, which will accidentally include the binaries.

## Commit style

**Always bisect commits.** Every commit should be a single logical change. When
you've made multiple changes (e.g., a rename + a rewrite + new tests), split them
into separate commits before pushing. Each commit should be independently
understandable and revertable.

Examples of good bisection:
- Rename/move separate from behavior changes
- Test infrastructure (touchfiles, helpers) separate from test implementations
- Template changes separate from generated file regeneration
- Mechanical refactors separate from new features

When the user says "bisect commit" or "bisect and push," split staged/unstaged
changes into logical commits and push.

## Slop-scan: AI code quality, not AI code hiding

We use [slop-scan](https://github.com/benvinegar/slop-scan) to catch patterns where
AI-generated code is genuinely worse than a human would write — not to pass as human
code. Run `npx slop-scan scan .` (config: `slop-scan.config.json`). Full guidance on
what to fix vs what is linter-gaming, the `browse/src/error-handling.ts` helpers
(`safeUnlink` / `safeUnlinkQuiet` / `safeKill` / `isProcessAlive`), and score tracking
live in [CONTRIBUTING.md](CONTRIBUTING.md#slop-scan-ai-code-quality-not-ai-code-hiding).
Don't chase the number; fix real quality problems and accept findings where the
"sloppy" pattern is the correct engineering choice.

## Community PR guardrails

When reviewing or merging community PRs, **always AskUserQuestion** before accepting
any commit that:

1. **Touches ETHOS.md** — this file is Garry's personal builder philosophy. No edits
   from external contributors or AI agents, period.
2. **Removes or softens promotional material** — YC references, founder perspective,
   and product voice are intentional. PRs that frame these as "unnecessary" or
   "too promotional" must be rejected.
3. **Changes Garry's voice** — the tone, humor, directness, and perspective in skill
   templates, CHANGELOG, and docs are not generic. PRs that rewrite voice to be
   more "neutral" or "professional" must be rejected.

Even if the agent strongly believes a change improves the project, these three
categories require explicit user approval via AskUserQuestion. No exceptions.
No auto-merging. No "I'll just clean this up."

## CHANGELOG + VERSION style

VERSION is a monotonic, ordered release identifier; the bump level
(major/minor/patch/micro) signals intent at ship time, not a strict semver contract.
Scale-aware: big diffs bump MINOR/MAJOR, not PATCH. VERSION and CHANGELOG are
**branch-scoped** — every shipping branch gets its own bump and entry on top of main,
written at `/ship` time. The entry is the diff between main and your branch (what users
get on upgrade), never the branch's internal history: no branch-internal versions, no
mid-branch bug narrative, no review/plan activity. Write it like product release notes:
lead with what the user can now do, plain language, credit community contributors.

Every `## [X.Y.Z]` entry opens with a release-summary section (headline + lead +
"the numbers that matter" table + "what this means" close) in the GStack voice, with
`### Itemized changes` below. Full rules — bump thresholds, branch-internal-version
discipline, the merge-main checklist, and the release-summary format — are in
[CONTRIBUTING.md](CONTRIBUTING.md#changelog--version-style).

## AI effort compression

When estimating or discussing effort, always show both human-team and CC+gstack time:

| Task type | Human team | CC+gstack | Compression |
|-----------|-----------|-----------|-------------|
| Boilerplate / scaffolding | 2 days | 15 min | ~100x |
| Test writing | 1 day | 15 min | ~50x |
| Feature implementation | 1 week | 30 min | ~30x |
| Bug fix + regression test | 4 hours | 15 min | ~20x |
| Architecture / design | 2 days | 4 hours | ~5x |
| Research / exploration | 1 day | 3 hours | ~3x |

Completeness is cheap. Don't recommend shortcuts when the complete implementation
is a "lake" (achievable) not an "ocean" (multi-quarter migration). See the
Completeness Principle in the skill preamble for the full philosophy.

## Search before building

Before designing any solution that involves concurrency, unfamiliar patterns,
infrastructure, or anything where the runtime/framework might have a built-in:

1. Search for "{runtime} {thing} built-in"
2. Search for "{thing} best practice {current year}"
3. Check official runtime/framework docs

Three layers of knowledge: tried-and-true (Layer 1), new-and-popular (Layer 2),
first-principles (Layer 3). Prize Layer 3 above all. See ETHOS.md for the full
builder philosophy.

## Local plans

Contributors can store long-range vision docs and design documents in `~/.gstack-dev/plans/`.
These are local-only (not checked in). When reviewing TODOS.md, check `plans/` for candidates
that may be ready to promote to TODOs or implement.

## E2E eval failure blame protocol

When an E2E eval fails during `/ship` or any other workflow, **never claim "not
related to our changes" without proving it.** These systems have invisible couplings —
a preamble text change affects agent behavior, a new helper changes timing, a
regenerated SKILL.md shifts prompt context.

**Required before attributing a failure to "pre-existing":**
1. Run the same eval on main (or base branch) and show it fails there too
2. If it passes on main but fails on the branch — it IS your change. Trace the blame.
3. If you can't run on main, say "unverified — may or may not be related" and flag it
   as a risk in the PR body

"Pre-existing" without receipts is a lazy claim. Prove it or don't say it.

## Long-running tasks: don't give up

When running evals, E2E tests, or any long-running background task, **poll until
completion**. Use `sleep 180 && echo "ready"` + `TaskOutput` in a loop every 3
minutes. Never switch to blocking mode and give up when the poll times out. Never
say "I'll be notified when it completes" and stop checking — keep the loop going
until the task finishes or the user tells you to stop.

The full E2E suite can take 30-45 minutes. That's 10-15 polling cycles. Do all of
them. Report progress at each check (which tests passed, which are running, any
failures so far). The user wants to see the run complete, not a promise that
you'll check later.

## E2E test fixtures: extract, don't copy

**NEVER copy a full SKILL.md file into an E2E test fixture.** SKILL.md files are
1500-2000 lines. When `claude -p` reads a file that large, context bloat causes
timeouts, flaky turn limits, and tests that take 5-10x longer than necessary.

Instead, extract only the section the test actually needs:

```typescript
// BAD — agent reads 1900 lines, burns tokens on irrelevant sections
fs.copyFileSync(path.join(ROOT, 'ship', 'SKILL.md'), path.join(dir, 'ship-SKILL.md'));

// GOOD — agent reads ~60 lines, finishes in 38s instead of timing out
const full = fs.readFileSync(path.join(ROOT, 'ship', 'SKILL.md'), 'utf-8');
const start = full.indexOf('## Review Readiness Dashboard');
const end = full.indexOf('\n---\n', start);
fs.writeFileSync(path.join(dir, 'ship-SKILL.md'), full.slice(start, end > start ? end : undefined));
```

Also when running targeted E2E tests to debug failures:
- Run in **foreground** (`bun test ...`), not background with `&` and `tee`
- Never `pkill` running eval processes and restart — you lose results and waste money
- One clean run beats three killed-and-restarted runs

## Publishing native OpenClaw skills to ClawHub

Native OpenClaw skills live in `openclaw/skills/gstack-openclaw-*/SKILL.md`. These are
hand-crafted methodology skills (not generated by the pipeline) published to ClawHub
so any OpenClaw user can install them.

**Publishing:** The command is `clawhub publish` (NOT `clawhub skill publish`):

```bash
clawhub publish openclaw/skills/gstack-openclaw-office-hours \
  --slug gstack-openclaw-office-hours --name "gstack Office Hours" \
  --version 1.0.0 --changelog "description of changes"
```

Repeat for each skill: `gstack-openclaw-ceo-review`, `gstack-openclaw-investigate`,
`gstack-openclaw-retro`. Bump `--version` on each update.

**Auth:** `clawhub login` (opens browser for GitHub auth). `clawhub whoami` to verify.

**Updating:** Same `clawhub publish` command with a higher `--version` and `--changelog`.

**Verification:** `clawhub search gstack` to confirm they're live.

## Deploying to the active skill

The active skill lives at `~/.claude/skills/g6/`. **Check what it is before touching it:**

```bash
ls -ld ~/.claude/skills/g6
```

**If it is a symlink to your working tree** (the dev setup — see "Dev symlink
awareness"), there is nothing to deploy. The active skill already IS your worktree.
Update it by moving the worktree itself:

```bash
cd /path/to/your/g6 && git checkout main && git pull && bun run build
```

**NEVER run `git reset --hard` inside `~/.claude/skills/g6` in that setup.** It resolves
through the symlink to your working tree and will hard-reset whatever branch you have
checked out, discarding uncommitted work. This file used to tell you to do exactly that.

**If it is a real directory** (a separate global install), fetch and rebuild there:

```bash
cd ~/.claude/skills/g6 && git fetch origin && git reset --hard origin/main && bun run build
```

Or copy the binaries directly:
- `cp browse/dist/browse ~/.claude/skills/g6/browse/dist/browse`
- `cp design/dist/design ~/.claude/skills/g6/design/dist/design`

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

## GBrain Search Guidance (configured by /sync-gbrain)
<!-- gstack-gbrain-search-guidance:start -->

GBrain is set up and synced on this machine. The agent should prefer gbrain
over Grep when the question is semantic or when you don't know the exact
identifier yet.

**This worktree is pinned to a worktree-scoped code source** via the
`.gbrain-source` file in the repo root (kubectl-style context). Any
`gbrain code-def`, `code-refs`, `code-callers`, `code-callees`, or `query`
call from anywhere under this worktree routes to that source by default —
no `--source` flag needed. Conductor sibling worktrees of the same repo
each have their own pin and their own indexed pages, so semantic results
match the actual code on disk in this worktree.

Two indexed corpora available via the `gbrain` CLI:
- This worktree's code (auto-pinned via `.gbrain-source`).
- `~/.gstack/` curated memory (registered as `gstack-brain-<user>` source via
  the existing federation pipeline).

Prefer gbrain when:
- "Where is X handled?" / semantic intent, no exact string yet:
    `gbrain search "<terms>"` or `gbrain query "<question>"`
- "Where is symbol Y defined?" / symbol-based code questions:
    `gbrain code-def <symbol>` or `gbrain code-refs <symbol>`
- "What calls Y?" / "What does Y depend on?":
    `gbrain code-callers <symbol>` / `gbrain code-callees <symbol>`
- "What did we decide last time?" / past plans, retros, learnings:
    `gbrain search "<terms>" --source gstack-brain-<user>`

Grep is still right for known exact strings, regex, multiline patterns, and
file globs. Run `/sync-gbrain` after meaningful code changes; for ongoing
auto-sync across all worktrees, run `gbrain autopilot --install` once per
machine — gbrain's daemon handles incremental refresh on a schedule.

<!-- gstack-gbrain-search-guidance:end -->
