---
name: phi-audit
preamble-tier: 2
version: 1.0.0
description: |
  Health-data compliance audit for apps that touch PHI (protected health
  information). Detects PHI in code/logs/URLs, checks encryption at rest and in
  transit, verifies audit-log coverage of PHI access, flags vendors that need a
  signed BAA, and checks minimum-necessary data collection. Runs quick (blockers
  only) or full (every HIPAA-adjacent surface). Not legal advice — an engineering
  pre-check.
  Use when: "phi audit", "hipaa check", "health data review", "is this compliant",
  "does this leak patient data", "BAA check". (g6)
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
  - phi audit
  - hipaa check
  - health data review
  - baa check
  - does this leak patient data
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

**This is an engineering pre-check, not legal advice or a certified HIPAA
assessment.** It finds the technical gaps a real audit would flag first. Say this
plainly in the final report so nobody mistakes a green score for legal sign-off.

Read CLAUDE.md for stack context. If it already documents that the app does *not*
handle health data, stop and confirm with the user before spending a full run.

## Step 1: Confirm scope and PHI surface

Ask (or infer): quick scan (deploy blockers only) or full audit?

- **Quick**: PHI in logs/URLs, unencrypted PHI at rest, PHI sent to non-BAA vendors
- **Full**: everything, plus audit-log coverage, minimum-necessary review, access
  controls, and data-retention/disposal paths

Then establish what counts as PHI *here*. The HIPAA identifiers to look for:
names, dates tied to an individual (DOB, admission, death), phone/fax, email,
SSN, MRN (medical record number), health-plan/beneficiary numbers, account
numbers, device/serial IDs, IP addresses, biometric IDs, full-face photos, and
any diagnosis / treatment / test-result field. Ask the user for their domain's
specific field names (e.g. `patient_id`, `dx_code`, `lab_result`) so the greps
below can be widened.

## Step 2: PHI in logs, URLs, and error paths

The single most common real-world leak. PHI in a log line or query string ends up
in access logs, aggregators, and third-party monitoring — often outside any BAA.

```bash
# PHI written to logs
grep -rn "logger\.\|Rails\.logger\|console\.log\|print(\|println\|log\.\(info\|debug\|warn\)" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.go" . 2>/dev/null | \
  grep -iE "patient|mrn|medical_record|diagnosis|dx_|icd|cpt|lab_result|ssn|dob|date_of_birth|npi|health|prescription|rx_" | \
  grep -v ".git/" | head -40

# PHI in URL/query params (lands in access logs + referrer headers)
grep -rn "params\[:\|request\.args\|req\.query\|searchParams\|GET.*=\|redirect.*=" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -iE "patient|mrn|ssn|dob|diagnosis|medical" | grep -v ".git/" | head -30

# PHI echoed in error responses / stack traces
grep -rn "rescue\|except\|catch\|raise\|throw\|render.*error\|jsonify" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | \
  grep -iE "patient|mrn|ssn|diagnosis|medical" | grep -v ".git/\|test\|spec" | head -20
```

Flag every hit. A patient identifier in a URL is a FAIL, not a WARN.

## Step 3: Encryption at rest and in transit

```bash
# Which PHI fields are encrypted at rest? Look at the model layer.
grep -rn "encrypts \|attr_encrypted\|EncryptedField\|Fernet\|pgcrypto\|cipher\|AES\|column_encryption" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | grep -v ".git/" | head -30

# Plaintext external calls (PHI over http:// is a transit failure)
grep -rn '"http://\|'"'"'http://' \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -v ".git/\|localhost\|127\.0\.0\|test\|#\|schema" | head -20

# Supabase / Postgres: is the PHI-bearing table encrypted or just RLS-gated?
find . -path "*/db/schema.rb" -o -name "*models*.py" -o -path "*/migrations/*" 2>/dev/null | head -15
```

Cross-reference: for every model field identified as PHI in Step 1, confirm it is
either encrypted at rest or explicitly justified. RLS alone is access control, not
encryption — note the difference in the report.

## Step 4: Audit-log coverage of PHI access

HIPAA expects you to know *who accessed which record when*. Missing access logging
is a compliance gap even if nothing leaked.

```bash
# Existing audit-log infrastructure?
grep -rln "audit\|paper_trail\|audited\|access_log\|AuditLog\|activity_log" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | grep -v ".git/\|test" | head -20

# PHI read paths — do the controllers/endpoints that serve PHI record access?
grep -rn "def show\|def index\|@app.get\|router.get\|def read_" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | \
  grep -iE "patient|record|chart|lab|result|health" | grep -v ".git/\|test" | head -20
```

For each endpoint that returns PHI, check whether an audit entry is written. List
the ones that read PHI *without* logging access.

## Step 5: BAA / vendor exposure

Any third party that receives PHI needs a signed Business Associate Agreement. The
code can't tell you if a BAA exists, but it can tell you *where PHI leaves the
system* so the user can check each one.

```bash
# Outbound service SDKs / API hosts that may receive PHI
grep -rniE "sentry|datadog|newrelic|logrocket|fullstory|mixpanel|segment|amplitude|posthog|twilio|sendgrid|mailgun|postmark|openai|anthropic|s3\.amazonaws|cloudinary|stripe|supabase" \
  --include="*.rb" --include="*.py" --include="*.ts" --include="*.js" --include="*.env*" . 2>/dev/null | \
  grep -v ".git/\|test\|spec\|lock" | head -40
```

Build a table: **Vendor | What data reaches it | BAA required? | BAA in place?**
(last column the user fills in). Call out the dangerous defaults explicitly —
error monitors (Sentry, Datadog) and LLM APIs (OpenAI, Anthropic) routinely
receive PHI through payloads and prompts, and many standard tiers won't sign a
BAA. Flag any that appear in PHI code paths.

## Step 6: Minimum necessary + retention

```bash
# The PHI-bearing schema — is every field justified?
find . -path "*/db/schema.rb" -o -name "*_create_*.rb" -o -path "*/migrations/*" 2>/dev/null | head -15

# Retention / disposal paths (HIPAA expects a defined destruction path)
grep -rniE "retention|purge|destroy_after|soft_delete|deleted_at|anonymize|redact|scrub" \
  --include="*.rb" --include="*.py" --include="*.ts" . 2>/dev/null | grep -v ".git/\|test" | head -20
```

For each PHI field, ask whether it's actually needed for the feature that reads it
(minimum-necessary principle). Flag collected-but-unused PHI. Note whether there's
any defined path to delete or de-identify PHI, or whether it lives forever.

## Step 7: Compile findings and score

Open the report with the disclaimer from the preamble, then:

**PHI Compliance Score: X/10**

| Category | Status | Findings |
|---|---|---|
| PHI in logs / URLs / errors | PASS / WARN / FAIL | file:line list |
| Encryption at rest & in transit | PASS / WARN / FAIL | list |
| Audit-log coverage of PHI access | PASS / WARN / FAIL | list |
| BAA / vendor exposure | PASS / WARN / FAIL | vendor table |
| Minimum necessary | PASS / WARN / FAIL | list |
| Retention / disposal | PASS / WARN / FAIL | list |

**FAIL** = fix before this touches real patient data. **WARN** = make a documented
decision. For each FAIL, give the exact `file:line` and a one-line fix.

Scoring: 10 = zero issues. Deduct 2 per FAIL category, 1 per WARN category. Close
with the three highest-leverage fixes and repeat that this is an engineering
pre-check, not legal certification.
