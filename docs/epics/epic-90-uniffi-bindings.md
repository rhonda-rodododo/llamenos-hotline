# Epic 90: UniFFI Bindings for llamenos-core

## Problem Statement

The mobile app (Epic 83) initially uses `@noble/*` JavaScript crypto libraries, creating a third crypto implementation alongside Rust (desktop) and JS (web). Per Epic 81's vision, all platforms should converge on `llamenos-core` as the single auditable crypto implementation. UniFFI generates Swift and Kotlin bindings from the Rust crate, enabling React Native to use native Rust crypto instead of JS.

## Requirements

### Functional Requirements

1. **UniFFI annotations** — Add `#[uniffi::export]` to all public functions in llamenos-core
2. **Swift bindings** — Generated Swift package for iOS
3. **Kotlin bindings** — Generated Kotlin package for Android
4. **React Native native module** — Bridge wrapping UniFFI output for JS consumption
5. **Mobile crypto migration** — Replace `@noble/*` calls in mobile app with UniFFI native calls

### Non-Functional Requirements

- `cargo test` still passes with UniFFI annotations
- Cross-platform test vectors pass (Rust native, UniFFI Swift, UniFFI Kotlin produce same output)
- Native crypto is faster than JS crypto on mobile hardware
- WASM fallback available if UniFFI build fails

## Technical Design

### Phase 1: UniFFI Annotations

Add to `llamenos-core/src/lib.rs`:
```rust
#[uniffi::export]
pub fn ecies_wrap_key(...) -> Result<KeyEnvelope, CryptoError> { ... }

#[uniffi::export]
pub fn encrypt_note(...) -> Result<EncryptedNote, CryptoError> { ... }

// All 30+ public functions
```

Create `llamenos-core/uniffi.toml`:
```toml
[bindings.swift]
module_name = "LlamenosCore"

[bindings.kotlin]
package_name = "org.llamenos.core"
```

Create `llamenos-core/build.rs`:
```rust
fn main() {
    uniffi::generate_scaffolding("src/llamenos_core.udl").unwrap();
}
```

### Phase 2: Generate Bindings

```bash
# Swift
cargo build --release --features uniffi-bindgen
uniffi-bindgen generate --library target/release/libllamenos_core.dylib --language swift --out-dir ios/

# Kotlin
uniffi-bindgen generate --library target/release/libllamenos_core.so --language kotlin --out-dir android/
```

### Phase 3: React Native Native Module

Create a Turbo Native Module wrapping UniFFI:
- iOS: Swift wrapper calling generated Swift bindings
- Android: Kotlin wrapper calling generated Kotlin bindings
- JS interface: same `CryptoProvider` shape as web/desktop

### Phase 4: Mobile Migration

Replace `@noble/*` imports in mobile app with native module calls. Same pattern as Epic 81's platform abstraction — mobile gets a `nativeCryptoProvider` alongside browser's `wasmCryptoProvider` and desktop's `ipcCryptoProvider`.

## Files to Create/Modify

### llamenos-core (`~/projects/llamenos-core`)
- `src/lib.rs` — Add `#[uniffi::export]` annotations
- `uniffi.toml` — UniFFI configuration
- `build.rs` — UniFFI scaffolding generation
- `ios/` — Generated Swift package
- `android/` — Generated Kotlin package

### llamenos-mobile (`~/projects/llamenos-mobile`)
- `modules/llamenos-core/` — React Native Turbo Native Module
- `src/lib/crypto-native.ts` — Native crypto provider via UniFFI

## Acceptance Criteria

- [ ] `cargo test` passes with UniFFI annotations enabled
- [ ] Swift bindings compile for iOS (arm64)
- [ ] Kotlin bindings compile for Android (arm64-v8a, x86_64)
- [ ] React Native native module exposes all crypto functions
- [ ] Mobile crypto operations use native Rust instead of JS
- [ ] Cross-platform test vectors pass (Rust, Swift, Kotlin produce identical output)
- [ ] Performance improvement measured (native vs JS on mobile)

## Dependencies

- **llamenos-core** — all 17 tests passing, public API stable
- **Epic 83** (Mobile Foundation) — mobile project exists and builds
- **Epic 81** (Native Crypto Migration) — CryptoProvider interface design
