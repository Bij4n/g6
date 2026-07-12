---
name: quiz-me
preamble-tier: 2
version: 1.0.0
description: |
  Generates questions about the current codebase (or a topic the reader names) to
  test and reinforce understanding, then grades the answers with explanations.
  Poses multiple-choice questions where they fit and free-text where they don't,
  and adapts difficulty to how the reader is doing. Good for a learner solidifying
  their grasp of a system they're working in.
  Use when: "quiz me", "test my understanding", "ask me questions about this code",
  "check what I know", "drill me on this subsystem", "flashcards for this repo". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
triggers:
  - quiz me
  - test my understanding
  - ask me questions about this code
  - check what i know
  - drill me on this
---

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"
```

This is a study session. The point is to surface what the reader doesn't yet know
and close the gap with a good explanation, not to catch them out. Questions come
from the real code in front of you, so the answers are checkable and the learning
transfers.

Read CLAUDE.md and the README for context on the stack before writing questions.

## Step 1: Pick the topic and starting difficulty

Ask what to quiz on (or infer from context): the current diff/branch, a named
subsystem, the whole repo, or a concept the reader wants drilled. Then ask the
starting level — beginner, intermediate, or advanced. Default to intermediate if
they don't care and let Step 5 adapt from there.

## Step 2: Learn the material well enough to grade it

Never write a question you can't grade against the actual code. Map the chosen
area first with Read/Grep/Glob so both the questions and the model answers are
grounded in what's really there.

```bash
# Orient on the area — files, key symbols, entry points
grep -rniE "def |func |class |export |function " --include="*.py" --include="*.ts" \
  --include="*.js" --include="*.go" --include="*.rb" . 2>/dev/null | grep -v ".git/\|test\|spec" | head -30
```

For a diff-scoped quiz, load the change the same way `/explain-diff` does (detect
the base branch dynamically, never hardcode main/master) and build questions from
what actually changed.

## Step 3: Write a mix of questions

Aim for 5-8 questions per round, spanning recall, comprehension, and application:

- **Recall** — "What does `X` return when given an empty list?"
- **Comprehension** — "Why does this handler validate before writing to the DB?"
- **Application** — "If you needed to add a new field to `Y`, which files change?"

Use multiple choice (via AskUserQuestion) when there's a clean set of plausible
options — one right, two or three believable distractors drawn from real
alternatives in the code. Use free-text when the answer is a design rationale, a
trace, or anything where the reasoning matters more than picking an option; ask
those in plain prose and let the reader type back.

## Step 4: Pose one question at a time and grade it

Ask, wait for the answer, grade, then move on. For each answer:

- Say whether it's right, partly right, or wrong — plainly, no fake praise.
- Explain *why*, tied to the specific `file:line` or behavior. On a wrong answer,
  show what the right reasoning looks like, not just the correct letter.
- On a partial answer, name the piece they got and the piece they missed.

Keep the tone that of a study partner, not an examiner. A wrong answer is the most
useful moment in the session — spend the explanation there.

## Step 5: Adapt the difficulty

Track how it's going and adjust live:

- Two right in a row → make the next question harder (edge cases, tradeoffs,
  "what breaks if...").
- A miss → ease off, and circle back to the missed idea from a different angle a
  question or two later to confirm it stuck.

Tell the reader when you're stepping the difficulty up or down so the calibration
is transparent.

## Step 6: Score and point to the gaps

At the end of a round, give a short scorecard: how many landed, which concepts are
solid, and which ones to revisit. Turn the weak spots into a concrete next step —
the file to reread, the flow to trace, or an offer to run `/walkthrough` on the
part that tripped them up. Ask whether they want another round, harder or on a new
area. End on the specific thing they clearly understood well.
