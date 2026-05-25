---
name: g6-upgrade
version: 1.0.0
description: |
  Upgrade g6 to the latest version from Bij4n/g6. Pulls the latest commit,
  rebuilds binaries, and re-runs setup. Use when asked to "upgrade g6",
  "update g6", or "get the latest version".
triggers:
  - upgrade g6
  - update g6
  - get latest g6
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# /g6-upgrade

Upgrade g6 to the latest version from [Bij4n/g6](https://github.com/Bij4n/g6).

## Step 1: Find the install

```bash
G6_DIR=$(readlink -f ~/.claude/skills/g6 2>/dev/null || echo ~/.claude/skills/g6)
echo "g6 install: $G6_DIR"
cd "$G6_DIR"
git remote get-url origin
```

## Step 2: Pull and rebuild

```bash
cd "$G6_DIR"
git pull origin main
./setup -q
```

## Step 3: Confirm

```bash
cat "$G6_DIR/VERSION"
```

Report: "g6 updated to vX.Y.Z.W. Run /learn to see what changed in this project."
