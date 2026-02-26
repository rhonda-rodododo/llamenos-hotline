# Epic 82: Desktop Route Verification & Webview Compatibility

## Problem Statement

The Tauri v2 desktop app (Epic 75) launches successfully and has 11 IPC crypto commands wired to `llamenos-core`, but no one has verified that all 22 web routes render correctly inside the Tauri webview. CSP violations, missing API connectivity, or JS errors specific to the webview environment could silently break features. This epic verifies the desktop app is fully functional before hardening (Epic 80) begins.

## Current State

### Tauri Configuration (`src-tauri/tauri.conf.json`)

**Current CSP** (string format):
```
default-src 'self' customprotocol: asset:;
connect-src ipc: http://ipc.localhost http://localhost:* ws://localhost:* https://*.llamenos.org wss://*.llamenos.org;
img-src 'self' asset: http://asset.localhost blob: data:;
style-src 'unsafe-inline' 'self';
font-src 'self' data:
```

**Tauri v2 CSP notes** (from [v2.tauri.app/security/csp](https://v2.tauri.app/security/csp/)):
- CSP accepts **string**, **object** (directive → sources map), or **null**
- Tauri **automatically appends nonces and hashes** to `script-src` and `style-src` at compile time for bundled code
- `'wasm-unsafe-eval'` must be added to `script-src` if WASM crypto (Epic 81 Phase 6) is used later
- `dangerousDisableAssetCspModification` (default `false`) disables auto nonce injection — leave as default

**Window config**: 1200x800, min 800x600, resizable, centered
**Bundle targets**: macOS, Windows, Linux (AppImage, deb, rpm, DMG, MSI/NSIS)
**Plugins**: Stronghold, Store, Notification, FS, Shell, Single-Instance, Window-State, Log, Updater, Autostart

### Capabilities (`src-tauri/capabilities/default.json`)

Current permissions use `:default` for most plugins:
```json
["core:default", "stronghold:default", "store:default", "notification:default",
 "fs:default", "shell:default", "updater:default", "window-state:default",
 "autostart:default", "log:default"]
```

**Concern**: `fs:default` and `shell:default` grant overly broad access. This is addressed in Epic 80 Phase 4.

### IPC Commands (11 registered in `src-tauri/src/crypto.rs`)

1. `ecies_wrap_key` / `ecies_unwrap_key`
2. `encrypt_note` / `decrypt_note`
3. `encrypt_message` / `decrypt_message`
4. `create_auth_token`
5. `encrypt_with_pin` / `decrypt_with_pin`
6. `generate_keypair` / `verify_schnorr`

Note: `get_public_key` is referenced in `platform.ts` but may not be registered as a Tauri command. Must verify.

### Platform Abstraction (`src/client/lib/platform.ts`, 268 lines)

Routes crypto by runtime:
- `isTauri()` → lazy `invoke<T>(cmd, args)` via `@tauri-apps/api/core`
- `isBrowser()` → dynamic import from `./crypto.ts` (JS `@noble/*`)
- 11 exported platform-aware async functions

**Potential issues to discover:**
- `window.location` usage in Nostr relay URL construction (`context.tsx:67-72`) — works in Tauri webview but the URL path may differ
- `navigator.serviceWorker` — not available in Tauri webview (PWA disabled when `TAURI_ENV_PLATFORM` set)
- `sessionStorage` / `localStorage` — available in webview but different storage path than browser

### Vite Config (Tauri-specific)

- PWA plugin disabled when `TAURI_ENV_PLATFORM` is set
- `__TAURI__` defined as build-time constant
- Dev server binds to `0.0.0.0` for Tauri dev
- Target set to `esnext` (webview engines support latest JS)

## Requirements

### Functional Requirements

1. All 22 TanStack routes render without JS errors in the Tauri webview
2. Login with nsec → verify `platform.ts` routes crypto to Tauri IPC (not JS fallback)
3. Note encryption/decryption works via Rust IPC
4. Auth token generation produces valid Schnorr signatures accepted by the API
5. System tray show/hide/quit works
6. Single-instance enforcement works (second launch focuses first window)
7. API connectivity works (CSP `connect-src` allows backend)
8. Nostr relay connection establishes (WSS allowed by CSP)

### Non-Functional Requirements

- Zero JS console errors during route navigation
- No CSP violations in the console
- Window state persists across restarts (size, position)

## Routes to Verify (22 total)

### Public/Auth (6)
| Route | Key Features | Potential Issues |
|-------|-------------|-----------------|
| `/login` | PIN input, nsec import, file picker | File picker needs `shell:allow-open` |
| `/setup` | Admin bootstrap wizard | API POST requests |
| `/onboarding` | Invite acceptance, keypair gen | `generateKeyPair()` IPC |
| `/profile-setup` | Name entry form | Simple — unlikely issues |
| `/link-device` | QR code scanning, ECDH | Camera access? QR library compatibility? |
| `/preferences` | Locale selection | i18n loading |

### Authenticated Volunteer (7)
| Route | Key Features | Potential Issues |
|-------|-------------|-----------------|
| `/` (Dashboard) | Active calls, presence, stats | Nostr relay connection required |
| `/notes` | E2EE note list, decryption | `decryptNote()` IPC |
| `/conversations` | Messaging threads | `decryptMessage()` IPC |
| `/reports` | Caller reports | Data fetching |
| `/settings` | PIN change, theme, language | `encryptWithPin()` / `decryptWithPin()` IPC |
| `/blasts` | Bulk messaging | Admin only — may need role guard |
| `/help` | Documentation | Static content |

### Authenticated Admin (9)
| Route | Key Features | Potential Issues |
|-------|-------------|-----------------|
| `/shifts` | Shift management | Calendar UI |
| `/volunteers` | Volunteer list | Data table |
| `/volunteers/$pubkey` | Detail page | Dynamic route param |
| `/calls` | Call history | `decryptCallRecord()` may need IPC |
| `/bans` | Ban management | Real-time updates |
| `/audit` | Hash-chained audit log | Large data, pagination |
| `/admin/settings` | Hub settings | Multi-section form |
| `/admin/hubs` | Multi-hub management | Hub switching |

## Technical Design

### Phase 1: Launch & Console Audit

1. Run `bun run tauri:dev`
2. Open webview dev tools (Cmd+Option+I on macOS, F12 on Windows)
3. Navigate to each of the 22 routes
4. Record all console errors, warnings, CSP violations
5. Check Network tab for failed requests

### Phase 2: CSP Fixes

**Likely CSP adjustments needed:**

1. **`connect-src`**: Current wildcard `https://*.llamenos.org` should work, but dev mode needs `http://localhost:8788` (wrangler dev server). Check if the dev server URL is correctly included.

2. **`worker-src`**: May be needed for AudioWorklet (transcription feature). Current CSP has no `worker-src` directive — falls back to `script-src` then `default-src`.

3. **`media-src`**: May be needed for call recording playback.

4. **`style-src 'unsafe-inline'`**: Required by Tailwind's runtime style injection. Cannot be removed without significant rework. Document this as accepted trade-off (already noted in Epic 80 Phase 3).

**CSP format migration**: Consider converting from string to object format for maintainability:
```json
{
  "app": {
    "security": {
      "csp": {
        "default-src": "'self' customprotocol: asset:",
        "connect-src": "ipc: http://ipc.localhost http://localhost:* ws://localhost:* https://*.llamenos.org wss://*.llamenos.org",
        "img-src": "'self' asset: http://asset.localhost blob: data:",
        "style-src": "'unsafe-inline' 'self'",
        "font-src": "'self' data:",
        "script-src": "'self'"
      }
    }
  }
}
```

Note: Tauri auto-appends nonces/hashes to `script-src` at compile time — don't manually add `'unsafe-inline'` for scripts.

### Phase 3: Crypto Verification

Test each IPC command end-to-end:

1. **Login flow**: Enter nsec → `encrypt_with_pin()` stores encrypted → `decrypt_with_pin()` on next unlock
2. **Key generation**: Onboarding → `generate_keypair()` returns KeyPair with nsec/npub
3. **Auth tokens**: Navigate to authenticated route → `create_auth_token()` → API accepts the signature
4. **Note encryption**: Create a note → `encrypt_note()` with author+admin envelopes
5. **Note decryption**: View a note → `decrypt_note()` recovers plaintext
6. **Message crypto**: If messaging enabled, `encrypt_message()` / `decrypt_message()`
7. **Schnorr verification**: `verify_schnorr()` — called during relay event validation

**Verify platform detection**: In browser console, confirm `isTauri()` returns `true` and `isBrowser()` returns `false`.

### Phase 4: System Integration

1. **Tray icon**: Minimize to tray → icon appears → click "Show" → window restores → click "Quit" → clean shutdown
2. **Single instance**: Launch second instance → first window focuses (no second window). **Note**: Single-instance plugin must be registered first in plugin chain (per Tauri docs).
3. **Window state**: Resize/move window → quit → relaunch → window at same position/size
4. **Auto-start**: Toggle auto-start setting → verify OS launch agent/registry entry created

## Files to Modify

- `src-tauri/tauri.conf.json` — CSP adjustments, possibly convert to object format
- `src-tauri/capabilities/default.json` — note issues for Epic 80, don't change yet
- `src/client/lib/platform.ts` — fix any routing issues discovered
- `src-tauri/src/crypto.rs` — add `get_public_key` command if missing
- `src-tauri/src/lib.rs` — verify plugin registration order (single-instance first)

## Acceptance Criteria

- [ ] All 22 routes render without JS errors in Tauri webview
- [ ] No CSP violations during normal operation
- [ ] `isTauri()` returns `true` in the webview
- [ ] Login + PIN encrypt/decrypt works via Rust IPC
- [ ] Note encryption/decryption works via Rust IPC
- [ ] Auth tokens are valid (API requests succeed)
- [ ] Nostr relay WebSocket connection establishes
- [ ] System tray show/hide/quit works
- [ ] Single-instance enforcement works
- [ ] Window state persistence works
- [ ] Issues documented for Epic 80 (hardening) and Epic 81 (crypto migration)

## Dependencies

- **Epic 75** (Tauri desktop scaffold) — complete
- **llamenos-core** — 17/17 tests passing

## Blocks

- **Epic 80** (Desktop Security Hardening) — cannot harden until baseline verified
- **Epic 81** (Native Crypto Migration) — cannot migrate until IPC routing verified
