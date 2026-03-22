# PWA Offline Mode Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add E2E tests verifying service worker registration, offline UX indicators, and that critical app shell loads offline. Verify the API route exclusion from cache.

**Current state:** Tests cover install prompt and notification permission UX. No tests for service worker behavior or offline functionality.

**Note:** Deep offline functionality (offline note creation, sync) is NOT a core requirement for this app — volunteers need an active connection to answer calls. Tests focus on: SW registration, shell caching, API exclusion, and offline indicator.

---

## Phase 1: Service Worker Registration Tests

- [ ] Create `tests/pwa-offline.spec.ts`

### Test 1.1: Service worker registers on page load
```
Given: Fresh page load (no cached SW)
When: Navigate to /
Then: navigator.serviceWorker.ready resolves (SW registered and active)
Then: No SW registration errors in console
```
- [ ] Use `page.evaluate(() => navigator.serviceWorker.ready)` with timeout

### Test 1.2: Service worker caches app shell
```
Given: Service worker is active (test 1.1)
When: Inspect cache storage for precached assets
Then: cache contains: index.html, main JS bundle, main CSS bundle
Then: cache does NOT contain any /api/* responses
Then: cache does NOT contain any /telephony/* responses
```
- [ ] Use `page.evaluate(() => caches.keys())` then inspect cache contents

### Test 1.3: Workbox precache list is correct
```
Given: SW is registered
When: Inspect SW scope and precache manifest
Then: Precache includes .js, .css, .html, .svg, .woff2 files
Then: Precache does NOT include /api/ or /telephony/ patterns
```

---

## Phase 2: Offline Detection UX Tests

### Test 2.1: Offline banner appears when network goes offline
```
Given: Volunteer is logged in and viewing dashboard
When: page.context().setOffline(true)  // Playwright offline mode
Then: Offline banner component becomes visible
Then: Banner contains offline message (i18n key: common.offline or equivalent)
```
- [ ] Use `await page.context().setOffline(true)` (Playwright built-in)
- [ ] Check `[data-testid="offline-banner"]` visibility

### Test 2.2: Offline banner dismisses when network returns
```
Given: Offline banner is showing
When: page.context().setOffline(false)
Then: Offline banner disappears within 3 seconds
```

### Test 2.3: Call action buttons are disabled when offline
```
Given: Incoming call notification visible
When: page.context().setOffline(true)
Then: Answer button is disabled or shows offline warning
     (Answering a call requires server communication — cannot proceed offline)
```

### Test 2.4: Note form is disabled when offline
```
Given: Volunteer on the notes page
When: page.context().setOffline(true)
Then: "New Note" button is disabled or shows offline warning
```

---

## Phase 3: App Shell Offline Load Test

### Test 3.1: App shell loads from cache when offline
```
Given: Volunteer has visited the app before (SW cached)
When: page.context().setOffline(true)
When: Navigate to / (reload)
Then: App loads (no blank page, no network error)
Then: Login/PIN page renders from cache
Then: Console shows no fetch errors for static assets
```
- [ ] This is the "it loads at all" test — critical for volunteers in poor connectivity areas

### Test 3.2: API calls fail gracefully when offline
```
Given: App loaded from cache (test 3.1)
When: Attempt to load /calls page
Then: Error state shown (not blank screen)
Then: Error message is user-friendly (not raw network error)
```

---

## Phase 4: PWA Install Tests (extend existing)

- [ ] Extend `tests/notification-pwa.spec.ts` to verify:

### Test 4.1: Install prompt is shown in browser-supported contexts
```
Given: Browser fires beforeinstallprompt event (Playwright can simulate this)
Then: PWA install banner appears
```

### Test 4.2: Install banner dismissed state persists
```
Given: Install banner is showing
When: Click dismiss
Then: Banner hides
When: Reload page
Then: Banner still hidden (localStorage flag persists)
```
- This likely already exists — verify and mark as covered.

---

## Phase 5: Workbox Configuration Tests

### Test 5.1: SRI verification doesn't block app load
```
Given: App loaded with SW active
Then: No SRI mismatch errors in console
Then: No "Failed to verify content hash" errors
```
- [ ] Use `page.on('console', msg => ...)` to capture console errors

### Test 5.2: SW updates are applied after reload
```
Given: Service worker is registered
When: New SW version is deployed (simulate by changing SW source)
When: User navigates away and back
Then: New SW activates (no stale SW serving old content)
```
- Note: This is hard to fully automate. Document as manual verification step.

---

## Completion Checklist

- [ ] Service worker registers successfully in test environment
- [ ] `navigator.serviceWorker.ready` resolves without timeout
- [ ] Cache storage contains app shell, excludes /api/*
- [ ] Offline banner appears when `page.context().setOffline(true)`
- [ ] Offline banner disappears when network restored
- [ ] App shell renders from cache when offline
- [ ] No console errors from SRI verification
- [ ] `bunx playwright test tests/pwa-offline.spec.ts` passes
