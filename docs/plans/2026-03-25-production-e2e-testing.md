# Production E2E Testing Against Ansible Deployment

**Date:** 2026-03-25
**Status:** Spec
**Depends on:** Local VM Ansible Testing (Complete)

## Problem Statement

The Ansible deployment is validated (15 bugs fixed, all services healthy, reboot survival confirmed). But E2E tests that work against the dev server fail against the production Docker build. Two distinct issues:

### Issue 1: Cross-platform PBKDF2 divergence (FIXED)

`preloadEncryptedKey` ran PBKDF2 in Node.js but decryption happened in Chromium. On macOS ARM64, the derived keys differed → "Wrong PIN".

**Fix (committed):** Run `importKey` inside the browser via `page.evaluate` + `window.__TEST_KEY_MANAGER`.

### Issue 2: `importKey` fails in production bundle

After moving to browser-side `importKey`, it throws:
```
TypeError: Cannot read properties of undefined (reading 'importKey')
```
at `zx → z3 → Q3 [as importKey]` inside the minified bundle. This means a dependency inside `importKey` (likely `nip19.decode`, `getPublicKey`, or `storeEncryptedKey` internals) is undefined at runtime in the production build.

**Root cause candidates:**
1. **Tree-shaking removed a dependency** — `importKey` is only called in response to user actions (PIN entry, not initial load). Vite may tree-shake `@noble/curves/secp256k1` or `nostr-tools` exports if they appear unused at the top-level.
2. **Lazy import timing** — `window.__TEST_KEY_MANAGER` is populated via dynamic `import('./lib/key-manager')` in `main.tsx`. If the module loads but its transitive deps haven't initialized yet, methods might fail.
3. **Production-only code path** — the production build may handle `import.meta.env.DEV` differently, gating some test helpers.

## Plan

### Phase 1: Diagnose the production bundle error

- [ ] Run the production build locally (`bun run build && bun run start`) and reproduce the `importKey` error with a minimal Playwright test
- [ ] Check if `window.__TEST_KEY_MANAGER` resolves fully (all methods defined) vs partially (some undefined)
- [ ] Identify which specific internal call fails by adding error boundary logging in `importKey`
- [ ] Compare the dev-mode bundle (where tests pass) vs production bundle for tree-shaking differences

### Phase 2: Fix the production bundle

Based on Phase 1 findings, likely one of:
- [ ] Add side-effect annotations to prevent tree-shaking critical crypto deps
- [ ] Ensure `__TEST_KEY_MANAGER` module is fully loaded before tests access it
- [ ] Or: use a simpler test-only endpoint (like `/api/test-login`) that does key setup server-side

### Phase 3: SSL for production E2E

The Ansible deploy uses Caddy with Let's Encrypt (production) or internal CA (staging). For E2E tests:
- [ ] Tests should run against HTTP (`:80` with `tls_mode: off`) for local VM testing
- [ ] For production-like testing, Caddy internal CA + `ignoreHTTPSErrors` in Playwright
- [ ] Document the test configuration in the deployment docs

### Phase 4: Run full E2E suite

- [ ] Run all UI tests against the Ansible-deployed VM from the Mac
- [ ] Compare pass/fail rates against local dev server results
- [ ] Fix any deployment-specific failures (e.g., WebSocket relay URL, CSP headers)

## Test Infrastructure

```
Mac (M4)
├── Playwright + Chromium (test runner)
├── HTTP → VM:80 (Caddy, tls_mode: off)
└── Tart VM (Ubuntu 24.04 ARM64)
    ├── Docker: app, postgres, caddy, minio, strfry
    ├── ADMIN_PUBKEY matches test nsec
    ├── DEV_RESET_SECRET=test-reset-secret
    └── USE_TEST_ADAPTER=true
```

## What already works

- Global setup (test-reset): PASS
- Auth guard tests (unauthenticated routing): PASS
- API 401 tests: PASS
- All services healthy, reboot survival confirmed

## What fails

- Any test that calls `loginAsAdmin` or `loginAsVolunteer` (all UI tests with auth)

## Root Cause Identified (2026-03-25)

**`crypto.subtle` requires a secure context (HTTPS or `localhost`).** The app uses WebCrypto for PBKDF2 key derivation, Schnorr signatures, and ECDH. On `http://192.168.64.2`, `crypto.subtle` is undefined and the app cannot function.

This is not a test issue — it's a fundamental browser security restriction. Tests MUST run against a secure context:

### Option A: `/etc/hosts` + HTTPS (recommended for production-like testing)
```bash
# On the Mac (requires sudo)
echo "192.168.64.2 llamenos.local" >> /etc/hosts

# Then run tests against HTTPS (Caddy internal CA)
# Set tls_mode: internal in vars
PLAYWRIGHT_BASE_URL=https://llamenos.local PLAYWRIGHT_IGNORE_HTTPS_ERRORS=1 npx playwright test
```

### Option B: `localhost` via SSH tunnel
Port 3000 needs `userland-proxy: true` in Docker daemon.json for SSH tunnel to work through iptables DNAT. With `userland-proxy: false`, tunneled connections are reset.

```bash
# In Docker daemon.json on VM: set "userland-proxy": true
# Then SSH tunnel from Mac: ssh -f -N -L 3333:127.0.0.1:3000 -p 2222 deploy@<VM_IP>
PLAYWRIGHT_BASE_URL=http://localhost:3333 npx playwright test
```

### Option C: socat + port 80 (HTTP)
Works for API tests but NOT for UI tests requiring `crypto.subtle`.

### Next step
Add `/etc/hosts` entry on the Mac (one-time manual setup), switch to `tls_mode: internal` + `PLAYWRIGHT_IGNORE_HTTPS_ERRORS=1`, and run the full suite.
