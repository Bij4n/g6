# g6

> "A small practice building, teaching, and securing software that belongs to the people using it." — Capitalism Killed Software

g6 is a set of AI engineering skills for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). You type a command like `/review` or `/privacy-audit` and Claude runs a full workflow for you — planning a feature, auditing security, shipping a PR, teaching a junior dev what just happened.

I'm [Bij4n](https://github.com/Bij4n), and I built g6 around how I actually work: mostly solo, privacy-first, shipping to real users on Rails, FastAPI, and Supabase. But none of that is required. Most of the skills here don't care what stack you use, and you can pick up as many or as few as you want.

## Who this is for

You don't have to adopt the whole thing. People use g6 in a few different ways:

- **Shipping a side project alone.** Plan it (`/office-hours`), build and review it (`/review`), and get it out the door (`/ship`) without a team.
- **Securing an app before launch.** Run `/cso`, `/privacy-audit`, and whatever stack-specific audit fits (`/stripe-audit`, `/supabase-audit`, `/api-audit`) and fix what they find.
- **Keeping something in production healthy.** `/health`, `/rails-health`, `/node-health`, `/sidekiq-monitor`, and `/canary` are dashboards you run when you want to know what's actually going on.
- **Teaching or learning.** `/mentor` explains what just happened in plain language, tuned to the level of whoever's reading.
- **Automating browser work.** `/browse` and `/scrape` drive a real headless Chromium for QA, testing, and data collection.

Jump to [all skills](#all-skills) for the full list, grouped by what they're for.

## The skills I built

g6 started as a fork of [gstack](https://github.com/garrytan/gstack) (credit below). These are the ones I added — mostly security and health audits for the stacks I ship on, plus a teaching mode:

| Skill | What it checks |
|-------|--------------|
| `/phi-audit` | Health-data (PHI) compliance pre-check: PHI in logs/URLs, encryption, audit-log coverage, BAA-required vendors, minimum-necessary collection. Engineering pass, not legal advice. |
| `/privacy-audit` | Third-party phone-homes, PII exposure, and anything blocking you from self-hosting. |
| `/rails-health` | Rails 8 + Sidekiq: credentials, N+1s, schema drift, gem CVEs, Stripe webhook security. |
| `/api-audit` | FastAPI/REST: auth coverage, rate limiting, key exposure, CORS, TILA compliance for financial APIs. |
| `/stripe-audit` | Stripe for anyone running multiple products on one account. Catches the mistakes that cost real money. |
| `/supabase-audit` | RLS coverage, storage bucket policies, service_role key isolation, Edge Function auth, pg_cron. One RLS gap exposes every user's records. |
| `/self-host-audit` | Scores how locked-in you are to managed SaaS and writes a phased plan to get off it. Inventories every hosted dependency, rates data portability, checks for a Docker path. |
| `/degoogle` | Finds every Google dependency (Fonts, Analytics, reCAPTCHA, Maps, Firebase, GTM) and swaps each for a self-hosted or privacy-respecting equivalent. |
| `/env-audit` | Every env var pulled from source, diffed against `.env.example`, plus hardcoded secrets and `.gitignore` gaps. |
| `/db-audit` | Postgres health: missing indexes, table bloat, connection pool sizing, N+1 patterns. Static analysis, or live `psql` if it's available. |
| `/crypto-audit` | Bitcoin and crypto code: key generation entropy, seed phrase storage, private key exposure, wallet encryption. |
| `/node-health` | Node/Express: npm CVEs, security middleware (helmet, rate-limit, CORS, CSRF), SQL and MongoDB injection, auth hygiene. |
| `/sidekiq-monitor` | Live Sidekiq: queue depths, busy workers, dead jobs, retry exhaustion, scheduled backlog. Run it when jobs are actually failing. |
| `/supabase-deploy` | Safe migration deploys: diff what's pending, flag destructive statements, confirm, apply, re-check RLS. |
| `/multi-tenant-audit` | Cross-tenant leakage across Rails, Next.js, and FastAPI: DB scoping, RLS filters, cache key isolation, IDOR checks. |
| `/mentor` | Teaching mode. Explains what just happened at whatever level the reader needs. |
| `/explain-diff` | Walks through a diff or PR in plain language at the reader's level: what changed, why, what could break, what to test. |
| `/walkthrough` | An interactive tour of a codebase or subsystem for a newcomer: entry points, how a request flows, the mental model, the gotchas. |
| `/quiz-me` | Generates grounded questions about the code (or a topic you name), grades your answers with explanations, and adapts the difficulty. |

Everything else comes from gstack and is listed further down.

**Auto-updates from `Bij4n/g6`.** Run `/g6-upgrade` to pull the latest.

## Quick start

Once it's installed (below), a typical first run looks like this:

1. `/office-hours` — talk through what you're building and find the smallest thing worth shipping.
2. `/privacy-audit` — catch any third-party phone-homes before you launch.
3. `/cso` — full OWASP + STRIDE security pass.
4. `/review` — run this on any branch before you push it.

None of these depend on each other, so start with whichever one matches what you're doing today.

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

Setup compiles the browser binary, downloads Chromium, and links every skill into Claude Code. It runs for about a minute and then you're done.

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

> Add a "g6" section to CLAUDE.md that says: use the /browse skill from g6 for all web browsing, never use mcp\_\_claude-in-chrome\_\_\* tools, no Google services (Fonts, Analytics, reCAPTCHA) anywhere. List these available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /plan-devex-review, /autoplan, /review, /codex, /investigate, /incident, /onboard, /design-consultation, /design-shotgun, /design-html, /design-review, /qa, /qa-only, /devex-review, /ship, /land-and-deploy, /canary, /setup-deploy, /document-release, /document-generate, /cso, /phi-audit, /privacy-audit, /self-host-audit, /degoogle, /rails-health, /api-audit, /stripe-audit, /supabase-audit, /env-audit, /db-audit, /crypto-audit, /supabase-deploy, /multi-tenant-audit, /node-health, /mentor, /explain-diff, /walkthrough, /quiz-me, /retro, /health, /sidekiq-monitor, /benchmark, /benchmark-models, /make-pdf, /learn, /context-save, /context-restore, /browse, /scrape, /skillify, /pair-agent, /open-g6-browser, /setup-browser-cookies, /careful, /freeze, /guard, /unfreeze, /g6-upgrade.

### Step 3: Team mode — auto-update for shared repos (optional)

If you want everyone working in a repo to get g6 automatically, run this from inside that repo:

```bash
(cd ~/.claude/skills/g6 && ./setup --team) && ~/.claude/skills/g6/bin/gstack-team-init optional && git add .claude/ CLAUDE.md && git commit -m "add g6 AI workflow skills"
```

This commits the skill config. Any teammate who opens Claude Code in that repo gets g6 without doing anything.

## All skills

The full set, grouped by what you're doing. Skills marked ★ are ones I built; the rest come from gstack.

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
| `/phi-audit` | ★ g6 original. Health-data (PHI) compliance pre-check: PHI in logs/URLs, encryption at rest/transit, audit-log coverage, BAA-required vendors, minimum-necessary + retention. |
| `/privacy-audit` | ★ g6 original. Find phone-homes, PII exposure, data minimization gaps, self-hosting blockers. |
| `/self-host-audit` | ★ g6 original. Portability score + phased exit plan off managed SaaS: dependency inventory, data-export path, Docker readiness, hardcoded-provider hunt. |
| `/degoogle` | ★ g6 original. Locate every Google dependency and swap it for a self-hosted / privacy-respecting equivalent (Bunny Fonts, Plausible, hCaptcha, MapLibre). Report or apply. |
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
| `/explain-diff` | ★ g6 original. Plain-language walkthrough of a diff or PR at the reader's level: what changed, why, blast radius, what to test. |
| `/walkthrough` | ★ g6 original. Interactive tour of a codebase or subsystem: entry points, request flow, mental model, key files, gotchas. Pairs with `/onboard`. |
| `/quiz-me` | ★ g6 original. Grounded questions about the code or a named topic, graded with explanations, adaptive difficulty. |

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

## What g6 is opinionated about

A few defaults are baked into the skills. You can ignore them, but they're why g6 looks the way it does.

**No Google services.** I don't pull in Fonts, Analytics, reCAPTCHA, or Tag Manager. Each one is a dependency and a tracking surface I didn't choose, so `/privacy-audit` flags them and the design skills avoid them. Self-host what you reasonably can.

**Run the security audits early.** `/cso`, `/privacy-audit`, and `/stripe-audit` are fast enough to run before a deploy instead of after an incident. That's the whole point of packaging them as one command.

**Software should stay with the people using it.** Self-hosting paths, minimal data collection, encryption at rest, no behavioral tracking. The audit skills treat these as the default expectation, not a nice-to-have.

## Stack defaults

The g6-original skills know my stack best, so that's what they assume out of the box:

- **Backend**: Ruby on Rails 8, FastAPI, Sidekiq, Postgres
- **Frontend**: React/Vite, plain HTML/CSS
- **Deploy**: Vercel, Render
- **Payments**: Stripe (one account, several products)
- **Languages**: Python, Ruby, TypeScript

The workflow skills (planning, review, ship, browse) don't care about any of this and work anywhere.

## Updating

Run `/g6-upgrade` — checks and pulls from `Bij4n/g6`, then re-runs `./setup`.

## License

MIT. Fork it, extend it, share it.

---

## Credits

g6 is a fork of [gstack](https://github.com/garrytan/gstack) by [Garry Tan](https://x.com/garrytan). The core workflow — the skill system, the browse binary, the ship pipeline — is his work, and it's genuinely good. What I added on top is the audit and health suite, the teaching mode, and the stack defaults I ship with. Those are marked ★ throughout this README so it's clear which is which.
