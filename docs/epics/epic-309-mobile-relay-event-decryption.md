# Epic 309: Mobile Relay Event Decryption Pipeline

**Status**: PENDING
**Priority**: Critical
**Depends on**: Epic 306 (relay delivery fixes — mobile now receives events but can't decrypt them)
**Blocks**: None
**Branch**: `desktop`

## Summary

Add hub event decryption to iOS and Android so mobile clients can actually use the Nostr relay events they now receive (fixed in Epic 306). Currently both platforms subscribe to the correct event kinds but try to parse encrypted hex as JSON, which silently fails. Desktop has a working implementation: fetch hub key via API, unwrap with ECIES, decrypt event content with XChaCha20-Poly1305. Mobile needs the same pipeline using existing UniFFI-exposed crypto primitives.

## Problem Statement

After Epic 306 fixed mobile kind filters and type strings, iOS and Android now receive relay events. But ALL event content is encrypted with XChaCha20-Poly1305 (Epic 252). Neither mobile client decrypts events before parsing:

**iOS** (`WebSocketService.swift`): Emits raw `NostrEvent` objects with encrypted `content` field. Consumers that try to read `content` get encrypted hex, not JSON.

**Android** (`WebSocketService.kt`): Calls `parseTypedEvent(event.content)` which attempts `JSON.parse()` on encrypted hex. This silently returns `null`, meaning every event falls through to `LlamenosEvent.Unknown`.

**Desktop** (working reference):
1. `hub-key-manager.ts` fetches wrapped hub key from `GET /api/hub/key`
2. Unwraps via Rust ECIES through Tauri IPC (`unwrapHubKey`)
3. `relay.ts:272-310` decrypts event content using `@noble/ciphers` XChaCha20-Poly1305
4. `parseLlamenosContent()` parses decrypted JSON into typed `LlamenosEvent`

**What mobile already has (from UniFFI)**:
- `eciesUnwrapKeyHex()` — can unwrap hub key envelope
- `CryptoService` singleton with `nsecHex` for ECIES operations

**What mobile is missing**:
- Hub key fetch + unwrap + caching
- XChaCha20-Poly1305 symmetric decrypt of event content
- Integration into WebSocket event pipeline

## Implementation

### Phase 1: Rust FFI — Hub Event Decrypt Function

#### Task 1: Add `decrypt_hub_event` to Rust FFI

The Rust crate already has XChaCha20-Poly1305 via `chacha20poly1305`. Add a function that takes the encrypted hex string + hub key bytes and returns decrypted JSON string.

**File**: `packages/crypto/src/ffi.rs`

```rust
/// Decrypt a hub event content string.
/// Input: hex-encoded encrypted payload (nonce || ciphertext || tag), 32-byte hub key.
/// Output: decrypted UTF-8 string (JSON).
#[uniffi::export]
pub fn decrypt_hub_event_hex(encrypted_hex: String, hub_key_hex: String) -> Result<String, CryptoError> {
    let encrypted = hex::decode(&encrypted_hex)
        .map_err(|_| CryptoError::InvalidInput("Invalid hex".into()))?;
    let hub_key = hex::decode(&hub_key_hex)
        .map_err(|_| CryptoError::InvalidInput("Invalid hub key hex".into()))?;

    if encrypted.len() < 24 + 16 {
        return Err(CryptoError::InvalidInput("Encrypted data too short".into()));
    }

    // Split: 24-byte nonce || ciphertext+tag
    let (nonce_bytes, ciphertext) = encrypted.split_at(24);
    let nonce = XNonce::from_slice(nonce_bytes);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&hub_key));
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed)?;

    String::from_utf8(plaintext)
        .map_err(|_| CryptoError::InvalidInput("Decrypted content is not valid UTF-8".into()))
}
```

Also add `unwrap_hub_key_hex` that uses the stored nsec to ECIES-unwrap a hub key envelope:

```rust
/// Unwrap a hub key envelope using the stored identity key.
/// Input: hex-encoded ECIES envelope (from GET /api/hub/key).
/// Output: hex-encoded 32-byte hub key.
#[uniffi::export]
pub fn unwrap_hub_key_from_state_hex(state: &CryptoState, envelope_hex: String) -> Result<String, CryptoError> {
    let envelope = hex::decode(&envelope_hex)
        .map_err(|_| CryptoError::InvalidInput("Invalid envelope hex".into()))?;
    let hub_key = ecies_decrypt(&state.secret_key_bytes()?, &envelope, LABEL_HUB_KEY_WRAP)?;
    Ok(hex::encode(hub_key))
}
```

**File**: `packages/crypto/src/lib.rs` — Ensure `LABEL_HUB_KEY_WRAP` constant is available in the FFI module.

#### Task 2: Rebuild mobile FFI binaries

```bash
bun run ios:xcframework    # Rebuild XCFramework with new FFI exports
bun run crypto:test:mobile # Verify tests pass with --features mobile
```

### Phase 2: iOS — Hub Key Manager + Event Decrypt

#### Task 3: iOS Hub Key Manager

**File**: `apps/ios/Sources/Services/HubKeyManager.swift` (new)

```swift
import Foundation

@Observable
final class HubKeyManager {
    private var hubKeyHex: String?
    private let cryptoService: CryptoService
    private let apiService: APIService

    init(cryptoService: CryptoService, apiService: APIService) {
        self.cryptoService = cryptoService
        self.apiService = apiService
    }

    /// Fetch and unwrap the hub key. Caches in memory.
    func getHubKey() async throws -> String {
        if let cached = hubKeyHex { return cached }

        let response = try await apiService.get("/api/hub/key")
        guard let envelopeHex = response["envelope"] as? String else {
            throw HubKeyError.noEnvelope
        }

        let keyHex = try cryptoService.unwrapHubKey(envelopeHex: envelopeHex)
        hubKeyHex = keyHex
        return keyHex
    }

    /// Decrypt hub event content. Returns nil if hub key not available.
    func decryptEventContent(_ encryptedHex: String) -> String? {
        guard let keyHex = hubKeyHex else { return nil }
        return try? CryptoService.decryptHubEvent(
            encryptedHex: encryptedHex,
            hubKeyHex: keyHex
        )
    }

    /// Clear cached key (on logout or hub key rotation)
    func clear() {
        hubKeyHex = nil
    }
}
```

#### Task 4: iOS WebSocketService decrypt integration

**File**: `apps/ios/Sources/Services/WebSocketService.swift`

Update `emitEvent()` to decrypt before broadcasting:

```swift
private func emitEvent(_ event: NostrEvent) {
    guard isLlamenosEvent(event) else { return }

    // Decrypt event content using hub key
    let decryptedContent = hubKeyManager?.decryptEventContent(event.content)
    let typedEvent = decryptedContent.flatMap { parseTypedContent($0) }

    // Emit both raw event and typed event
    eventContinuation?.yield((event, typedEvent))
}
```

Add `parseTypedContent()` method that parses decrypted JSON into `HubEventType`:

```swift
private func parseTypedContent(_ json: String) -> TypedHubEvent? {
    guard let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = obj["type"] as? String else { return nil }

    return switch HubEventType(rawValue: type) {
    case .callRing: .callRing(callId: obj["callId"] as? String ?? "")
    case .callUpdate: .callUpdate(callId: obj["callId"] as? String ?? "", status: obj["status"] as? String ?? "")
    case .voicemailNew: .voicemailNew(callId: obj["callId"] as? String ?? "")
    case .presenceSummary: .presenceSummary(hasAvailable: obj["hasAvailable"] as? Bool ?? false)
    case .messageNew: .messageNew(conversationId: obj["conversationId"] as? String ?? "")
    case .conversationAssigned: .conversationAssigned(conversationId: obj["conversationId"] as? String ?? "")
    case .conversationClosed: .conversationClosed(conversationId: obj["conversationId"] as? String ?? "")
    default: nil
    }
}
```

### Phase 3: Android — Hub Key Manager + Event Decrypt

#### Task 5: Android Hub Key Manager

**File**: `apps/android/app/src/main/java/org/llamenos/hotline/crypto/HubKeyManager.kt` (new)

```kotlin
@Singleton
class HubKeyManager @Inject constructor(
    private val cryptoService: CryptoService,
    private val apiClient: ApiClient,
) {
    private var hubKeyHex: String? = null

    suspend fun getHubKey(): String {
        hubKeyHex?.let { return it }

        val response = apiClient.get("/api/hub/key")
        val envelopeHex = response.getString("envelope")
        val keyHex = cryptoService.unwrapHubKey(envelopeHex)
        hubKeyHex = keyHex
        return keyHex
    }

    fun decryptEventContent(encryptedHex: String): String? {
        val keyHex = hubKeyHex ?: return null
        return try {
            CryptoService.decryptHubEvent(encryptedHex, keyHex)
        } catch (e: Exception) {
            null
        }
    }

    fun clear() {
        hubKeyHex = null
    }
}
```

#### Task 6: Android WebSocketService decrypt integration

**File**: `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt`

Update `handleMessage()` to decrypt before parsing:

```kotlin
private fun handleEvent(event: NostrEvent) {
    if (!isLlamenosEvent(event)) return

    // Decrypt event content using hub key
    val decryptedJson = hubKeyManager.decryptEventContent(event.content) ?: return
    val typedEvent = parseTypedEvent(decryptedJson) ?: return

    _typedEvents.tryEmit(typedEvent)
}
```

The existing `parseTypedEvent()` function already parses JSON — it just needs to receive decrypted content instead of encrypted hex.

### Phase 4: BDD Scenarios

#### Task 7: Shared BDD feature file

**File**: `packages/test-specs/features/core/mobile-event-decryption.feature`

```gherkin
@backend
Feature: Mobile Event Decryption Pipeline
  Mobile clients must decrypt hub-encrypted Nostr relay events
  before parsing them into typed events.

  Background:
    Given a registered admin "admin1"
    And a registered volunteer "vol1" on the current shift
    And the hub key is distributed to "vol1"

  @relay @crypto
  Scenario: Hub event content is decryptable with hub key
    When an incoming call arrives from "+15551234567"
    Then the relay should receive a kind 1000 event within 5 seconds
    And the event content should be decryptable with the hub key
    And the decrypted content should contain "type" = "call:ring"

  @relay @crypto
  Scenario: Decrypted event contains expected fields for call events
    When an incoming call arrives from "+15551234567"
    Then the relay should receive a kind 1000 event within 5 seconds
    And the decrypted content should contain a "callId" field
    And the decrypted content should NOT contain a "callerNumber" field

  @relay @crypto
  Scenario: Event with wrong key fails to decrypt
    When an incoming call arrives from "+15551234567"
    Then the relay should receive a kind 1000 event within 5 seconds
    And the event content should NOT be decryptable with a random key
```

### Phase 5: Integration Gate

`bun run test:all`

## Files to Create

| File | Purpose |
|------|---------|
| `apps/ios/Sources/Services/HubKeyManager.swift` | iOS hub key fetch, unwrap, cache, decrypt |
| `apps/android/app/src/main/java/org/llamenos/hotline/crypto/HubKeyManager.kt` | Android hub key fetch, unwrap, cache, decrypt |
| `packages/test-specs/features/core/mobile-event-decryption.feature` | BDD scenarios for decryption pipeline |
| `tests/steps/backend/mobile-event-decryption.steps.ts` | Backend step definitions |

## Files to Modify

| File | Change |
|------|--------|
| `packages/crypto/src/ffi.rs` | Add `decrypt_hub_event_hex()` and `unwrap_hub_key_from_state_hex()` |
| `packages/crypto/src/lib.rs` | Expose `LABEL_HUB_KEY_WRAP` to FFI module |
| `apps/ios/Sources/Services/WebSocketService.swift` | Add decrypt step before event emission |
| `apps/ios/Sources/Services/CryptoService.swift` | Add `unwrapHubKey()` and `decryptHubEvent()` wrappers |
| `apps/android/app/src/main/java/org/llamenos/hotline/api/WebSocketService.kt` | Add decrypt step before `parseTypedEvent()` |
| `apps/android/app/src/main/java/org/llamenos/hotline/crypto/CryptoService.kt` | Add `unwrapHubKey()` and `decryptHubEvent()` wrappers |

## Testing

### Rust Unit Tests
- `packages/crypto/src/ffi.rs` — test `decrypt_hub_event_hex` with known test vectors
- `cargo test --features mobile` — verify UniFFI bindings compile

### Backend BDD
- `bun run test:backend:bdd` — 3 scenarios in `mobile-event-decryption.feature`

### Mobile Unit Tests
- iOS XCTest: `HubKeyManager` caching, decrypt with valid/invalid key
- Android JUnit: `HubKeyManager` caching, decrypt with valid/invalid key

## Acceptance Criteria & Test Scenarios

- [ ] Rust FFI exports `decrypt_hub_event_hex()` and `unwrap_hub_key_from_state_hex()`
  -> `packages/crypto/tests/ffi_tests.rs: "decrypt_hub_event round-trips"`
- [ ] iOS decrypts relay events before emitting to subscribers
  -> `apps/ios/Tests/HubKeyManagerTests.swift: "decrypts event content with hub key"`
- [ ] Android decrypts relay events before calling `parseTypedEvent()`
  -> `apps/android/app/src/test/java/org/llamenos/hotline/crypto/HubKeyManagerTest.kt: "decrypts event content"`
- [ ] Hub key is cached after first fetch (no repeated API calls)
  -> `apps/ios/Tests/HubKeyManagerTests.swift: "caches hub key after first fetch"`
- [ ] Decryption failure does not crash — event is silently skipped
  -> `packages/test-specs/features/core/mobile-event-decryption.feature: "Event with wrong key fails to decrypt"`
- [ ] All platform BDD suites pass (`bun run test:all`)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/core/mobile-event-decryption.feature` | New | 3 scenarios for hub event decryption |
| `tests/steps/backend/mobile-event-decryption.steps.ts` | New | Backend step definitions |

## Risk Assessment

- **Low risk**: Rust FFI additions — existing crypto primitives, just new wrappers
- **Low risk**: Android/iOS HubKeyManager — straightforward fetch+cache pattern
- **Medium risk**: XCFramework rebuild — may require Xcode version alignment
- **Medium risk**: Integration with WebSocket pipeline — timing of hub key availability vs first event

## Execution

- **Phase 1** (Rust FFI): Sequential, must complete before Phase 2-3
- **Phase 2** (iOS) and **Phase 3** (Android): Parallel — non-overlapping directories
- **Phase 4** (BDD): After Phase 1
- **Phase 5**: `bun run test:all`
