# Epic 341: Hub Context & Multi-Hub UX

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 61 (Multi-Hub Architecture)
**Branch**: `desktop`

## Summary

The CMS stores all data per-hub (ContactDirectoryDO, CaseDO scoped via `getScopedDOs(env, hubId)`), but the client doesn't always know which hub it's operating in. This epic makes hub context explicit in the UI and enables smooth multi-hub workflows for volunteers who work across hubs.

## Problem Statement

- The client auth context (`useAuth()`) doesn't expose `hubId`
- When a volunteer belongs to multiple hubs, the CMS needs to show data from the correct hub
- Hub switching should be seamless — change hub, see that hub's cases/contacts/templates
- The sidebar doesn't show which hub is active
- Case numbers are hub-scoped (JS-2026-0001 in Hub A vs JS-2026-0001 in Hub B)

## Implementation

1. **Hub selector in sidebar** — dropdown showing the volunteer's assigned hubs
2. **Active hub context** — stored in client state, sent as header/param on API calls
3. **Hub badge on cases/contacts** — when viewing cross-hub data, show which hub owns it
4. **Hub-specific entity types** — sidebar entity type links filtered by active hub's templates
5. **Hub switching preserves navigation** — changing hub on /cases stays on /cases but reloads data

## Acceptance Criteria

- [ ] Sidebar shows active hub name and hub selector for multi-hub volunteers
- [ ] Changing hub reloads cases, contacts, entity types for the new hub
- [ ] Single-hub volunteers see no hub selector (no unnecessary complexity)
- [ ] Hub context is sent on all CMS API calls
