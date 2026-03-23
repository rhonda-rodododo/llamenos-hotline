---
name: Plan tracking discipline
description: NEXT_BACKLOG.md is the single source of truth for plan status — every plan must be listed there and checked off on completion
type: feedback
---

NEXT_BACKLOG.md is the ONLY status tracker. Plan file checkboxes are working notes, not status.

**Why:** Plans were being created in docs/superpowers/plans/ but not added to NEXT_BACKLOG.md, and completed plans weren't being checked off in either location, making it impossible to tell what's done vs pending.

**How to apply:**
1. When creating a new plan, ALWAYS add it to NEXT_BACKLOG.md in the appropriate section
2. When completing a plan's implementation, check it off in NEXT_BACKLOG in the same commit (or immediately after)
3. Before starting implementation work, check NEXT_BACKLOG for the current state — don't rely on plan file checkboxes
4. Run `scripts/plan-status.sh` to catch drift between plans/ directory and NEXT_BACKLOG
5. Epic docs are feature descriptions, not trackers — don't create new epics unless the user asks
