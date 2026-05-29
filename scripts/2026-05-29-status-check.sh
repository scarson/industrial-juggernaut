#!/bin/bash
# 2026-05-29 status check. Snapshots all sweep activity.
cd /home/user/industrial-juggernaut

echo "=== Master chain status ==="
tail -5 /tmp/master-chain.log 2>/dev/null

echo ""
echo "=== Active sweep processes ==="
ps aux | grep "tsx src/sweep" | grep -v grep | awk '{print $14}' | head

echo ""
echo "=== Waiting chains ==="
ps aux | grep -E "chain-" | grep -v grep | awk '{print $14}' | head

echo ""
echo "=== JSONL line counts ==="
for f in docs/sweeps/data/2026-05-29-*.jsonl; do
  if [ -e "$f" ]; then
    n=$(wc -l < "$f")
    echo "  $(basename "$f"): $n lines"
  fi
done

echo ""
echo "=== Reports landed ==="
for f in docs/2026-05-29-*.md; do
  echo "  $(basename "$f")"
done

echo ""
echo "=== Recent commits (last 5) ==="
git log --oneline -5
