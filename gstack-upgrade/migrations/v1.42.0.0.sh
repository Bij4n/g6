#!/usr/bin/env bash
# Migration: v1.42.0.0 — open-gstack-browser/ skill dir renamed to open-g6-browser/
#
# What changed: the skill directory moved to open-g6-browser/ (frontmatter name
# was already open-g6-browser). A repo-level compat symlink
# open-gstack-browser -> open-g6-browser keeps any old path resolving, but
# installs created before the rename may have skill symlinks (connect-chrome,
# open-gstack-browser, prefixed variants) whose targets reference the old
# directory leaf.
#
# Affected: anyone who installed before v1.42.0.0. Re-running gstack-relink
# rebuilds the install-dir skill links from the current source tree, which
# repairs any link that still names the old directory. Idempotent: relink is
# a no-op when links already match.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
"$SCRIPT_DIR/bin/gstack-relink" 2>/dev/null || true

# Belt-and-braces: if an install-dir alias still points at a now-dangling
# old-leaf path, repoint it at the renamed dir. Never delete anything.
for _SKILLS_DIR in "$HOME/.claude/skills"; do
  [ -d "$_SKILLS_DIR" ] || continue
  for _ALIAS in connect-chrome gstack-connect-chrome open-gstack-browser gstack-open-gstack-browser; do
    _LINK="$_SKILLS_DIR/$_ALIAS"
    if [ -L "$_LINK" ] && [ ! -e "$_LINK" ]; then
      _TARGET="$(readlink "$_LINK" | sed 's|open-gstack-browser|open-g6-browser|')"
      if [ -e "$_SKILLS_DIR/$_TARGET" ] || [ -e "$_TARGET" ]; then
        ln -snf "$_TARGET" "$_LINK" 2>/dev/null || true
      fi
    fi
  done
done
exit 0
