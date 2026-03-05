# Epic 257: Desktop Tauri & Frontend Security Hardening

## Summary
Fix 9 desktop-specific vulnerabilities found in Security Audit Round 8: empty updater pubkey (C1), stateless IPC nsec exposure (C4), unsecured `get_nsec_from_state` (M2), PIN validation inconsistency (M3), client-side PIN brute-force (M4), test mock production guard (M5), demo nsec in production bundles (M6), and open redirect (M7).

## Context
- **Audit Round**: 8 (March 2026)
- **Severity breakdown**: 2 Critical, 5 Medium/Important
- The updater signing infrastructure exists in CI but the verification pubkey is empty — updates install unsigned
- Stateless IPC commands violate the core "nsec never enters the webview" invariant
- PIN attempt counters live in React component state, resetting on page refresh

## Implementation

### C1: Populate Tauri Updater Pubkey & Scope Signing Key

The updater pubkey must be populated from the existing signing keypair. The signing private key must be scoped to only the build steps that need it, not the workflow-level `env`.

**`apps/desktop/tauri.conf.json`** — set the pubkey:
```json
"updater": {
  "pubkey": "<base64-public-key-from-tauri-signer-generate>",
  "endpoints": [
    "https://github.com/rhonda-rodododo/llamenos/releases/latest/download/latest.json"
  ]
}
```

**`.github/workflows/tauri-release.yml`** — move signing env from top-level to per-step:
```yaml
# REMOVE from top-level env block:
# env:
#   TAURI_SIGNING_PRIVATE_KEY: ...
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ...

# ADD to each build step that needs it:
- name: Build (Linux)
  env:
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  run: bun run tauri:build
```

### C4: Remove Stateless IPC Commands from Production Handler

Remove stateless commands that accept `secret_key_hex` from the webview from the `generate_handler![]` list. No call sites in `platform.ts` use them — all crypto goes through `_from_state` variants.

**`apps/desktop/src/lib.rs`** — remove from handler registration:
```rust
// REMOVE these from generate_handler![]:
// crypto::ecies_unwrap_key,
// crypto::decrypt_note,
// crypto::decrypt_message,
// crypto::create_auth_token,
// crypto::decrypt_with_pin,
// crypto::get_public_key,
// crypto::sign_event,
// crypto::ecies_decrypt_content,
```

Keep only the `_from_state` variants. The stateless functions remain in `crypto.rs` for unit testing but are not registered as IPC handlers. Remove `decrypt_with_pin` which returns the bech32 nsec to the webview.

### M2: Gate `get_nsec_from_state` on One-Time Provisioning Token

Use a one-time token instead of a global boolean flag to prevent concurrent provisioning races. The token is generated, consumed once, then invalidated.

**`apps/desktop/src/crypto.rs`**:
```rust
pub struct CryptoState {
    secret_key: Option<SecretKey>,
    public_key: Option<XOnlyPublicKey>,
    provisioning_token: Option<String>,  // One-time use
}

#[tauri::command]
pub fn request_provisioning_token(state: State<'_, Mutex<CryptoState>>) -> Result<String, String> {
    let mut cs = state.lock().map_err(|e| e.to_string())?;
    let token = hex::encode(rand::random::<[u8; 16]>());
    cs.provisioning_token = Some(token.clone());
    Ok(token)
}

#[tauri::command]
pub fn get_nsec_from_state(
    token: String,
    state: State<'_, Mutex<CryptoState>>,
) -> Result<String, String> {
    let mut cs = state.lock().map_err(|e| e.to_string())?;
    match cs.provisioning_token.take() {  // Consume token — one-time use
        Some(expected) if expected == token => {},
        _ => return Err("Invalid or expired provisioning token".to_string()),
    }
    // ... existing nsec extraction
}
```

Update `platform.ts` provisioning flow to call `request_provisioning_token()` and pass the token to `get_nsec_from_state(token)`.

### M3: Consolidate PIN Validation

Create a single `isValidPin` in `key-manager.ts` and use it everywhere:

```typescript
// key-manager.ts
export function isValidPin(pin: string): boolean {
  return /^\d{6,8}$/.test(pin)  // Minimum 6 digits for security
}
```

Update `login.tsx` backup recovery to use `isValidPin()` instead of inline regex. Update `PinSetInline` component validation. The minimum is raised from 4 to 6 digits.

### M4: Persist PIN Attempt Counter in Rust

Move the PIN attempt counter from React state into the Tauri Store so it survives page refreshes.

**`apps/desktop/src/crypto.rs`** — add attempt tracking to `unlock_with_pin`:
```rust
#[tauri::command]
pub fn unlock_with_pin(
    data: String, pin: String,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<CryptoState>>
) -> Result<(), String> {
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let attempts: u32 = store.get("pin_failed_attempts")
        .and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let lockout_until: u64 = store.get("pin_lockout_until")
        .and_then(|v| v.as_u64()).unwrap_or(0);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;

    if now < lockout_until {
        return Err(format!("Locked out. Try again in {} seconds", (lockout_until - now) / 1000));
    }

    match decrypt_with_pin_inner(&data, &pin) {
        Ok(nsec) => {
            store.set("pin_failed_attempts", 0.into());
            store.set("pin_lockout_until", 0.into());
            // ... load nsec into CryptoState
            Ok(())
        }
        Err(_) => {
            let new_attempts = attempts + 1;
            store.set("pin_failed_attempts", new_attempts.into());
            let lockout_ms = match new_attempts {
                1..=4 => 0,
                5..=6 => 30_000,
                7..=8 => 120_000,
                9 => 600_000,
                _ => {
                    store.delete("encrypted_keys");
                    store.set("pin_failed_attempts", 0.into());
                    return Err("Too many failed attempts. Keys wiped.".to_string());
                }
            };
            if lockout_ms > 0 {
                store.set("pin_lockout_until", (now + lockout_ms).into());
            }
            Err("Wrong PIN".to_string())
        }
    }
}
```

Remove the JavaScript-side attempt counter from `PinUnlockInline` in `login.tsx`.

### M5: Production Guard on Test Mocks

**`tests/mocks/tauri-core.ts`** — add top-level guard:
```typescript
if (typeof import.meta.env.PLAYWRIGHT_TEST === 'undefined' || !import.meta.env.PLAYWRIGHT_TEST) {
  throw new Error('FATAL: Tauri IPC mock loaded outside test environment.')
}
```

### M6: Gate Demo Accounts Behind Dynamic Import

**`src/client/lib/demo-accounts.ts`** — make nsec loading conditional:
```typescript
let demoNsecs: Record<string, string> | null = null

export async function getDemoNsec(pubkey: string): Promise<string | undefined> {
  if (!demoNsecs) {
    const mod = await import('./demo-nsec-data')
    demoNsecs = mod.DEMO_NSECS
  }
  return demoNsecs[pubkey]
}
```

Move the hardcoded nsec map to a separate `demo-nsec-data.ts` file imported dynamically.

### M7: Validate returnTo Path

**`src/client/routes/login.tsx`**:
```typescript
const returnTo = sessionStorage.getItem('returnTo')
sessionStorage.removeItem('returnTo')
const safePath = returnTo && /^\/[^/:]/.test(returnTo) ? returnTo : '/'
navigate({ to: safePath })
```

## Tests

### Desktop E2E (Playwright)
- Test that updater config has non-empty pubkey (config validation test)
- Test PIN lockout persists across page navigation
- Test returnTo with `//evil.com` does not redirect externally
- Test demo accounts only load nsec when demo mode is active
- Test provisioning mode gating (mock IPC returns error when not in provisioning)

### Rust Unit Tests
- Test `get_nsec_from_state` returns error when provisioning not active
- Test `unlock_with_pin` increments attempt counter on failure
- Test lockout timing after 5+ failures
- Test key wipe after 10 failures

## Files to Modify
| File | Action |
|------|--------|
| `apps/desktop/tauri.conf.json` | Set updater pubkey |
| `apps/desktop/src/lib.rs` | Remove stateless commands from handler |
| `apps/desktop/src/crypto.rs` | Add provisioning mode, PIN attempt tracking |
| `.github/workflows/tauri-release.yml` | Scope signing key env to build steps |
| `src/client/lib/key-manager.ts` | Consolidate PIN validation (min 6 digits) |
| `src/client/routes/login.tsx` | Use isValidPin, fix returnTo validation |
| `src/client/lib/demo-accounts.ts` | Dynamic import for nsec data |
| `src/client/lib/demo-nsec-data.ts` | Create — extracted nsec map |
| `tests/mocks/tauri-core.ts` | Add production guard |
| `tests/desktop/` | Add PIN lockout, returnTo, provisioning tests |

## Dependencies
- Tauri updater pubkey requires access to the private key (in GitHub Secrets) to derive the public key
- PIN validation minimum change from 4 to 6 digits — existing 4-5 digit PINs will need re-creation
- ECIES KDF changes (Epic 259) must be coordinated with stateless command removal
