#!/usr/bin/env bash
# Migration: v1.44.0.0 — state directory ~/.gstack moves to ~/.g6
#
# What changed: g6's state root is now ~/.g6. Every existing reference —
# 769 across bin/ scripts, 33 skill templates, user shell history — keeps
# working because ~/.gstack becomes a symlink to ~/.g6. Open file handles
# survive the rename (same inodes); new opens via either path resolve to
# the same directory.
#
# Affected: every install created before v1.44.0.0.
#
# Guards (never destroy, always idempotent):
#   1. ~/.gstack already a symlink            → done (previous run).
#   2. ~/.g6 exists AND ~/.gstack is a real dir → conflict; do nothing and
#      warn. Merging two state dirs automatically risks clobbering
#      learnings/config — a human decides.
#   3. ~/.gstack is a real dir, no ~/.g6      → mv, then symlink back.
#   4. Neither exists                          → create ~/.g6 + symlink.
set -u

_OLD="$HOME/.gstack"
_NEW="$HOME/.g6"

if [ -L "$_OLD" ]; then
  # Already migrated (or user made their own arrangement) — leave it alone.
  exit 0
fi

if [ -d "$_OLD" ] && [ -e "$_NEW" ]; then
  echo "[migrate v1.44.0.0] Both $_OLD and $_NEW exist — not merging automatically." >&2
  echo "[migrate v1.44.0.0] Resolve manually: keep one, then: ln -s .g6 $_OLD" >&2
  exit 0
fi

if [ -d "$_OLD" ]; then
  # mv within the same filesystem is a rename(2) — atomic. The only gap is
  # between mv and ln; both are sub-millisecond. Fall back gracefully if mv
  # fails (cross-device HOME layouts): leave everything untouched.
  if mv "$_OLD" "$_NEW" 2>/dev/null; then
    ln -s ".g6" "$_OLD" || {
      # Symlink failed (exotic fs) — undo the move so old paths keep working.
      mv "$_NEW" "$_OLD" 2>/dev/null || true
      echo "[migrate v1.44.0.0] Could not create compat symlink — reverted move." >&2
      exit 0
    }
    echo "[migrate v1.44.0.0] State moved to $_NEW ($_OLD is now a compat symlink)."
  else
    echo "[migrate v1.44.0.0] Could not move $_OLD — leaving layout unchanged." >&2
  fi
  exit 0
fi

# Fresh machine: no state yet. Create the new layout directly.
mkdir -p "$_NEW" 2>/dev/null || exit 0
[ -e "$_OLD" ] || ln -s ".g6" "$_OLD" 2>/dev/null || true
exit 0
