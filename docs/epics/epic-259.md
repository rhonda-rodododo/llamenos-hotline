# Epic 259: Rust Crypto & KDF Hardening

## Summary
Fix 8 crypto-layer vulnerabilities from Audit Round 8: BIP-340 sign_prehash verification (C8), secret key zeroization gaps (H1), auth token replay (H2), ECIES KDF upgrade to HKDF (H3), PBKDF2 salt increase (M22), plaintext zeroization (M23), verify_schnorr message length (M24), and HKDF deduplication (M25). Cross-platform wire-format change requiring coordinated TS updates.

## Context
- **Audit Round**: 8 (March 2026)
- **Severity**: 1 Critical, 3 High, 4 Medium
- ECIES KDF uses bare `SHA-256(label || sharedX)` — changing to HKDF is a breaking wire-format change
- Secret key bytes from `hex::decode` are never zeroized in ECIES functions
- `verify_auth_token` never checks timestamp — tokens are permanently replayable

## Implementation

### C8: Verify BIP-340 sign_prehash Compliance

Add an interop test with a fixed test vector from @noble/curves:

```rust
// tests/interop.rs
#[test]
fn test_bip340_interop_with_noble() {
    let sk_hex = "0000000000000000000000000000000000000000000000000000000000000003";
    let token = create_auth_token(sk_hex, 1234567890, "GET", "/api/test").unwrap();
    assert!(verify_auth_token(&token, "GET", "/api/test").unwrap());
    // Cross-verify signature bytes against @noble/curves schnorr.sign()
}
```

If interop passes, document the verification. If it fails, switch to canonical `Signer::sign()`.

### H1: Zeroize Secret Key Bytes in ECIES Functions

**`packages/crypto/src/ecies.rs`**:
```rust
use zeroize::Zeroize;

pub fn ecies_unwrap_key(...) -> Result<Vec<u8>, CryptoError> {
    let mut sk_bytes = hex::decode(secret_key_hex).map_err(CryptoError::HexError)?;
    if sk_bytes.len() != 32 {
        sk_bytes.zeroize();
        return Err(CryptoError::InvalidSecretKey);
    }
    let secret_key = SecretKey::from_slice(&sk_bytes)
        .map_err(|_| { sk_bytes.zeroize(); CryptoError::InvalidSecretKey })?;
    sk_bytes.zeroize();  // Zeroize immediately after constructing SecretKey
    // ... rest of function
}
```

Apply same pattern to `ecies_decrypt_content`.

### H2: Add Timestamp-Aware Auth Token Verification (Rust + FFI)

**Note:** Worker's `auth.ts` already has a 5-minute timestamp check at the TS layer. This fix adds the same check in Rust for mobile FFI consumers (iOS/Android) and provides a single canonical implementation.

**`packages/crypto/src/auth.rs`**:
```rust
pub fn verify_auth_token_with_expiry(
    token: &AuthToken, method: &str, path: &str,
    now_ms: u64, max_age_ms: u64,
) -> Result<bool, CryptoError> {
    let age = now_ms.saturating_sub(token.timestamp);
    if age > max_age_ms { return Ok(false) }
    if token.timestamp > now_ms + 30_000 { return Ok(false) }
    verify_auth_token(token, method, path)
}
```

Expose via UniFFI for iOS/Android. Worker `auth.ts` already enforces this — no Worker-side change needed.

### H3: Upgrade ECIES KDF from SHA-256 to HKDF

**Breaking wire-format change.** Decrypt with fallback for backward compatibility.

**`packages/crypto/src/ecies.rs`**:
```rust
use hkdf::Hkdf;

fn derive_ecies_key_v2(label: &str, shared_x: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, shared_x);
    let mut okm = [0u8; 32];
    hk.expand(label.as_bytes(), &mut okm).expect("HKDF expand 32 bytes");
    okm
}

fn derive_ecies_key_v1(label: &str, shared_x: &[u8]) -> [u8; 32] {
    let mut input = Vec::with_capacity(label.len() + shared_x.len());
    input.extend_from_slice(label.as_bytes());
    input.extend_from_slice(shared_x);
    let result: [u8; 32] = Sha256::digest(&input).into();
    input.zeroize();
    result
}
```

Encryption: prefix ciphertext with version byte `0x02`. Decryption: check version byte — `0x02` uses HKDF, `0x01` or no prefix uses legacy SHA-256. On successful v1 fallback, caller should re-encrypt with v2 (lazy migration).

**`packages/crypto/src/ecies.rs`** — version-tagged encryption:
```rust
const ECIES_VERSION_V2: u8 = 0x02;

pub fn ecies_encrypt_content(...) -> Result<String, CryptoError> {
    // ... existing ECDH + key derivation
    let key = derive_ecies_key_v2(label, &shared_x);
    let mut ciphertext = encrypt_xchacha20(key, plaintext)?;
    // Prepend version byte
    let mut versioned = Vec::with_capacity(1 + ciphertext.len());
    versioned.push(ECIES_VERSION_V2);
    versioned.append(&mut ciphertext);
    // ... encode and return
}

pub fn ecies_decrypt_content(...) -> Result<(Vec<u8>, bool), CryptoError> {
    // Returns (plaintext, needs_migration) — caller re-encrypts if true
    let raw = decode_ciphertext(...)?;
    let (version, payload) = if raw[0] == ECIES_VERSION_V2 {
        (2, &raw[1..])
    } else {
        (1, &raw[..])  // Legacy: no version prefix
    };
    let key = if version == 2 {
        derive_ecies_key_v2(label, &shared_x)
    } else {
        derive_ecies_key_v1(label, &shared_x)
    };
    let plaintext = decrypt_xchacha20(key, payload)?;
    Ok((plaintext, version == 1))  // needs_migration if v1
}
```

**`apps/worker/lib/crypto.ts`** — mirror the change:
```typescript
import { hkdf } from '@noble/hashes/hkdf.js'

function deriveEciesKeyV2(label: string, sharedX: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedX, new Uint8Array(0), utf8ToBytes(label), 32)
}

function deriveEciesKeyV1(label: string, sharedX: Uint8Array): Uint8Array {
  const input = new Uint8Array(label.length + sharedX.length)
  input.set(utf8ToBytes(label))
  input.set(sharedX, label.length)
  return sha256(input)
}
```

**`src/client/lib/crypto.ts`** — same mirror change for desktop frontend.

### M22: Increase PBKDF2 Salt to 32 Bytes

**`packages/crypto/src/encryption.rs`**:
```rust
let mut salt = [0u8; 32];  // was 16
```

Existing 16-byte salts continue to work for decryption (check length). New encryptions use 32 bytes.

### M23: Zeroize Decrypted Plaintext

For all decrypt functions, use `Zeroizing<Vec<u8>>` wrapper to ensure cleanup:
```rust
use zeroize::Zeroizing;

let plaintext = Zeroizing::new(
    cipher.decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed)?
);
let result = String::from_utf8(plaintext.to_vec())
    .map_err(|_| CryptoError::DecryptionFailed)?;
// plaintext Vec is zeroized on drop; returned String cannot be zeroized (Rust limitation)
// Acceptable: String lifetime is short (returned to caller, consumed, dropped)
Ok(result)
```

**Limitation:** The returned `String` cannot be zeroized in Rust since `String` doesn't implement `Zeroize`. The mitigation is that the `Vec<u8>` plaintext buffer (which is the larger attack surface for memory scanning) IS zeroized, and the String has a short lifetime in the caller.

Apply to: `decrypt_note`, `decrypt_message`, `decrypt_call_record`, `decrypt_legacy_note`, `decrypt_draft`, `decrypt_with_pin`, `ecies_decrypt_content`, `decrypt_with_shared_key_hex`.

### M24: Validate Message Length in verify_schnorr

**`packages/crypto/src/auth.rs`**:
```rust
pub fn verify_schnorr(...) -> Result<bool, CryptoError> {
    let message = hex::decode(message_hex).map_err(CryptoError::HexError)?;
    if message.len() != 32 {
        return Err(CryptoError::InvalidInput("Schnorr message must be exactly 32 bytes".into()));
    }
    // ... rest unchanged
}
```

### M25: Use hkdf Crate in compute_sas_code

**`packages/crypto/src/ffi.rs`**:
```rust
fn compute_sas_code(shared_x: &[u8]) -> Result<String, CryptoError> {
    let hk = Hkdf::<Sha256>::new(Some(SAS_SALT.as_bytes()), shared_x);
    let mut okm = [0u8; 4];
    hk.expand(SAS_INFO.as_bytes(), &mut okm).expect("HKDF 4-byte expand");
    let code = u32::from_be_bytes(okm) % 1_000_000;
    Ok(format!("{:06}", code))
}
```

## Tests

### Rust Unit Tests (`packages/crypto/`)
- `test_ecies_kdf_v2_produces_different_key_than_v1`
- `test_ecies_v1_ciphertext_decryptable_with_fallback`
- `test_ecies_v2_roundtrip`
- `test_verify_auth_token_with_expiry_rejects_old`
- `test_verify_auth_token_with_expiry_rejects_future`
- `test_verify_schnorr_rejects_non_32_byte_message`
- `test_sas_code_matches_manual_hkdf` (regression)
- `test_pbkdf2_32_byte_salt_roundtrip`
- `test_pbkdf2_16_byte_salt_backward_compat`

### Interop Tests
- BIP-340 cross-verification with @noble/curves
- ECIES KDF v2 cross-verification: encrypt in Rust, decrypt in TS and vice versa

### Worker Integration Tests
- Test auth middleware rejects tokens older than 5 minutes
- Test ECIES encrypt/decrypt roundtrip with new HKDF KDF

## Files to Modify
| File | Action |
|------|--------|
| `packages/crypto/src/ecies.rs` | HKDF KDF, sk_bytes zeroization |
| `packages/crypto/src/auth.rs` | Timestamp expiry, verify_schnorr length check |
| `packages/crypto/src/encryption.rs` | 32-byte salt, plaintext zeroization |
| `packages/crypto/src/ffi.rs` | Use hkdf crate for SAS |
| `packages/crypto/tests/interop.rs` | BIP-340 interop, KDF migration tests |
| `apps/worker/lib/crypto.ts` | Mirror HKDF KDF change |
| `apps/worker/lib/auth.ts` | Already has 5-min check — no change needed |

## Dependencies
- **Breaking wire format change**: ECIES KDF v1→v2 requires all platforms to deploy simultaneously
- Decryption fallback ensures backward compatibility with existing encrypted data
- Worker TS crypto must mirror exact HKDF parameters for interop
