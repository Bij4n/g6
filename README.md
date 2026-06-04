# g6

> "A small practice building, teaching, and securing software that belongs to the people using it." — Capitalism Killed Software

I'm [Bij4n](https://github.com/Bij4n). g6 is my fork of [garrytan/gstack](https://github.com/garrytan/gstack). Garry's work is great — the bones are solid. It just wasn't built for how I work: privacy-first, security-forward, independent stack, teaching as I go. So I extended it.

## What g6 adds

| Skill | Why it exists |
|-------|--------------|
| `/privacy-audit` | Finds third-party phone-homes, PII exposure, and self-hosting blockers. Non-negotiable for software that claims to respect its users. |
| `/rails-health` | Rails 8 + Sidekiq dashboard: credentials, N+1s, schema drift, gem CVEs, Stripe webhook security. |
| `/api-audit` | FastAPI/REST: auth coverage, rate limiting, key exposure, CORS, TILA compliance for financial APIs. |
| `/stripe-audit` | Stripe security for solo operators running multiple products on one account. Catches the mistakes that cost real money. |
| `/supabase-audit` | Supabase RLS coverage, storage bucket policies, service_role key isolation, Edge Function auth, and pg_cron security. One RLS gap exposes every user's records. |
| `/env-audit` | Extract every env var from source, diff against `.env.example`, find hardcoded secrets, verify `.gitignore` coverage, and check Render/Vercel deployment completeness. |
| `/db-audit` | Postgres health: missing indexes, table bloat, connection pool sizing, N+1 patterns at the DB level. Static analysis + live psql if available. |
| `/crypto-audit` | Security audit for Bitcoin and cryptocurrency code: key generation entropy, seed phrase storage, private key exposure, wallet encryption. |
| `/node-health` | Node.js/Express health dashboard: npm CVEs, security middleware (helmet, rate-limit, CORS, CSRF), SQL and MongoDB injection risks, auth hygiene, error handling gaps. |
| `/sidekiq-monitor` | Live Sidekiq runtime: queue depths, busy workers, dead jobs, retry exhaustion, scheduled job backlog. Run this when jobs are actually failing, not just for static analysis. |
| `/supabase-deploy` | Safe Supabase migration deployment: diffs pending migrations, flags destructive statements, requires explicit confirmation before applying, verifies RLS post-deploy. |
| `/multi-tenant-audit` | Cross-tenant data leakage: DB tenant scoping, RLS tenant filters, cache key isolation, background job context, file storage paths, IDOR checks across Rails, Next.js, and FastAPI. |
| `/mentor` | Teaching mode. Explains what just happened in plain language, calibrated to the learner's level. For the people I'm training. |

**Auto-updates from this fork.** When you install g6, update checks point to `Bij4n/g6` — not upstream. You get Garry's improvements (I track upstream) plus g6's originals.

## Quick start

1. Install g6 (30 seconds — see below)
2. Run `/office-hours` — describe what you're building
3. Run `/privacy-audit` — find any third-party phone-homes before you launch
4. Run `/cso` — full OWASP + STRIDE security audit
5. Run `/review` on any branch before you push

## Install — 2 minutes

### Prerequisites

**1. Claude Code** — [install here](https://docs.anthropic.com/en/docs/claude-code)

**2. Bun** — g6's build tool. Install it:
```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc  # or restart your terminal
```

**3. Git** — already installed on most systems. Check with `git --version`.

### Step 1: Install globally

Run this in your terminal (not inside Claude Code — just a regular terminal):

```bash
mkdir -p ~/.claude/skills && git clone --single-branch --depth 1 https://github.com/Bij4n/g6.git ~/.claude/skills/g6 && cd ~/.claude/skills/g6 && ./setup
```

That's it. Setup compiles the browser binary, downloads Chromium, and links all skills into Claude Code. Takes about 60 seconds.

### Optional: Install the browser extension

The extension adds a live sidebar to your browser — activity feed, CSS inspector, and a Claude terminal that can see what tab you're on.

**Supports Firefox, LibreWolf, and Chromium. No Chrome required.**

| Browser | How to load |
|---|---|
| **Firefox / LibreWolf** | Go to `about:debugging` → This Firefox → Load Temporary Add-on → pick `~/.claude/skills/g6/extension/manifest.json` |
| **Chromium** | Go to `chrome://extensions` → Enable Developer mode → Load unpacked → pick `~/.claude/skills/g6/extension/` |

The sidebar opens automatically after loading. Click the g6 icon in the toolbar to toggle it.

### Step 2: Tell Claude about g6 (one time per machine)

Open Claude Code and paste this prompt exactly:

> Add a "g6" section to CLAUDE.md that says: use the /browse skill from g6 for all web browsing, never use mcp\_\_claude-in-chrome\_\_\* tools, no Google services (Fonts, Analytics, reCAPTCHA) anywhere. List these available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /plan-devex-review, /autoplan, /review, /codex, /investigate, /incident, /onboard, /design-consultation, /design-shotgun, /design-html, /design-review, /qa, /qa-only, /devex-review, /ship, /land-and-deploy, /canary, /setup-deploy, /document-release, /document-generate, /cso, /privacy-audit, /rails-health, /api-audit, /stripe-audit, /supabase-audit, /env-audit, /db-audit, /crypto-audit, /supabase-deploy, /multi-tenant-audit, /node-health, /mentor, /retro, /health, /sidekiq-monitor, /benchmark, /benchmark-models, /make-pdf, /learn, /context-save, /context-restore, /browse, /scrape, /skillify, /pair-agent, /open-g6-browser, /setup-browser-cookies, /careful, /freeze, /guard, /unfreeze, /g6-upgrade.

### Step 3: Team mode — auto-update for shared repos (optional)

If you want everyone working in a repo to get g6 automatically, run this from inside that repo:

```bash
(cd ~/.claude/skills/g6 && ./setup --team) && ~/.claude/skills/g6/bin/gstack-team-init optional && git add .claude/ CLAUDE.md && git commit -m "add g6 AI workflow skills"
```

This commits the skill config. Any teammate who opens Claude Code in that repo gets g6 without doing anything.

## All skills

### Plan before you build

| Skill | What it does |
|-------|-------------|
| `/office-hours` | Start here. Six forcing questions that expose demand reality and the narrowest wedge to ship. |
| `/plan-ceo-review` | CEO-level review: find the 10-star product in the request. |
| `/plan-eng-review` | Lock architecture, data flow, edge cases, and tests before a line is written. |
| `/plan-design-review` | Rate each design dimension 0-10, explain what a 10 looks like. |
| `/plan-devex-review` | Developer experience plan review: personas, competitor benchmarks, friction points, magic moments. |
| `/autoplan` | One command runs CEO → design → eng review in sequence. |

### Build and review

| Skill | What it does |
|-------|-------------|
| `/review` | Pre-landing PR review. Finds bugs that pass CI but break in production. |
| `/codex` | Independent second opinion from OpenAI Codex: review, challenge (adversarial break attempt), or consult. |
| `/investigate` | Systematic root-cause debugging. No fixes without investigation. |
| `/incident` | Production incident response: triage, scope, fix, communicate, post-mortem. For live fires. |
| `/onboard` | Generate a structured ONBOARDING.md for a new developer: architecture map, local setup, key files, gotchas. |
| `/design-consultation` | Full design system from scratch: aesthetic, typography, color, layout, motion, font+color previews. |
| `/design-shotgun` | Generate multiple design variants, open a comparison board, collect feedback, iterate. |
| `/design-html` | Turn approved designs into production-quality HTML/CSS. |
| `/design-review` | Live-site visual audit + fix loop with atomic commits. |
| `/qa` | Open a real browser, find bugs, fix them, re-verify. |
| `/qa-only` | QA report only — no code changes. |
| `/devex-review` | Measures real time-to-first-success for APIs and developer-facing products. |

### Release and deploy

| Skill | What it does |
|-------|-------------|
| `/ship` | Run tests, review diff, push, open PR. |
| `/land-and-deploy` | Merge the PR, wait for CI and deploy, verify production health. |
| `/canary` | Post-deploy monitoring loop using the browser daemon. |
| `/setup-deploy` | One-time deploy config detection (Render, Vercel, Fly.io, etc.). |
| `/document-release` | Update all docs to match what you just shipped. |
| `/document-generate` | Generate Diataxis-structured docs (tutorial, how-to, reference, explanation). |

### Security and privacy

| Skill | What it does |
|-------|-------------|
| `/cso` | OWASP Top 10 + STRIDE threat modeling. Full security audit. |
| `/privacy-audit` | ★ g6 original. Find phone-homes, PII exposure, data minimization gaps, self-hosting blockers. |
| `/rails-health` | ★ g6 original. Rails 8 health: credentials, Sidekiq, N+1s, schema drift, gem CVEs. |
| `/api-audit` | ★ g6 original. REST/FastAPI: auth, rate limiting, key exposure, CORS, TILA compliance. |
| `/stripe-audit` | ★ g6 original. Stripe: webhook verification, key hygiene, idempotency, multi-product isolation. |
| `/supabase-audit` | ★ g6 original. RLS coverage, storage policies, service_role isolation, Edge Function auth, pg_cron. |
| `/supabase-deploy` | ★ g6 original. Safe migration deployment: diff, flag destructive changes, confirm, apply, verify RLS post-deploy. |
| `/multi-tenant-audit` | ★ g6 original. Cross-tenant leakage: DB scoping, RLS tenant filters, cache key isolation, IDOR checks. |
| `/env-audit` | ★ g6 original. Env var hygiene: extract from code, diff against .env.example, find hardcoded secrets. |
| `/db-audit` | ★ g6 original. Postgres: missing indexes, table bloat, connection pool sizing, N+1 patterns. |
| `/crypto-audit` | ★ g6 original. Bitcoin/crypto: key generation entropy, seed phrase storage, wallet encryption. |
| `/node-health` | ★ g6 original. Node.js/Express: npm CVEs, security middleware (helmet, rate-limit, CORS, CSRF), SQL/MongoDB injection, auth hygiene, error handling. |

### Teaching

| Skill | What it does |
|-------|-------------|
| `/mentor` | ★ g6 original. Explains what just happened in plain language. Beginner → advanced. |

### Operational

| Skill | What it does |
|-------|-------------|
| `/retro` | Weekly retrospective with shipping streaks and per-project breakdowns. |
| `/health` | Code quality dashboard (type checker, linter, tests, dead code). |
| `/sidekiq-monitor` | ★ g6 original. Live Sidekiq: queue depths, busy workers, dead jobs, retry exhaustion, cron health. |
| `/benchmark` | Performance regression detection (Core Web Vitals, page load). |
| `/benchmark-models` | Cross-model benchmark: run the same prompt through Claude, Codex, and Gemini side-by-side. |
| `/make-pdf` | Turn any markdown file into a publication-quality PDF (margins, TOC, page numbers, watermark). |
| `/learn` | Manage what g6 learned across sessions. |
| `/context-save` | Save working context (git state, decisions, remaining work). |
| `/context-restore` | Resume from a saved context across sessions. |

### Browser

| Skill | What it does |
|-------|-------------|
| `/browse` | Headless browser — real Chromium, persistent state, ~100ms/command. |
| `/scrape` | Pull structured data from a web page. First run prototypes the flow; repeat calls use a codified script (~200ms). |
| `/skillify` | Codify a successful `/scrape` flow into a permanent browser skill for instant future reuse. |
| `/pair-agent` | Pair a remote AI agent (Codex, Cursor, OpenClaw) with your local browser via a secure connection. |
| `/open-g6-browser` | Launch the visible browser with sidebar. |
| `/setup-browser-cookies` | Import cookies from your real browser for authenticated testing. |

### Safety

| Skill | What it does |
|-------|-------------|
| `/careful` | Warn before destructive commands. |
| `/freeze` | Lock edits to one directory. |
| `/guard` | Activate both careful + freeze. |
| `/unfreeze` | Remove restrictions. |

## My principles (what g6 is tuned for)

**No Google services.** No Fonts, no Analytics, no reCAPTCHA, no Tag Manager. Every external service is a dependency, a tracking surface, and a SPOF you didn't choose. Self-host what you can.

**Security is not a phase.** `/cso`, `/privacy-audit`, and `/stripe-audit` run before deploys, not after incidents. The tools make this fast enough that there's no excuse.

**Software should belong to the people using it.** Self-hosting paths, minimal data collection, encrypted at rest, no behavioral surveillance. These aren't features — they're the baseline.

## Stack defaults

g6 is tuned for my stack:
- **Backend**: Ruby on Rails 8, FastAPI, Sidekiq, Postgres
- **Frontend**: React/Vite, plain HTML/CSS
- **Deploy**: Vercel, Render
- **Payments**: Stripe (single account, multiple products)
- **Language**: Python, Ruby, TypeScript

It works on any stack — these are just the defaults that inform the g6-original skills.

## Updating

To pull the latest: `/g6-upgrade` — checks and pulls from `Bij4n/g6`.

To also pull upstream gstack improvements, merge from `garrytan/gstack`:

```bash
cd ~/.claude/skills/g6
git remote add upstream https://github.com/garrytan/gstack.git 2>/dev/null || true
git fetch upstream
git merge upstream/main --no-edit
./setup
```

## License

MIT. Same as upstream. Fork it, extend it, share it.

---

*Built on [gstack](https://github.com/garrytan/gstack) by [Garry Tan](https://x.com/garrytan).*
