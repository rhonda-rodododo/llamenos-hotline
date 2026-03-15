# Epic 342: Smart Case Assignment & Routing

**Status**: COMPLETED
**Priority**: Medium
**Depends on**: Epic 340 (Volunteer Profiles), Epic 319 (Record Entity)
**Branch**: `desktop`

## Summary

When a new case is created, the system suggests which volunteer(s) to assign based on: availability (not on break, under capacity), specialization match (volunteer trained for this case type), workload balance (assign to least-loaded), and language match (volunteer speaks the contact's language). This replaces pure manual assignment with intelligent suggestions while keeping the admin in control.

## Implementation

1. **Assignment suggestion API** — `GET /api/records/:id/suggest-assignees`
   - Filters: on-shift, not on break, under maxCaseAssignments
   - Scores: specialization match, current workload, language match
   - Returns ranked list of suggested volunteers with scores

2. **Assignment UI enhancement** — the "Assign" dialog shows:
   - Suggested volunteers at top with match reasons ("Spanish speaker, 3/10 cases")
   - All other available volunteers below
   - Workload bar next to each name

3. **Auto-assignment option** — for high-volume scenarios:
   - Toggle: "Auto-assign new cases"
   - Round-robin among available volunteers with capacity
   - Respects specialization preferences

## Acceptance Criteria

- [x] Assignment dialog shows suggested volunteers with match reasons
- [x] Suggestions consider: availability, workload, specialization, language
- [x] Auto-assignment distributes evenly among available volunteers
- [x] Workload visible in assignment UI (X/Y cases)

## Related

Report-to-case conversion workflow moved to [Epic 344](epic-344-report-triage-case-conversion.md).
