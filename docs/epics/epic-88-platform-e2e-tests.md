# Epic 88: Desktop & Mobile E2E Tests

## Problem Statement

The web app has 38 Playwright test files covering all features, but the desktop and mobile apps have zero automated tests. Before release, both platforms need E2E test coverage proving core flows work: launch, auth, navigation, crypto operations, and platform-specific features (tray, push notifications).

## Requirements

### Desktop Tests (Playwright + Tauri WebDriver)

1. **Launch** — App opens, main window renders
2. **Navigation** — All 22 routes accessible and render
3. **Crypto** — Login via PIN, note encrypt/decrypt via Rust IPC
4. **System tray** — Show/hide window, quit app
5. **Single instance** — Second launch focuses existing window

### Mobile Tests (Detox)

1. **Auth flow** — Onboarding (generate keypair, set PIN), login (unlock)
2. **Dashboard** — Renders, shows shift status
3. **Notes** — Create note, view encrypted note
4. **Shifts** — View schedule, sign up for shift
5. **Admin** — Volunteer management (admin role)

## Technical Design

### Desktop Test Setup

Playwright can test Tauri apps via WebDriver protocol:

```typescript
// playwright.desktop.config.ts
export default defineConfig({
  use: {
    // Tauri WebDriver connection
    connectOptions: { wsEndpoint: 'ws://localhost:4444' },
  },
  webServer: {
    command: 'cargo tauri dev',
    port: 4444,
  },
})
```

Test files:
- `tests/desktop/launch.spec.ts` — App launches, window title correct
- `tests/desktop/navigation.spec.ts` — Navigate all routes
- `tests/desktop/crypto.spec.ts` — Login, encrypt note, decrypt note
- `tests/desktop/tray.spec.ts` — Tray show/hide/quit
- `tests/desktop/single-instance.spec.ts` — Duplicate launch handling

### Mobile Test Setup

Detox for React Native E2E testing:

```javascript
// .detoxrc.js
module.exports = {
  testRunner: { args: { config: 'e2e/jest.config.js' } },
  apps: {
    'ios.debug': { type: 'ios.app', binaryPath: '...', build: '...' },
    'android.debug': { type: 'android.apk', binaryPath: '...', build: '...' },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { type: 'iPhone 15' } },
    emulator: { type: 'android.emulator', device: { avdName: 'Pixel_7' } },
  },
}
```

Test files:
- `e2e/auth.test.ts` — Onboarding + login + PIN lock/unlock
- `e2e/dashboard.test.ts` — Dashboard rendering + shift status
- `e2e/notes.test.ts` — Note creation + encryption + viewing
- `e2e/shifts.test.ts` — Shift schedule + sign up
- `e2e/admin.test.ts` — Admin features (conditional on role)

### CI Integration

- Desktop tests: GitHub Actions with `cargo tauri build` + Playwright
- Mobile tests: GitHub Actions with iOS simulator + Android emulator (matrix)
- Both run on PR and release branches

## Files to Create

### Desktop (in `~/projects/llamenos`)
- `playwright.desktop.config.ts`
- `tests/desktop/launch.spec.ts`
- `tests/desktop/navigation.spec.ts`
- `tests/desktop/crypto.spec.ts`
- `tests/desktop/tray.spec.ts`
- `tests/desktop/single-instance.spec.ts`

### Mobile (in `~/projects/llamenos-mobile`)
- `.detoxrc.js`
- `e2e/jest.config.js`
- `e2e/auth.test.ts`
- `e2e/dashboard.test.ts`
- `e2e/notes.test.ts`
- `e2e/shifts.test.ts`
- `e2e/admin.test.ts`

## Acceptance Criteria

- [ ] Desktop: All 5 test files pass on macOS
- [ ] Desktop: Tests integrated into CI
- [ ] Mobile: All 5 test files pass on iOS simulator
- [ ] Mobile: All 5 test files pass on Android emulator
- [ ] Mobile: Tests integrated into CI
- [ ] No flaky tests (stable across 3 consecutive runs)

## Dependencies

- **Epic 82** (Desktop Route Verification) — desktop must work before testing
- **Epic 83** (Mobile Foundation) — mobile auth must work before testing
- **Epic 84** (Mobile Core Screens) — screens must exist before testing
