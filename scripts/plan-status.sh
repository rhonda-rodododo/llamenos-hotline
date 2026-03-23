#!/usr/bin/env bash
# plan-status.sh — Cross-references docs/superpowers/plans/ against NEXT_BACKLOG.md
# Shows checkbox progress and backlog tracking status for every plan.
#
# Run: ./scripts/plan-status.sh

set -euo pipefail

PLANS_DIR="docs/superpowers/plans"
BACKLOG="docs/NEXT_BACKLOG.md"

if [ ! -d "$PLANS_DIR" ]; then
  echo "Error: $PLANS_DIR not found. Run from project root." >&2
  exit 1
fi

if [ ! -f "$BACKLOG" ]; then
  echo "Error: $BACKLOG not found." >&2
  exit 1
fi

missing=0
pending=0
completed=0
total=0
unchecked_total=0

printf "%-60s  %s  %s\n" "PLAN" "CHECKBOXES" "BACKLOG"
printf "%-60s  %s  %s\n" "----" "----------" "-------"

for plan in "$PLANS_DIR"/*.md; do
  name=$(basename "$plan")
  total=$((total + 1))

  # Count checkboxes
  cb_total=$(grep -cE '^\- \[' "$plan" || true)
  cb_done=$(grep -cE '^\- \[x\]' "$plan" || true)
  cb_todo=$((cb_total - cb_done))
  unchecked_total=$((unchecked_total + cb_todo))

  if [ "$cb_total" -eq 0 ]; then
    cb_str="  no tasks"
  else
    cb_str=$(printf "%3d/%3d" "$cb_done" "$cb_total")
  fi

  # Check backlog status
  if grep -q "$name" "$BACKLOG"; then
    if grep "$name" "$BACKLOG" | grep -q '\[x\]'; then
      bl_str="[x] done"
      completed=$((completed + 1))
    else
      bl_str="[ ] pending"
      pending=$((pending + 1))
    fi
  else
    bl_str="MISSING"
    missing=$((missing + 1))
  fi

  printf "%-60s  %s  %s\n" "$name" "$cb_str" "$bl_str"
done

echo ""
echo "Summary: $total plans — $completed done, $pending pending, $missing missing from backlog"
echo "Unchecked checkboxes across all plans: $unchecked_total"

if [ "$missing" -gt 0 ]; then
  echo ""
  echo "WARNING: $missing plan(s) not tracked in NEXT_BACKLOG.md"
  exit 1
fi
