#!/usr/bin/env bash
# ABOUTME: Snapshots Claude Code subagent JSONL transcripts into docs/playtest/transcripts/ + commits + pushes.
# ABOUTME: Designed to run in a background loop during a multi-agent playtest so container restart can't lose the transcripts.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
DEST_DIR="$REPO_ROOT/docs/playtest/transcripts"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
INTERVAL="${INTERVAL:-180}"      # seconds between snapshots
MAX_PUSH_RETRIES="${MAX_PUSH_RETRIES:-4}"

# Source subagent JSONL directory. Caller MUST pass the parent-session id via
# CC_SESSION_ID so the script captures only THIS run's subagents (not unrelated
# historical agents in the project's accumulated transcript store). The subagent
# IDs to capture are passed as args; with no args, the script captures all
# subagent transcripts under the named session.
: "${CC_SESSION_ID:?CC_SESSION_ID env var required — current Claude Code session id (the directory name under /root/.claude/projects/.../)}"
SUB_DIR="/root/.claude/projects/-home-user-industrial-juggernaut/$CC_SESSION_ID/subagents"
# Optional: limit to specific agent IDs (e.g. SUB_AGENT_IDS="ac9e6612098ce031b a5077355d604c9581").
SUB_AGENT_IDS="${SUB_AGENT_IDS:-}"

mkdir -p "$DEST_DIR"

snapshot_once() {
  local copied=0
  if [ -n "$SUB_AGENT_IDS" ]; then
    for id in $SUB_AGENT_IDS; do
      local src="$SUB_DIR/agent-${id}.jsonl"
      [ -e "$src" ] || continue
      cp -- "$src" "$DEST_DIR/agent-${id}.jsonl"
      copied=$((copied + 1))
    done
  else
    for src in "$SUB_DIR"/agent-*.jsonl; do
      [ -e "$src" ] || continue
      local base
      base="$(basename "$src")"
      cp -- "$src" "$DEST_DIR/$base"
      copied=$((copied + 1))
    done
  fi
  if [ "$copied" -eq 0 ]; then
    return 1
  fi

  git add -- "$DEST_DIR"
  # Skip if nothing actually changed (no diff in the staged set).
  if git diff --cached --quiet -- "$DEST_DIR"; then
    return 2
  fi
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git commit -m "playtest(transcripts): snapshot $ts" --quiet || return 3

  # Push with rebase-and-retry on BAL-2 race (concurrent commit on remote).
  local attempt=1
  while [ "$attempt" -le "$MAX_PUSH_RETRIES" ]; do
    git fetch origin "$BRANCH" --quiet || true
    git rebase "origin/$BRANCH" --quiet || true
    if git push origin "$BRANCH" --quiet 2>/dev/null; then
      return 0
    fi
    sleep "$((attempt * 2))"
    attempt=$((attempt + 1))
  done
  echo "snapshot $ts committed locally but push failed after $MAX_PUSH_RETRIES retries" >&2
  return 4
}

main_loop() {
  while true; do
    sleep "$INTERVAL"
    if snapshot_once; then
      echo "snapshot ok @ $(date -u +%H:%M:%S)"
    fi
  done
}

case "${1:-loop}" in
  once)
    snapshot_once || true
    ;;
  loop|*)
    main_loop
    ;;
esac
