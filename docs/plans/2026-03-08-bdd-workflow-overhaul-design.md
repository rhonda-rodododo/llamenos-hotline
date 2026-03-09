# BDD-Driven Workflow Overhaul — Design Document

## Problem

Concurrent feature development across Desktop, iOS, and Android collides because:
1. Parallel agents touch overlapping files (API routes, i18n, shared types, test specs)
2. ~34 tests check UI element existence, not behavior — they pass even when features are broken
3. Epic workflow writes tests AFTER implementation, not before
4. No backend BDD suite — backend correctness is only verified indirectly through UI tests

## Solution

Restructure the development workflow into sequential phases where each phase's output
is the next phase's input, with shared BDD specs as the behavioral contract.

### Phased Development Flow

```
Phase 1: API + Locales + Shared BDD Specs (single agent)
  ├── Backend routes/DO methods (apps/worker/)
  ├── i18n strings (packages/i18n/locales/)
  ├── Shared .feature files (packages/test-specs/features/)
  ├── Backend step definitions (tests/steps/backend/)
  └── GATE: Backend BDD passes against Docker Compose

Phase 2: Client Implementation (parallel agents, non-overlapping dirs)
  ├── Agent 1: Desktop (src/client/, tests/steps/)
  ├── Agent 2: iOS (apps/ios/)
  └── Agent 3: Android (apps/android/)

Phase 3: Integration Gate
  └── bun run test:all
```

### Shared BDD Spec Structure

Reorganize `packages/test-specs/features/` into behavior-focused tiers:

```
features/
  core/                     # Tier 1: shared across all platforms + backend
    call-routing.feature
    messaging-flow.feature
    note-encryption.feature
    auth-login.feature
    volunteer-lifecycle.feature
  admin/                    # Tier 2: admin operations
    shift-management.feature
    ban-management.feature
    audit-log.feature
    blast-campaign.feature
    settings.feature
  security/                 # Tier 3: security-specific
    crypto-interop.feature
    e2ee-roundtrip.feature
    session-management.feature
  platform/                 # Platform-specific behaviors only
    desktop/
    ios/
    android/
```

### Backend BDD

Backend step definitions hit the API directly (no UI):
- Use existing simulation framework (6 endpoints + 3 resets)
- Use existing API helpers (authenticated CRUD for all entities)
- Run via Playwright test runner against Docker Compose
- Tag: `@backend` — separate Playwright project in config

### Test Cuts

- CUT 6 zero-value tests (screenshots, help-screen, bottom-navigation, mocked admin-system)
- REWRITE 34 shallow UI tests as behavior-focused BDD with real API assertions
- Consolidate into ~10 focused feature files

### Skills Overhaul

| Skill | Action |
|-------|--------|
| `epic-authoring` | Add BDD template: ACs map 1:1 to Gherkin scenarios |
| `test-orchestration` | Add backend BDD section, shared spec structure |
| `cross-platform-feature-port` | BDD specs as contract between platforms |
| `multi-platform-test-recovery` | Replace with `bdd-feature-development` |
| `backend-api-development` | Add backend BDD testing section |
| Others (10 skills) | No changes needed |

### CLAUDE.md + MEMORY.md Updates

- CLAUDE.md: Rewrite "Claude Code Working Style" for phased workflow
- MEMORY.md: Update cardinal rule (tests = spec), update workflow section
