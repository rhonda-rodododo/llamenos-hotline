# Epic 83: Mobile Foundation — Core Setup & Auth Flow

## Problem Statement

The React Native mobile app at `~/projects/llamenos-mobile` is a bare Expo 55 scaffold with only a placeholder home screen. Volunteers need a mobile app to answer calls, but before any features can be built, the project needs: UI framework, state management, API client, crypto layer, Nostr relay connectivity, i18n, and a complete auth flow.

## Current State (`llamenos-mobile`)

### Project Scaffold
- **Expo SDK 55** (React Native 0.83, React 19.2)
- **Expo Router v7** (file-based routing in `app/` directory)
- **TypeScript strict** mode enabled
- **Path aliases**: `@/` → `src/`, `@core/` → `src/lib/core/`
- **Entry point**: `expo-router/entry` in package.json
- **Bundle ID**: `net.riseup.llamenos` (iOS + Android)
- **App display name**: "Hotline" (security — doesn't reveal org name)

### Existing Files
- `app/_layout.tsx` — Stack navigator with StatusBar (5 lines)
- `app/index.tsx` — HomeScreen placeholder (10 lines)
- `src/lib/api-client.ts` — Stub with `ApiClientConfig` interface only
- `src/lib/auth.ts` — `AuthState` interface only (no logic)
- `src/lib/core/index.ts` — UniFFI bridge placeholder (`CORE_AVAILABLE = false`)
- `src/components/.gitkeep`, `src/screens/.gitkeep`, `src/navigation/.gitkeep`

### What's NOT set up yet
- No NativeWind/Tailwind styling
- No Zustand/React Query
- No crypto (no `@noble/*`, no polyfills)
- No `nostr-tools`
- No i18n
- No auth flow
- No API client implementation
- No metro.config.js or babel.config.js customizations

## Technical Design

### Phase 1: Project Infrastructure

#### NativeWind v4 Setup

**Source**: [nativewind.dev/docs/getting-started/installation](https://www.nativewind.dev/docs/getting-started/installation)

NativeWind v4.2.x uses **Tailwind CSS v3** (NOT v4). The `presets: [require("nativewind/preset")]` is mandatory.

**Install:**
```bash
cd ~/projects/llamenos-mobile
npx expo install nativewind react-native-reanimated react-native-safe-area-context
bun add -D tailwindcss@^3.4.17 prettier-plugin-tailwindcss@^0.5.11
npx tailwindcss init
```

**Files to create:**

`tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Reuse web app design tokens from llamenos
      colors: {
        primary: { DEFAULT: 'hsl(221.2 83.2% 53.3%)', foreground: 'hsl(210 40% 98%)' },
        destructive: { DEFAULT: 'hsl(0 84.2% 60.2%)', foreground: 'hsl(210 40% 98%)' },
        muted: { DEFAULT: 'hsl(210 40% 96.1%)', foreground: 'hsl(215.4 16.3% 46.9%)' },
      },
    },
  },
  plugins: [],
}
```

`babel.config.js`:
```javascript
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  }
}
```

`metro.config.js`:
```javascript
const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")
const config = getDefaultConfig(__dirname)
module.exports = withNativeWind(config, { input: "./global.css" })
```

`global.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`nativewind-env.d.ts`:
```typescript
/// <reference types="nativewind/types" />
```

#### State Management

**Zustand v5** for client state, **React Query v5** for server state.

**Install:**
```bash
npx expo install zustand @tanstack/react-query react-native-mmkv expo-network
```

**Zustand persistence**: Use MMKV (~30x faster than AsyncStorage). MMKV is synchronous, which avoids hydration flash issues.

```typescript
// src/lib/store.ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { MMKV } from 'react-native-mmkv'

const storage = new MMKV()
const mmkvStorage = {
  getItem: (name: string) => storage.getString(name) ?? null,
  setItem: (name: string, value: string) => storage.set(name, value),
  removeItem: (name: string) => storage.delete(name),
}

interface AuthState {
  isAuthenticated: boolean
  publicKey: string | null
  role: 'admin' | 'volunteer' | 'reporter' | null
  isAdmin: boolean
  profileCompleted: boolean
  setAuth: (pubkey: string, role: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      publicKey: null,
      role: null,
      isAdmin: false,
      profileCompleted: false,
      setAuth: (pubkey, role) => set({
        isAuthenticated: true,
        publicKey: pubkey,
        role: role as AuthState['role'],
        isAdmin: role === 'admin',
      }),
      clearAuth: () => set({
        isAuthenticated: false, publicKey: null, role: null, isAdmin: false,
      }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        publicKey: state.publicKey,
        role: state.role,
        isAdmin: state.isAdmin,
        profileCompleted: state.profileCompleted,
      }),
    }
  )
)
```

**React Query setup** requires two RN-specific configurations:

```typescript
// src/lib/query-client.ts
import { QueryClient, onlineManager, focusManager } from '@tanstack/react-query'
import { AppState } from 'react-native'
import * as Network from 'expo-network'

// 1. Online status manager
onlineManager.setEventListener((setOnline) => {
  const sub = Network.addNetworkStateListener((state) => setOnline(!!state.isConnected))
  return sub.remove
})

// 2. Focus manager (refetch on app foreground)
AppState.addEventListener('change', (status) => {
  focusManager.setFocused(status === 'active')
})

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
})
```

### Phase 2: Crypto Layer

**Install:**
```bash
bun add @noble/curves @noble/ciphers @noble/hashes nostr-tools react-native-get-random-values
```

**Critical**: `react-native-get-random-values` must be imported **before** any `@noble/*` or `nostr-tools` imports. In `app/_layout.tsx` at the very top:
```typescript
import 'react-native-get-random-values'  // MUST be first import
import '../global.css'
// ... everything else
```

**Hermes BigInt**: Fully supported since RN 0.70. Expo SDK 55 (RN 0.83) has no BigInt issues. The historical `**` exponentiation → `Math.pow()` Babel transpilation issue is fixed in modern Expo where `hermes-stable` transform profile is default.

**`src/lib/crypto.ts`** — Port from web app's `src/client/lib/crypto.ts` (same code):
- Uses `@noble/curves/secp256k1` for ECDH + Schnorr (requires `.js` extension in imports)
- Uses `@noble/ciphers/chacha` for XChaCha20-Poly1305
- Uses `@noble/hashes/sha256`, `@noble/hashes/hkdf` for key derivation
- Domain separation via constants from `@shared/crypto-labels.ts` (copy to mobile or create shared package)

**Key difference from web**: No `crypto.subtle` in Hermes. All PBKDF2 uses `@noble/hashes/pbkdf2` directly (not Web Crypto API). The web app's `key-store.ts` already has a non-Web-Crypto path for this.

### Phase 3: Key Management

**`src/lib/key-manager.ts`** — Port from web app with expo-secure-store replacing localStorage.

**Install:**
```bash
npx expo install expo-secure-store
```

**expo-secure-store API** ([docs.expo.dev/versions/v55.0.0/sdk/securestore](https://docs.expo.dev/versions/v55.0.0/sdk/securestore)):
- `setItemAsync(key, value, options?)` — store string
- `getItemAsync(key, options?)` → `string | null`
- `deleteItemAsync(key, options?)`
- Values are **strings only** — serialize to hex/JSON
- Keys limited to alphanumeric + `.` `-` `_`
- iOS: Keychain with configurable accessibility
- Android: Keystore + EncryptedSharedPreferences
- Size limit: ~2KB on iOS (Keychain limit). Store only the encrypted nsec, not large data.

**Key storage design:**
```typescript
// Store encrypted nsec (PIN-encrypted via PBKDF2 + XChaCha20-Poly1305)
await SecureStore.setItemAsync('encrypted-nsec', JSON.stringify(encryptedKeyData), {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
})

// Store pubkey separately (not secret, needed for UI before unlock)
await SecureStore.setItemAsync('nostr-pubkey', pubkeyHex)
```

**Key manager singleton** — same pattern as web:
- Secret key held in closure (never exported)
- Auto-lock on `AppState` change to `background` (replaces web's `visibilitychange`)
- Auto-lock on idle timeout (5 min)
- `wipeKey()` on max PIN attempts
- `onLock()` / `onUnlock()` callbacks for UI updates

### Phase 4: Nostr Relay Connectivity

**Port from web app** (~1,050 LOC across 6 files). The existing code uses standard `WebSocket` API and `nostr-tools/pure` — both work in React Native.

**nostr-tools v2.23.0** — Same version as web app. Key imports:
- `nostr-tools/pure` → `finalizeEvent()`, `verifyEvent()`, `getPublicKey()`
- `nostr-tools/core` → types: `Event`, `VerifiedEvent`, `EventTemplate`
- `nostr-tools/nip19` → `nsecEncode()`, `npubEncode()`, `decode()`

**WebSocket**: React Native has native WebSocket support — same API as browser. No polyfill needed.

**Files to port:**
| Web Source | Mobile Target | Changes Needed |
|-----------|--------------|----------------|
| `src/client/lib/nostr/relay.ts` (342 LOC) | `src/lib/nostr/relay.ts` | Add NetInfo for network state |
| `src/client/lib/nostr/events.ts` (107 LOC) | `src/lib/nostr/events.ts` | None — pure functions |
| `src/client/lib/nostr/types.ts` (101 LOC) | `src/lib/nostr/types.ts` | None — pure types |
| `src/client/lib/nostr/hooks.ts` (45 LOC) | `src/lib/nostr/hooks.ts` | None — React hooks |
| `src/client/lib/nostr/context.tsx` (110 LOC) | `src/lib/nostr/context.tsx` | Remove `window.location` URL logic |
| `src/shared/nostr-events.ts` (48 LOC) | `src/lib/nostr/event-kinds.ts` | Copy constants |

**Critical change in `context.tsx`**: The web version builds relay URLs from `window.location`:
```typescript
// Web: converts relative URL to absolute
const wsUrl = relayUrl.startsWith('ws') ? relayUrl
  : `${protocol}//${host}${relayUrl}`
```
Mobile must always use an absolute `wss://` URL from the hub config.

**Network state integration**: Add `@react-native-community/netinfo` listener to pause/resume relay when device goes offline:
```typescript
import NetInfo from '@react-native-community/netinfo'

NetInfo.addEventListener((state) => {
  if (state.isConnected && relay.state === 'disconnected') {
    relay.connect()
  }
})
```

### Phase 5: API Client

**`src/lib/api-client.ts`** — HTTP client matching web app's REST API:
```typescript
import { keyManager } from './key-manager'

class ApiClient {
  constructor(private baseUrl: string) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000)
    const token = await keyManager.createAuthToken(timestamp, method, path)

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Pubkey': token.pubkey,
        'X-Auth-Timestamp': String(token.timestamp),
        'X-Auth-Token': token.token,
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new ApiError(res.status, text)
    }
    return res.json()
  }

  // Convenience methods
  get<T>(path: string) { return this.request<T>('GET', path) }
  post<T>(path: string, body: unknown) { return this.request<T>('POST', path, body) }
  put<T>(path: string, body: unknown) { return this.request<T>('PUT', path, body) }
  delete<T>(path: string) { return this.request<T>('DELETE', path) }
}
```

### Phase 6: i18n

**Install:**
```bash
npx expo install expo-localization
bun add react-i18next i18next
```

**Copy the 13 locale JSON files** from `~/projects/llamenos/src/client/locales/` to `~/projects/llamenos-mobile/src/locales/`.

**Configuration** (from [react-i18next docs](https://react.i18next.com/)):
```typescript
// src/lib/i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getLocales } from 'expo-localization'

import en from '../locales/en.json'
import es from '../locales/es.json'
// ... all 13 locales

const resources = { en: { translation: en }, es: { translation: es }, /* ... */ }
const deviceLanguage = getLocales()[0]?.languageCode ?? 'en'
const supportedLngs = Object.keys(resources)

i18n.use(initReactI18next).init({
  resources,
  lng: supportedLngs.includes(deviceLanguage) ? deviceLanguage : 'en',
  fallbackLng: 'en',
  supportedLngs,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },  // Required for React Native
})

export default i18n
```

**Key notes:**
- Do NOT use `i18next-http-backend` — bundle translations via Metro imports
- Do NOT use `i18next-browser-languagedetector` — use `expo-localization`
- Set `useSuspense: false` to avoid React Native Suspense boundary issues
- Arabic RTL: Use `I18nManager.forceRTL(true)` from `react-native`

### Phase 7: Auth Screens

**`app/login.tsx`** — Login screen:
- PIN input (returning user) → unlock key manager → navigate to dashboard
- "Import nsec" → paste from clipboard or file import
- "Link device" → navigate to `/link-device`
- Language selector (bottom)

**`app/onboarding.tsx`** — First-time setup:
1. Generate keypair via `generateKeyPair()`
2. Show nsec with copy button + security warning
3. Set 4-6 digit PIN → `encryptWithPin(nsec, pin, pubkey)`
4. Confirm PIN
5. Store encrypted nsec in expo-secure-store
6. Navigate to profile setup

**`app/link-device.tsx`** — Device linking:
- Camera QR scanner → read provisioning short code
- Or manual code entry
- ECDH provisioning protocol (from web app's `provisioning.ts`)

**`src/components/PinInput.tsx`** — Reusable:
- 4-6 individual digit inputs with auto-advance
- Biometric unlock option (expo-local-authentication)
- Max attempts counter → `wipeKey()` on 10 failures

### Root Layout (`app/_layout.tsx`)

```typescript
import 'react-native-get-random-values'  // MUST be first
import '../global.css'
import '../lib/i18n'

import { Stack } from 'expo-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { queryClient } from '../lib/query-client'
import i18n from '../lib/i18n'
import { useAuthStore } from '../lib/store'

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="link-device" options={{ title: 'Link Device' }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </I18nextProvider>
    </QueryClientProvider>
  )
}
```

## Files to Create

### Config
| File | Purpose |
|------|---------|
| `tailwind.config.js` | NativeWind config with web app design tokens |
| `babel.config.js` | NativeWind + Expo babel presets |
| `metro.config.js` | NativeWind metro wrapper |
| `global.css` | Tailwind directives |
| `nativewind-env.d.ts` | TypeScript declaration |

### Core Libraries
| File | Purpose | LOC Estimate |
|------|---------|-------------|
| `src/lib/crypto.ts` | Port of web crypto (all `@noble/*` ops) | ~400 |
| `src/lib/key-manager.ts` | PIN-protected key holder (expo-secure-store) | ~200 |
| `src/lib/key-store.ts` | Encrypted nsec storage (PBKDF2 + XChaCha20) | ~100 |
| `src/lib/api-client.ts` | HTTP client with Schnorr auth | ~80 |
| `src/lib/store.ts` | Zustand stores (auth, calls, shifts, settings) | ~150 |
| `src/lib/query-client.ts` | React Query setup with RN adapters | ~30 |
| `src/lib/i18n.ts` | i18n configuration | ~40 |
| `src/lib/nostr/relay.ts` | Relay manager (port from web) | ~350 |
| `src/lib/nostr/events.ts` | Event creation/validation (port) | ~110 |
| `src/lib/nostr/types.ts` | Event types (port) | ~100 |
| `src/lib/nostr/hooks.ts` | React hooks (port) | ~50 |
| `src/lib/nostr/context.tsx` | Nostr provider (rewrite for RN) | ~100 |
| `src/lib/nostr/event-kinds.ts` | Event kind constants (copy) | ~50 |
| `src/locales/*.json` | 13 locale files (copy from web) | N/A |

### Screens & Components
| File | Purpose |
|------|---------|
| `app/_layout.tsx` | Root layout with providers |
| `app/login.tsx` | Login / PIN unlock |
| `app/onboarding.tsx` | First-time keypair generation |
| `app/link-device.tsx` | QR code device linking |
| `src/components/PinInput.tsx` | PIN entry component |
| `src/components/Button.tsx` | Styled button (NativeWind) |
| `src/components/Input.tsx` | Styled text input |

## Acceptance Criteria

- [ ] `npx expo start` → app launches without crashes on iOS sim + Android emu
- [ ] NativeWind styling works (Tailwind classes render correctly)
- [ ] Can generate a keypair and see nsec/npub
- [ ] Can set PIN and encrypt/store nsec via expo-secure-store
- [ ] Can unlock with PIN and retrieve nsec
- [ ] Can create Schnorr auth tokens accepted by the server
- [ ] API client can fetch `/api/auth/me` with valid auth headers
- [ ] Nostr relay WebSocket connection establishes and authenticates (NIP-42)
- [ ] i18n works (switching locale changes UI strings)
- [ ] Auto-lock triggers on AppState → background
- [ ] Crypto output matches web app (same nsec → same pubkey, same encryption round-trips)
- [ ] React Query refetches on app foreground
- [ ] MMKV persistence works (auth state survives app restart)

## Dependencies

- **llamenos-core** — test vectors for cross-platform crypto verification
- **Web app API** — endpoints accessible from emulator/device (may need tunnel)

## Blocks

- **Epic 84** (Mobile Core Screens) — needs auth flow working
- **Epic 86** (Mobile Push Notifications) — needs API client working

## Open Questions

1. **API URL configuration**: How does the mobile app discover the API URL? Options: (a) hardcoded per build, (b) configurable in settings, (c) QR code during device linking includes the API URL. Recommended: QR code provisioning includes API + relay URLs.

2. **TextEncoder/TextDecoder**: Hermes may not have these natively. If `@noble/*` or `nostr-tools` needs them, add `fast-text-encoding` polyfill.

3. **Metro `.js` extension resolution**: `@noble/ciphers/chacha.js` style imports may need `sourceExts` configuration in metro.config.js.

4. **Expo Go vs dev build**: `expo-secure-store` with `requireAuthentication` doesn't work in Expo Go. Dev builds required for full testing.
