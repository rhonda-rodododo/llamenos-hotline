# Epic 342: Smart Case Assignment & Routing

**Status**: PENDING
**Priority**: Medium
**Depends on**: Epic 340 (Volunteer Profiles), Epic 319 (Record Entity)
**Branch**: `desktop`

## Summary

When a new case is created (e.g., an arrest is reported), the system should suggest which volunteer(s) to assign based on: availability (not on break, under capacity), specialization match (volunteer trained for this case type), workload balance (assign to least-loaded), and language match (volunteer speaks the contact's language). This replaces pure manual assignment with intelligent suggestions while keeping the admin in control.

## Problem Statement

Currently, case assignment is fully manual — the admin picks a volunteer from a flat list. With 50+ active cases during a mass arrest, this doesn't scale. The admin needs:
- "Show me who's available and trained for jail support"
- "Who has the fewest active cases right now?"
- "Who speaks Spanish?" (for a Spanish-speaking arrestee)

## Implementation

1. **Assignment suggestion API** — `GET /api/records/:id/suggest-assignees`
   - Filters: on-shift, not on break, under maxCaseAssignments
   - Scores: specialization match, current workload, language match
   - Returns ranked list of suggested volunteers with scores

2. **Assignment UI enhancement** — the "Assign" dialog shows:
   - Suggested volunteers at top with match reasons ("Spanish speaker, 3/10 cases")
   - All other available volunteers below
   - Workload bar next to each name

3. **Auto-assignment option** — for high-volume scenarios (mutual aid, mass arrest):
   - Toggle: "Auto-assign new cases"
   - Round-robin among available volunteers with capacity
   - Respects specialization preferences

## Acceptance Criteria

- [ ] Assignment dialog shows suggested volunteers with match reasons
- [ ] Suggestions consider: availability, workload, specialization, language
- [ ] Auto-assignment distributes evenly among available volunteers
- [ ] Workload visible in assignment UI (X/Y cases)
