# Epic 355: Final Security Audit Fixes (Round 9)

**Status**: IN PROGRESS
**Priority**: Critical (#1), High (#2-#6)
**Branch**: `desktop`

## Summary

Security audit conducted 2026-03-16 identified 6 findings across the codebase. Three fixed immediately (#3, #4, #6), three require deeper changes (#1, #2, #5).

## Findings & Status

### Fixed

**#3 — Prometheus metrics endpoint has no auth** ✅
- Added `METRICS_SCRAPE_TOKEN` bearer check
- Falls back to authenticated admin if no token configured
- File: `apps/worker/routes/metrics.ts`

**#4 — Offline queue stores bodies unencrypted in localStorage** ✅
- Queue bodies now encrypted via `encryptDraft`/`decryptDraft`
- Backwards-compatible: reads legacy unencrypted JSON
- File: `src/client/lib/offline-queue.ts`

**#6 — Android CrashReporter uses unencrypted SharedPreferences** ✅
- Switched to `EncryptedSharedPreferences` (AES-256-GCM)
- Fallback to plain if Keystore unavailable
- File: `apps/android/.../CrashReporter.kt`

### In Progress

**#1 — CRITICAL: nsec enters webview JS during device provisioning** 🔄
- Adding Rust `encrypt_nsec_for_provisioning()` function
- WASM + Tauri IPC exports
- `platform.ts` function eliminates `getNsecFromState()` call
- Wire format uses HKDF (fixes #2 simultaneously)

**#2 — SHA-256 concat KDF instead of HKDF in provisioning** 🔄
- Fixed as part of #1 — new Rust function uses HKDF

### Remaining

**#5 — Provisioning decryption assumes x-only pubkey format**
- Need to verify `getPublicKeyHex()` return format
- Add format detection in `decryptProvisionedNsec`
- Low risk: only affects device provisioning flow

## Security Context
- Threat model: nation-state adversaries, physical device seizure
- Pre-production: wire format breaks acceptable
- All fixes follow existing patterns in the codebase
