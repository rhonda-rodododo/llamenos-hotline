# Epic 94: Build Cleanup, Test Infrastructure & Dead Code Removal

**Status**: Planned
**Depends on**: Epic 93 (Tauri-Only TS Migration)

## Goal

1. Remove all web/browser-only code and unused dependencies
2. **Create a Tauri IPC mock layer** so Playwright E2E tests continue working in a browser
3. Simplify Vite config and package.json scripts
4. Update CLAUDE.md, README.md, and memory docs

## Context: The Testing Problem

After Epic 93, `platform.ts` always calls `tauriInvoke()` which imports `@tauri-apps/api/core`. In a plain browser (where Playwright tests run), this fails because there's no Tauri runtime.

**Why not Playwright-inside-Tauri?** Tauri's webview on Linux uses WebKitGTK, which does NOT support Chrome DevTools Protocol (CDP). Playwright's `connectOverCDP()` only works with Chromium/WebView2 (Windows). Since our dev machine is Linux and CI runs on Ubuntu, this approach is not viable.

**Solution: Vite alias mocking.** During test builds, Vite aliases `@tauri-apps/api/core` and `@tauri-apps/plugin-store` to mock modules that route IPC commands to the JS crypto implementations. This is:
- Zero production code changes — mocks live in `tests/`
- Build-time substitution — mock code is never in production bundles
- Full compatibility — all 42 Playwright test files work unchanged
- The mock maintains a CryptoState (secret key in closure) just like the real Rust side

## Phase 1: Create Tauri IPC Mock Layer

### 1.1 Directory Structure

```
tests/
  mocks/
    tauri-core.ts          # Mock @tauri-apps/api/core
    tauri-store.ts         # Mock @tauri-apps/plugin-store
    tauri-ipc-handler.ts   # IPC command router with CryptoState
    crypto-impl.ts         # JS crypto (moved from src/client/lib/crypto.ts)
```

### 1.2 `tests/mocks/crypto-impl.ts`

**Move** the contents of `src/client/lib/crypto.ts` here (not delete — relocate as test infrastructure). This file is no longer imported by production code but powers the test mock.

### 1.3 `tests/mocks/tauri-ipc-handler.ts`

The mock maintains a CryptoState and routes IPC commands to JS crypto:

```typescript
import {
  generateKeyPair, keyPairFromNsec, isValidNsec,
  createAuthToken, eciesWrapKey, eciesUnwrapKey,
  encryptNoteV2, decryptNoteV2,
  encryptMessage, decryptMessage,
  decryptCallRecord, decryptNote as decryptLegacyNote,
  decryptTranscription, encryptDraft, decryptDraft, encryptExport,
} from './crypto-impl'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js'
import { nip19, getPublicKey, finalizeEvent } from 'nostr-tools'

// --- Mock CryptoState (mirrors Rust CryptoState) ---
let secretKeyHex: string | null = null
let publicKeyHex: string | null = null

function requireUnlocked(): string {
  if (!secretKeyHex) throw new Error('CryptoState is locked')
  return secretKeyHex
}

function requirePublicKey(): string {
  if (!publicKeyHex) throw new Error('CryptoState is locked')
  return publicKeyHex
}

// --- Mock PIN storage (mirrors Tauri Store keys.json) ---
const STORE_KEY = 'llamenos-test-encrypted-key'

// --- IPC Command Router ---
export async function handleInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    // --- Keypair operations (stateless) ---
    case 'generate_keypair': {
      const kp = generateKeyPair()
      return {
        secretKeyHex: bytesToHex(kp.secretKey),
        publicKey: kp.publicKey,
        nsec: kp.nsec,
        npub: kp.npub,
      }
    }
    case 'get_public_key': {
      const pk = getPublicKey(hexToBytes(args.secretKeyHex as string))
      return pk
    }
    case 'is_valid_nsec':
      return isValidNsec(args.nsec as string)
    case 'key_pair_from_nsec': {
      const kp = keyPairFromNsec(args.nsec as string)
      if (!kp) throw new Error('Invalid nsec')
      return {
        secretKeyHex: bytesToHex(kp.secretKey),
        publicKey: kp.publicKey,
        nsec: kp.nsec,
        npub: kp.npub,
      }
    }

    // --- CryptoState management ---
    case 'import_key_to_state': {
      const nsec = args.nsec as string
      const pin = args.pin as string
      const pubkeyHex = args.pubkeyHex as string
      // Store encrypted key (reuse key-store logic in the mock)
      const { storeEncryptedKey } = await import('./key-store-impl')
      const encData = await storeEncryptedKey(nsec, pin, pubkeyHex)
      // Also load into CryptoState
      const decoded = nip19.decode(nsec)
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
      secretKeyHex = bytesToHex(decoded.data)
      publicKeyHex = pubkeyHex
      return encData
    }
    case 'unlock_with_pin': {
      const data = args.data as Record<string, unknown>
      const pin = args.pin as string
      const { decryptWithPin } = await import('./key-store-impl')
      const nsec = await decryptWithPin(data, pin)
      if (!nsec) throw new Error('Wrong PIN')
      const decoded = nip19.decode(nsec)
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
      secretKeyHex = bytesToHex(decoded.data)
      publicKeyHex = getPublicKey(decoded.data)
      return publicKeyHex
    }
    case 'lock_crypto':
      secretKeyHex = null
      // Keep publicKeyHex for display
      return undefined
    case 'is_crypto_unlocked':
      return secretKeyHex !== null
    case 'get_public_key_from_state':
      return requirePublicKey()
    case 'get_nsec_from_state': {
      const sk = requireUnlocked()
      return nip19.nsecEncode(hexToBytes(sk))
    }

    // --- Stateful crypto (use CryptoState) ---
    case 'create_auth_token_from_state': {
      const sk = requireUnlocked()
      return createAuthToken(
        hexToBytes(sk),
        args.timestamp as number,
        args.method as string,
        args.path as string,
      )
    }
    case 'create_auth_token': {
      // Stateless variant (for sign-in flow)
      return createAuthToken(
        hexToBytes(args.secretKeyHex as string),
        args.timestamp as number,
        args.method as string,
        args.path as string,
      )
    }
    case 'ecies_wrap_key':
      return eciesWrapKey(
        hexToBytes(args.keyHex as string),
        args.recipientPubkey as string,
        args.label as string,
      )
    case 'ecies_unwrap_key_from_state': {
      const sk = requireUnlocked()
      const envelope = args.envelope as { wrappedKey: string; ephemeralPubkey: string }
      const result = eciesUnwrapKey(envelope, hexToBytes(sk), args.label as string)
      return bytesToHex(result)
    }
    case 'encrypt_note':
      return encryptNoteV2(
        JSON.parse(args.payloadJson as string),
        args.authorPubkey as string,
        args.adminPubkeys as string[],
      )
    case 'decrypt_note_from_state': {
      const sk = requireUnlocked()
      const envelope = args.envelope as { wrappedKey: string; ephemeralPubkey: string }
      const result = decryptNoteV2(args.encryptedContent as string, envelope, hexToBytes(sk))
      return result ? JSON.stringify(result) : null
    }
    case 'encrypt_message':
      return encryptMessage(args.plaintext as string, args.readerPubkeys as string[])
    case 'decrypt_message_from_state': {
      const sk = requireUnlocked()
      const pk = requirePublicKey()
      return decryptMessage(
        args.encryptedContent as string,
        args.readerEnvelopes as Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>,
        hexToBytes(sk),
        pk,
      )
    }
    case 'decrypt_call_record_from_state': {
      const sk = requireUnlocked()
      const pk = requirePublicKey()
      return decryptCallRecord(
        args.encryptedContent as string,
        args.adminEnvelopes as Array<{ pubkey: string; wrappedKey: string; ephemeralPubkey: string }>,
        hexToBytes(sk),
        pk,
      )
    }
    case 'decrypt_legacy_note_from_state': {
      const sk = requireUnlocked()
      return decryptLegacyNote(args.packedHex as string, hexToBytes(sk))
    }
    case 'decrypt_transcription_from_state': {
      const sk = requireUnlocked()
      return decryptTranscription(
        args.packedHex as string,
        args.ephemeralPubkeyHex as string,
        hexToBytes(sk),
      )
    }
    case 'encrypt_draft_from_state': {
      const sk = requireUnlocked()
      return encryptDraft(args.plaintext as string, hexToBytes(sk))
    }
    case 'decrypt_draft_from_state': {
      const sk = requireUnlocked()
      return decryptDraft(args.packedHex as string, hexToBytes(sk))
    }
    case 'encrypt_export_from_state': {
      const sk = requireUnlocked()
      const bytes = encryptExport(args.jsonString as string, hexToBytes(sk))
      // Return base64 (matching Rust Epic 92 behavior)
      return btoa(String.fromCharCode(...bytes))
    }
    case 'sign_nostr_event_from_state': {
      const sk = requireUnlocked()
      const template = {
        kind: args.kind as number,
        created_at: args.createdAt as number,
        tags: args.tags as string[][],
        content: args.content as string,
      }
      const event = finalizeEvent(template, hexToBytes(sk))
      return event
    }
    case 'verify_schnorr':
      // Stateless — use nostr-tools verifyEvent or noble/curves
      return true // Simplified for tests

    // --- File crypto (ECIES through CryptoState) ---
    case 'decrypt_file_metadata_from_state': {
      const sk = requireUnlocked()
      // Route to ecies_decrypt_content equivalent
      const { decryptFileMetadata } = await import('../../src/client/lib/file-crypto')
      const result = decryptFileMetadata(
        args.encryptedContentHex as string,
        args.ephemeralPubkeyHex as string,
        hexToBytes(sk),
      )
      return result ? JSON.stringify(result) : null
    }
    case 'unwrap_file_key_from_state': {
      const sk = requireUnlocked()
      const envelope = args.envelope as { wrappedKey: string; ephemeralPubkey: string }
      const result = eciesUnwrapKey(envelope, hexToBytes(sk), 'llamenos:file-key')
      return bytesToHex(result)
    }
    case 'unwrap_hub_key_from_state': {
      const sk = requireUnlocked()
      const envelope = args.envelope as { wrappedKey: string; ephemeralPubkey: string }
      const result = eciesUnwrapKey(envelope, hexToBytes(sk), 'llamenos:hub-key-wrap')
      return bytesToHex(result)
    }

    default:
      console.warn(`[tauri-mock] Unknown IPC command: ${cmd}`)
      throw new Error(`Unknown Tauri IPC command: ${cmd}`)
  }
}
```

### 1.4 `tests/mocks/tauri-core.ts`

Mock replacement for `@tauri-apps/api/core`:

```typescript
import { handleInvoke } from './tauri-ipc-handler'

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return handleInvoke(cmd, args ?? {}) as T
}

// Re-export other @tauri-apps/api/core exports that the app may use
export function transformCallback(callback: (response: unknown) => void): number {
  return 0 // Stub
}
```

### 1.5 `tests/mocks/tauri-store.ts`

Mock replacement for `@tauri-apps/plugin-store`:

```typescript
/**
 * Mock Tauri Store using localStorage.
 * Each store name maps to a localStorage key prefix.
 */
class MockStore {
  private prefix: string

  constructor(name: string) {
    this.prefix = `tauri-store:${name}:`
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = localStorage.getItem(this.prefix + key)
    if (raw === null) return null
    return JSON.parse(raw) as T
  }

  async set(key: string, value: unknown): Promise<void> {
    localStorage.setItem(this.prefix + key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key)
  }

  async clear(): Promise<void> {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(this.prefix)) toRemove.push(k)
    }
    toRemove.forEach(k => localStorage.removeItem(k))
  }

  async save(): Promise<void> {
    // No-op — localStorage persists automatically
  }
}

const storeCache = new Map<string, MockStore>()

export const Store = {
  async load(name: string): Promise<MockStore> {
    let store = storeCache.get(name)
    if (!store) {
      store = new MockStore(name)
      storeCache.set(name, store)
    }
    return store
  },
}
```

### 1.6 `tests/mocks/key-store-impl.ts`

Extracted PIN encryption/decryption for the mock (mirrors key-store.ts logic):

```typescript
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'

const PBKDF2_ITERATIONS = 600_000

async function deriveKEK(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial, 256,
  )
  return new Uint8Array(derived)
}

export async function storeEncryptedKey(nsec: string, pin: string, pubkey: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const kek = await deriveKEK(pin, salt)
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const cipher = xchacha20poly1305(kek, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(nsec))

  const encoder = new TextEncoder()
  const hashInput = encoder.encode(`llamenos:keyid:${pubkey}`)
  const hashBuf = await crypto.subtle.digest('SHA-256', hashInput)
  const pubkeyHash = bytesToHex(new Uint8Array(hashBuf)).slice(0, 16)

  return {
    salt: bytesToHex(salt),
    iterations: PBKDF2_ITERATIONS,
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
    pubkey: pubkeyHash,
  }
}

export async function decryptWithPin(
  data: Record<string, unknown>,
  pin: string,
): Promise<string | null> {
  try {
    const salt = hexToBytes(data.salt as string)
    const nonce = hexToBytes(data.nonce as string)
    const ciphertext = hexToBytes(data.ciphertext as string)
    const kek = await deriveKEK(pin, salt)
    const cipher = xchacha20poly1305(kek, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}
```

### 1.7 Vite Config: Test Build Aliases

In `vite.config.ts`, add conditional aliases when `PLAYWRIGHT_TEST` env var is set:

```typescript
const isTestBuild = !!process.env.PLAYWRIGHT_TEST

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/client'),
      '@shared': path.resolve(__dirname, './src/shared'),
      // Test builds: mock Tauri IPC so Playwright can run in a regular browser
      ...(isTestBuild ? {
        '@tauri-apps/api/core': path.resolve(__dirname, 'tests/mocks/tauri-core.ts'),
        '@tauri-apps/plugin-store': path.resolve(__dirname, 'tests/mocks/tauri-store.ts'),
      } : {}),
    },
  },
})
```

### 1.8 Update Playwright Config

In `playwright.config.ts`, update the webServer command to set `PLAYWRIGHT_TEST`:

```typescript
webServer: {
  command: 'PLAYWRIGHT_TEST=true bun run build && bunx wrangler dev --port 8788',
  // ...
}
```

### 1.9 Update Test Helpers

**`tests/helpers.ts`** — `preloadEncryptedKey()` currently writes to `localStorage['llamenos-encrypted-key']`. After the migration, the app reads from Tauri Store (mocked as `localStorage['tauri-store:keys.json:llamenos-encrypted-key']`).

Update `preloadEncryptedKey()` to write to the mock Store's key:

```typescript
async function preloadEncryptedKey(page: Page, nsec: string, pin: string): Promise<void> {
  // ... existing PBKDF2 + XChaCha20 encryption logic (unchanged) ...

  // Write to BOTH locations:
  // - Legacy localStorage key (in case any test helper reads it directly)
  // - Mock Tauri Store key (what platform.ts reads via mock Store)
  await page.evaluate(
    ({ legacyKey, storeKey, value }) => {
      localStorage.setItem(legacyKey, value)
      localStorage.setItem(storeKey, value)
    },
    {
      legacyKey: 'llamenos-encrypted-key',
      storeKey: 'tauri-store:keys.json:llamenos-encrypted-key',
      value: JSON.stringify(data),
    },
  )
}
```

### 1.10 Delete `notification-pwa.spec.ts`

This test file tests PWA push notifications — not applicable to desktop. Delete it.

## Phase 2: Move crypto.ts to Test Infrastructure

Instead of deleting `crypto.ts`, **move** it:

```bash
mv src/client/lib/crypto.ts tests/mocks/crypto-impl.ts
```

Update imports in the mock to reference the moved file. This preserves all JS crypto implementations as test infrastructure without them being part of the production bundle.

**Also move `key-store.ts`** — its PIN encryption logic is needed by the mock:

The logic is already extracted in `tests/mocks/key-store-impl.ts` (Phase 1.6), so `src/client/lib/key-store.ts` can be deleted.

## Phase 3: Delete Dead Files

| File | Action |
|------|--------|
| `src/client/lib/crypto.ts` | **MOVE** to `tests/mocks/crypto-impl.ts` |
| `src/client/lib/key-store.ts` | **DELETE** (logic extracted to `tests/mocks/key-store-impl.ts`) |
| `src/client/lib/sri-workbox-plugin.ts` | **DELETE** |
| `src/client/components/pwa-install-banner.tsx` | **DELETE** |
| `src/client/lib/use-pwa-install.ts` | **DELETE** |
| `tests/notification-pwa.spec.ts` | **DELETE** |

### Move Types Out of crypto.ts

Before moving `crypto.ts`, relocate `KeyEnvelope` and `RecipientKeyEnvelope` types to `@shared/types.ts` so production code can import them without depending on test files.

## Phase 4: Vite Config Simplification

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import path from 'path'
import { readFileSync } from 'fs'

const isTestBuild = !!process.env.PLAYWRIGHT_TEST

const buildTime = process.env.SOURCE_DATE_EPOCH
  ? new Date(parseInt(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString()
const buildCommit = process.env.GITHUB_SHA || 'dev'
const buildVersion = JSON.parse(readFileSync('./package.json', 'utf-8')).version

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/client/routes',
      generatedRouteTree: './src/client/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
  ],
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/client'),
      '@shared': path.resolve(__dirname, './src/shared'),
      ...(isTestBuild ? {
        '@tauri-apps/api/core': path.resolve(__dirname, 'tests/mocks/tauri-core.ts'),
        '@tauri-apps/plugin-store': path.resolve(__dirname, 'tests/mocks/tauri-store.ts'),
      } : {}),
    },
    conditions: ['import', 'module', 'default'],
  },
  define: {
    '__BUILD_TIME__': JSON.stringify(buildTime),
    '__BUILD_COMMIT__': JSON.stringify(buildCommit),
    '__BUILD_VERSION__': JSON.stringify(buildVersion),
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'esnext',
  },
  server: {
    host: process.env.TAURI_DEV_HOST || '0.0.0.0',
    strictPort: true,
  },
})
```

**Removed**: `VitePWA`, `sriWorkboxPlugin`, `isTauriDev`, `__TAURI__` define.

## Phase 5: Remove PWA Banner from Root Layout

Remove `PwaInstallBanner` import and rendering from `__root.tsx`.

## Phase 6: Update panic-wipe.ts

Remove service worker unregistration. Add Tauri Store cleanup:

```typescript
setTimeout(async () => {
  try { localStorage.clear() } catch {}
  try { sessionStorage.clear() } catch {}

  // Clear IndexedDB
  try {
    indexedDB.databases?.().then(dbs => {
      dbs.forEach(db => { if (db.name) indexedDB.deleteDatabase(db.name) })
    }).catch(() => {})
  } catch {}

  // Clear Tauri Store
  try {
    const { Store } = await import('@tauri-apps/plugin-store')
    for (const name of ['keys.json', 'settings.json', 'drafts.json']) {
      try {
        const store = await Store.load(name)
        await store.clear()
        await store.save()
      } catch {}
    }
  } catch {}

  window.location.href = '/login'
}, FLASH_DURATION_MS)
```

## Phase 7: Dependency Cleanup

```bash
bun remove vite-plugin-pwa
```

Keep: `@noble/curves`, `@noble/ciphers`, `@noble/hashes`, `nostr-tools`, `@simplewebauthn/*`, `@scure/base`.

## Phase 8: Remove isTauri()/isBrowser()

After Epic 93, no production code uses these. Remove from `platform.ts` and any remaining call sites. If a call site checked `isTauri()` before doing something, just do it unconditionally.

## Phase 9: CI/CD Updates

### `ci.yml` Changes

1. **Playwright E2E (CF Workers)**: Update webserver command to `PLAYWRIGHT_TEST=true bun run build && bunx wrangler dev --port 8788`
2. **Playwright E2E (Docker)**: The Docker build also needs the test mock. Add `PLAYWRIGHT_TEST=true` to the build step, OR create a separate test build step.
3. **Remove web deploy step** — no SPA deployment (moved to Epic 95)
4. **Keep Worker deploy** — API still runs on CF Workers
5. **Keep Vite build step** — still needed for Tauri and test builds

### `desktop-e2e.yml` Changes

No changes needed — WebdriverIO tests run against the real Tauri binary and already test native crypto IPC.

### New package.json scripts

```json
{
  "test": "PLAYWRIGHT_TEST=true bunx playwright test",
  "test:build": "PLAYWRIGHT_TEST=true bun run build"
}
```

## Phase 10: Documentation Updates

### CLAUDE.md

1. **Tech Stack**: Remove "PWA". Add "Desktop-only (Tauri v2)".
2. **Key Technical Patterns**: State `platform.ts` is Tauri-only. Remove "falls back to JS on browser".
3. **Gotchas**: Add note about `PLAYWRIGHT_TEST` env var for test builds with Tauri IPC mock.
4. **Development Commands**: Emphasize `bun run tauri:dev`. Note that `bun run dev` only works for test builds.
5. **Directory Structure**: Remove `crypto.ts`, `key-store.ts`. Add `tests/mocks/` description.
6. **Testing**: Document the Tauri IPC mock pattern.

### README.md

- Remove "Mobile responsive PWA", "Browser push notifications" references
- Update deployment section — desktop clients only (no web SPA)
- Keep self-hosted Docker section but note it's API-only (frontend via desktop app)
- Add desktop download instructions

### MEMORY.md

Update Multi-Platform Architecture section.

## Verification Checklist

```bash
# Dead files are deleted (crypto.ts moved to tests/mocks/)
test ! -f src/client/lib/crypto.ts
test ! -f src/client/lib/key-store.ts
test ! -f src/client/lib/sri-workbox-plugin.ts
test ! -f src/client/components/pwa-install-banner.tsx
test ! -f src/client/lib/use-pwa-install.ts

# Mock files exist
test -f tests/mocks/tauri-core.ts
test -f tests/mocks/tauri-store.ts
test -f tests/mocks/tauri-ipc-handler.ts
test -f tests/mocks/crypto-impl.ts

# No production imports from deleted files
grep -r "from './crypto'" src/client/         # zero
grep -r "from './key-store'" src/client/      # zero
grep -r "pwa-install-banner" src/client/      # zero

# Build succeeds
bun run typecheck
bun run build                                   # Production (Tauri)
PLAYWRIGHT_TEST=true bun run build              # Test build (mock IPC)

# All Playwright tests pass with mock
PLAYWRIGHT_TEST=true bunx playwright test

# Desktop E2E tests pass with real Tauri
bun run test:desktop

# Rust tests pass
cd ../llamenos-core && cargo test
```

## Files Changed

| File | Action |
|------|--------|
| `src/client/lib/crypto.ts` | **MOVE** → `tests/mocks/crypto-impl.ts` |
| `src/client/lib/key-store.ts` | **DELETE** |
| `src/client/lib/sri-workbox-plugin.ts` | **DELETE** |
| `src/client/components/pwa-install-banner.tsx` | **DELETE** |
| `src/client/lib/use-pwa-install.ts` | **DELETE** |
| `tests/notification-pwa.spec.ts` | **DELETE** |
| `tests/mocks/tauri-core.ts` | **NEW** |
| `tests/mocks/tauri-store.ts` | **NEW** |
| `tests/mocks/tauri-ipc-handler.ts` | **NEW** |
| `tests/mocks/key-store-impl.ts` | **NEW** |
| `tests/helpers.ts` | Update `preloadEncryptedKey()` for mock Store |
| `src/shared/types.ts` | Add `KeyEnvelope`, `RecipientKeyEnvelope` |
| `vite.config.ts` | Remove PWA, add test aliases |
| `playwright.config.ts` | Update webServer command |
| `src/client/routes/__root.tsx` | Remove PWA banner |
| `src/client/lib/panic-wipe.ts` | Remove SW cleanup, add Tauri Store cleanup |
| `package.json` | Remove `vite-plugin-pwa`, update scripts |
| `CLAUDE.md` | Update docs |
| `README.md` | Update docs |
