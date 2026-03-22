# E2E Test Coverage Strategy — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Problem

The test suite is Playwright E2E only, but large sections of critical functionality have 0% coverage:
- E2EE encryption (notes, messages) — never tested end-to-end
- Call answering, parallel ringing, ban enforcement — never tested
- Nostr relay events — never tested
- WebAuthn registration / passkey login — never tested
- PWA offline mode — never tested
- i18n completeness — only en/es checked
- Spam mitigation (CAPTCHA, rate limits) — never tested

These gaps mean the most security-critical parts of the application have no regression protection.

## Goals

Seven independent test suites covering the gaps above. Each plan is a separate implementation unit.

## Approach

All tests are Playwright E2E against a running local stack (Docker Compose dev environment). There are no unit or integration tests — this is an explicit project decision (see CLAUDE.md). Tests run with `bunx playwright test` and must pass in CI.

Shared test infrastructure (helpers, fixtures) lives in `tests/helpers/` and is imported by all test files.

**Migration prerequisite:** The existing flat file `tests/helpers.ts` must be renamed to `tests/helpers/index.ts` as the first implementation step. All existing test files that import from `'./helpers'` or `'../helpers'` must have their import paths updated to point to the new location. The new helper files (`auth.ts`, `call-simulator.ts`, `crypto.ts`, `db.ts`) are added to `tests/helpers/` alongside `index.ts`.

---

## 1. E2EE Verification Tests

**What it must prove:** The server stores ciphertext, not plaintext. Decryption happens client-side and produces the original content.

**Strategy:**
- Expose `window.__llamenos_test_crypto` in `test`/`dev` builds — a narrow test hook that allows reading raw note ciphertext from the DB response (not decrypted content). This hook must be defined as:
  ```typescript
  interface LlamenosTestCrypto {
    getRawNoteResponse(noteId: string): Promise<Record<string, unknown>>;
  }
  ```
  It is exposed only when `import.meta.env.VITE_TEST_MODE === 'true'`. Production builds must NOT include this hook — enforce via a Vite plugin or conditional import. This hook is a prerequisite for E2EE test cases 1–5.
- Use two separate browser contexts (author + admin) to verify each can independently decrypt
- Use a third context (unauthorized volunteer) to verify decryption fails with their key

**Critical test cases:**
1. Note ciphertext in DB response does not contain any plaintext phrase from the note
2. Author decrypts their own note correctly
3. Admin decrypts any note (different key envelope)
4. Per-note forward secrecy: two notes from the same author have different `encryptedKey` values
5. Unauthorized volunteer gets 403 or cannot decrypt (envelope unwrap fails)
6. Hub key rotation: after departure of a member, their old session cannot decrypt new events

---

## 2. Call Flow Tests

**What it must prove:** The full inbound call lifecycle works — ring → answer → note → hangup → voicemail fallback.

**Strategy:**
- `simulateInboundCall(request, options)` helper: performs a two-step webhook sequence — (1) POST a Twilio-format webhook payload to `/api/telephony/incoming` to get the language menu response, then (2) POST to `/api/telephony/language-selected` to complete routing and trigger parallel ring. The endpoint is `/api/telephony/incoming` (not `/inbound`).
- Twilio webhook signature verification is bypassed in test mode (env flag)
- Two browser contexts for parallel ringing tests

**Critical test cases:**
1. Inbound call appears in dashboard active calls widget
2. Volunteer clicks "Answer" → call state changes to answered
3. Volunteer writes a note during the call → note saved
4. Volunteer hangs up → call ends, note preserved
5. Voicemail fallback: no volunteer answers within timeout → voicemail state
6. Parallel ringing: two volunteers see the call; first to answer wins; other's UI stops ringing
7. Ban enforcement: call from banned number → rejected at webhook, not routed
8. Rate limiting: rapid calls from same number → rate limit kicks in after threshold

---

## 3. Nostr Relay Tests

**What it must prove:** Real-time events are published to the relay, encrypted with the hub key, and clients receive and decrypt them.

**Strategy:**
- `subscribeToRelay(relayUrl, hubKey)` helper using `nostr-tools`
- Hub key extracted from the authenticated app state via test hook: expose `window.__llamenos_test_hub_key: () => Uint8Array | null` in test mode (same `VITE_TEST_MODE` guard as the crypto hook). The test calls `page.evaluate(() => window.__llamenos_test_hub_key())` to retrieve the current hub key bytes, then passes the returned value to the Node.js `subscribeToRelay` helper. This is required because the hub key lives in the browser's in-memory key store and cannot be obtained from the server.
- Listen for events before triggering the action, verify event arrives

**Critical test cases:**
1. Inbound call triggers `call:ring` Nostr event
2. Event content is ciphertext (not plaintext call metadata)
3. Content decrypts with hub key to expected type and callId
4. `call:answered` event fires after volunteer answers; other clients stop ringing
5. Hub key rotation event triggers key refresh in connected clients
6. REST polling fallback: when relay is unreachable, dashboard still shows correct state

---

## 4. Spam Mitigation Tests

**What it must prove:** Ban lists, rate limiting, and CAPTCHA are enforced correctly.

**Strategy:**
- Direct webhook simulation (same `simulateInboundCall` helper)
- Admin UI for toggling settings tested via Playwright

**Critical test cases:**
1. Banned number → call rejected immediately (not routed to volunteers)
2. Ban added via admin UI → immediate effect on next call from that number
3. Rate-limited number → second call within window rejected
4. Admin toggles CAPTCHA on → next simulated call requires digit input
5. CAPTCHA: wrong digits → call rejected after max attempts
6. CAPTCHA: correct digits → call routes normally
7. Priority order: ban > rate limit > CAPTCHA (banned number not charged against rate limit)

---

## 5. PWA Offline Tests

**What it must prove:** The PWA works offline — service worker caches app shell, shows offline banner, degrades gracefully.

**Strategy:**
- Playwright `page.context().setOffline(true/false)` for network simulation
- Check service worker registration and cache contents

**Critical test cases:**
1. App shell loads from service worker cache when offline
2. Offline banner (`OfflineBanner` component) appears when network goes down
3. Offline banner disappears when network restored
4. `/api/*` requests are NOT cached (service worker only caches static assets)
5. Writing a note while offline queues it; note is submitted when back online
6. Note text in offline queue is ciphertext (not plaintext) — verify no plaintext-before-encrypt race

---

## 6. WebAuthn Registration Tests

**What it must prove:** Passkey registration, login, and session management work correctly.

**Strategy:**
- Playwright CDP `WebAuthn.addVirtualAuthenticator` to create a virtual platform authenticator
- Run against the full auth flow

**Critical test cases:**
1. Volunteer registers a passkey during initial setup
2. Volunteer can log in with passkey (no nsec required)
3. Registering a second device (linking): device receives provisioned key correctly
4. Deleting a credential removes it and prevents login with that credential
5. Admin revokes all sessions for a volunteer → that volunteer is logged out
6. Multi-device: session on device A continues when session on device B is revoked

---

## 7. i18n Locale Tests

**What it must prove:** All 13 locales render without missing keys or layout breaks.

**Strategy:**
- Parametric test: loop over all 13 locales, set language, visit key pages, check for missing key patterns
- Dedicated check for Arabic RTL layout

**Critical test cases (per locale):**
1. Dashboard renders without `[missing:...]` or `{key}` placeholder strings
2. Login page renders in the locale's language
3. Arabic (`ar`): `document.dir === 'rtl'`, no horizontal overflow
4. Numbers and dates formatted according to locale conventions
5. Locale selection persists after page reload
6. A new script `scripts/check-locales.ts` must be created as part of this test suite implementation. It should scan all 13 locale JSON files against the `en` locale as a reference, reporting any keys present in `en` but missing in other locales. The test case passes when this script exits with code 0 (0 missing keys).

---

## Shared Test Infrastructure

All test suites use:
- `tests/helpers/auth.ts` — login as volunteer / admin
- `tests/helpers/call-simulator.ts` — `simulateInboundCall()`
- `tests/helpers/crypto.ts` — `subscribeToRelay()`, ciphertext inspection
- `tests/helpers/db.ts` — direct DB queries for state verification (test-only, never in production)

These helpers must be built as part of whichever test plan is implemented first.

---

## Implementation Order

Recommended order (dependency chain):
1. Shared helpers first (prerequisite for all suites)
2. Call flow tests (validates core functionality)
3. E2EE verification tests (validates security model)
4. Nostr relay tests (builds on call flow)
5. Spam mitigation tests (builds on call flow)
6. WebAuthn tests (independent)
7. PWA offline tests (independent)
8. i18n locale tests (independent, can run last)
