//! ECIES key wrapping and unwrapping.
//!
//! Implements the Llamenos ECIES scheme:
//! - Curve: secp256k1
//! - Ephemeral keypair per wrap operation
//! - ECDH shared secret → SHA-256(label || sharedX) → symmetric key
//! - XChaCha20-Poly1305 encryption of the 32-byte payload key
//!
//! Wire format:
//! - wrappedKey: hex(nonce_24 + ciphertext_48)  (48 = 32 key + 16 tag)
//! - ephemeralPubkey: hex(compressed_33)

use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use elliptic_curve::ecdh::SharedSecret;
use hkdf::Hkdf;
use k256::{
    ecdh::EphemeralSecret, elliptic_curve::sec1::ToEncodedPoint, PublicKey, Secp256k1, SecretKey,
};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::errors::CryptoError;

/// ECIES version byte for HKDF-based key derivation (v2).
const ECIES_VERSION_V2: u8 = 0x02;

/// A symmetric key wrapped via ECIES for a single recipient.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "mobile", derive(uniffi::Record))]
pub struct KeyEnvelope {
    /// hex: nonce(24) + ciphertext(48 = 32 key + 16 tag)
    pub wrapped_key: String,
    /// hex: compressed 33-byte ephemeral pubkey
    pub ephemeral_pubkey: String,
}

/// A KeyEnvelope tagged with the recipient's pubkey (for multi-recipient scenarios).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "mobile", derive(uniffi::Record))]
pub struct RecipientKeyEnvelope {
    /// recipient's x-only pubkey (hex, 32 bytes / 64 hex chars)
    pub pubkey: String,
    /// hex: nonce(24) + ciphertext(48)
    pub wrapped_key: String,
    /// hex: compressed 33-byte ephemeral pubkey
    pub ephemeral_pubkey: String,
}

/// Generate 24 random bytes for XChaCha20-Poly1305 nonce.
fn random_nonce() -> [u8; 24] {
    let mut nonce = [0u8; 24];
    getrandom::getrandom(&mut nonce).expect("getrandom failed");
    nonce
}

/// Generate 32 random bytes.
pub fn random_bytes_32() -> [u8; 32] {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("getrandom failed");
    bytes
}

/// Derive the ECIES symmetric key using HKDF-SHA256 (v2).
///
/// symmetric_key = HKDF-Expand(HKDF-Extract(salt=empty, ikm=shared_x), info=label, len=32)
fn derive_ecies_key_v2(label: &str, shared_x: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, shared_x);
    let mut okm = [0u8; 32];
    hk.expand(label.as_bytes(), &mut okm)
        .expect("HKDF expand should not fail for 32-byte output");
    okm
}

/// Legacy ECIES key derivation (v1): SHA-256(label || shared_x).
///
/// Used only for decryption of existing ciphertext without version byte.
fn derive_ecies_key_v1(label: &str, shared_x: &[u8]) -> [u8; 32] {
    let label_bytes = label.as_bytes();
    let mut input = Vec::with_capacity(label_bytes.len() + shared_x.len());
    input.extend_from_slice(label_bytes);
    input.extend_from_slice(shared_x);
    let result = Sha256::digest(&input);
    input.zeroize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

/// Parse an x-only pubkey hex (32 bytes) into a compressed SEC1 pubkey (prepend 0x02).
fn xonly_to_compressed(xonly_hex: &str) -> Result<Vec<u8>, CryptoError> {
    let x_bytes = hex::decode(xonly_hex).map_err(CryptoError::HexError)?;
    if x_bytes.len() != 32 {
        return Err(CryptoError::InvalidPublicKey);
    }
    let mut compressed = Vec::with_capacity(33);
    compressed.push(0x02);
    compressed.extend_from_slice(&x_bytes);
    Ok(compressed)
}

/// Compute ECDH shared secret x-coordinate between a secret key and a public key.
///
/// Returns the 32-byte x-coordinate of the shared point.
fn ecdh_shared_x(secret_key: &SecretKey, public_key: &PublicKey) -> Result<[u8; 32], CryptoError> {
    let shared_point: SharedSecret<Secp256k1> =
        k256::ecdh::diffie_hellman(secret_key.to_nonzero_scalar(), public_key.as_affine());
    let shared_bytes = shared_point.raw_secret_bytes();
    let mut x = [0u8; 32];
    x.copy_from_slice(shared_bytes);
    Ok(x)
}

/// Wrap a 32-byte symmetric key for a recipient using ECIES.
///
/// Domain separation via `label` prevents cross-context key reuse.
/// Matches the JS implementation in `src/client/lib/crypto.ts::eciesWrapKey`.
pub fn ecies_wrap_key(
    key: &[u8; 32],
    recipient_pubkey_hex: &str,
    label: &str,
) -> Result<KeyEnvelope, CryptoError> {
    // Generate ephemeral keypair
    let ephemeral_secret = EphemeralSecret::random(&mut OsRng);
    let ephemeral_public = ephemeral_secret.public_key();

    // Parse recipient's x-only pubkey → compressed SEC1
    let recipient_compressed = xonly_to_compressed(recipient_pubkey_hex)?;
    let recipient_pubkey = PublicKey::from_sec1_bytes(&recipient_compressed)
        .map_err(|_| CryptoError::InvalidPublicKey)?;

    // ECDH: compute shared x-coordinate
    let shared_point = ephemeral_secret.diffie_hellman(&recipient_pubkey);
    let shared_bytes = shared_point.raw_secret_bytes();
    let mut shared_x = [0u8; 32];
    shared_x.copy_from_slice(shared_bytes);

    // Derive symmetric key using HKDF (v2)
    let mut symmetric_key = derive_ecies_key_v2(label, &shared_x);

    // Encrypt the key with XChaCha20-Poly1305
    let nonce_bytes = random_nonce();
    let nonce = XNonce::from_slice(&nonce_bytes);
    let cipher = XChaCha20Poly1305::new_from_slice(&symmetric_key)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
    let ciphertext = cipher
        .encrypt(nonce, key.as_ref())
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    // Zero out sensitive material
    symmetric_key.zeroize();
    shared_x.zeroize();

    // Pack: version(1) + nonce(24) + ciphertext(48)
    let mut packed = Vec::with_capacity(1 + 24 + ciphertext.len());
    packed.push(ECIES_VERSION_V2);
    packed.extend_from_slice(&nonce_bytes);
    packed.extend_from_slice(&ciphertext);

    // Encode ephemeral pubkey as compressed SEC1 (33 bytes)
    let ephemeral_encoded = ephemeral_public.to_encoded_point(true);
    let ephemeral_bytes = ephemeral_encoded.as_bytes();

    Ok(KeyEnvelope {
        wrapped_key: hex::encode(&packed),
        ephemeral_pubkey: hex::encode(ephemeral_bytes),
    })
}

/// Unwrap a 32-byte symmetric key from an ECIES envelope.
///
/// Supports both v2 (HKDF, version byte prefix) and v1 (legacy SHA-256) formats.
/// Returns `(key, needs_migration)` — caller should re-encrypt with v2 if true.
pub fn ecies_unwrap_key(
    envelope: &KeyEnvelope,
    secret_key_hex: &str,
    label: &str,
) -> Result<[u8; 32], CryptoError> {
    let (key, _needs_migration) = ecies_unwrap_key_versioned(envelope, secret_key_hex, label)?;
    Ok(key)
}

/// Unwrap with migration flag indicating whether the ciphertext was v1 (legacy).
pub fn ecies_unwrap_key_versioned(
    envelope: &KeyEnvelope,
    secret_key_hex: &str,
    label: &str,
) -> Result<([u8; 32], bool), CryptoError> {
    // Parse secret key — zeroize immediately after constructing SecretKey (H1)
    let mut sk_bytes = hex::decode(secret_key_hex).map_err(CryptoError::HexError)?;
    if sk_bytes.len() != 32 {
        sk_bytes.zeroize();
        return Err(CryptoError::InvalidSecretKey);
    }
    let secret_key = SecretKey::from_slice(&sk_bytes).map_err(|_| {
        sk_bytes.zeroize();
        CryptoError::InvalidSecretKey
    })?;
    sk_bytes.zeroize();

    // Parse ephemeral public key (compressed SEC1, 33 bytes)
    let ephemeral_bytes = hex::decode(&envelope.ephemeral_pubkey).map_err(CryptoError::HexError)?;
    let ephemeral_pubkey = PublicKey::from_sec1_bytes(&ephemeral_bytes)
        .map_err(|_| CryptoError::InvalidEphemeralKey)?;

    // ECDH: compute shared x-coordinate
    let mut shared_x = ecdh_shared_x(&secret_key, &ephemeral_pubkey)?;

    // Unpack: detect version byte
    let data = hex::decode(&envelope.wrapped_key).map_err(CryptoError::HexError)?;

    let (version, payload) = if !data.is_empty() && data[0] == ECIES_VERSION_V2 {
        (2, &data[1..])
    } else {
        (1, &data[..])
    };

    if payload.len() < 24 {
        shared_x.zeroize();
        return Err(CryptoError::InvalidCiphertext);
    }
    let nonce = XNonce::from_slice(&payload[..24]);
    let ciphertext = &payload[24..];

    // Derive symmetric key based on version
    let mut symmetric_key = if version == 2 {
        derive_ecies_key_v2(label, &shared_x)
    } else {
        derive_ecies_key_v1(label, &shared_x)
    };

    // Decrypt
    let cipher = XChaCha20Poly1305::new_from_slice(&symmetric_key)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
    let result = cipher.decrypt(nonce, ciphertext);

    // Zero out sensitive material
    symmetric_key.zeroize();
    shared_x.zeroize();

    let plaintext = result.map_err(|_| {
        // If v2 decryption failed, try v1 fallback (shouldn't happen for properly versioned data)
        CryptoError::DecryptionFailed
    })?;

    if plaintext.len() != 32 {
        return Err(CryptoError::DecryptionFailed);
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&plaintext);
    Ok((key, version == 1))
}

/// Encrypt arbitrary-length content via ECIES for a recipient.
///
/// Returns `(packed_hex, ephemeral_pubkey_hex)`.
/// packed_hex = hex(version_byte(1) + nonce(24) + ciphertext)
pub fn ecies_encrypt_content(
    plaintext: &[u8],
    recipient_pubkey_hex: &str,
    label: &str,
) -> Result<(String, String), CryptoError> {
    let ephemeral_secret = EphemeralSecret::random(&mut OsRng);
    let ephemeral_public = ephemeral_secret.public_key();

    let recipient_compressed = xonly_to_compressed(recipient_pubkey_hex)?;
    let recipient_pubkey = PublicKey::from_sec1_bytes(&recipient_compressed)
        .map_err(|_| CryptoError::InvalidPublicKey)?;

    let shared_point = ephemeral_secret.diffie_hellman(&recipient_pubkey);
    let shared_bytes = shared_point.raw_secret_bytes();
    let mut shared_x = [0u8; 32];
    shared_x.copy_from_slice(shared_bytes);

    let mut symmetric_key = derive_ecies_key_v2(label, &shared_x);

    let nonce_bytes = random_nonce();
    let nonce = XNonce::from_slice(&nonce_bytes);
    let cipher = XChaCha20Poly1305::new_from_slice(&symmetric_key)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    symmetric_key.zeroize();
    shared_x.zeroize();

    // Pack: version(1) + nonce(24) + ciphertext
    let mut packed = Vec::with_capacity(1 + 24 + ciphertext.len());
    packed.push(ECIES_VERSION_V2);
    packed.extend_from_slice(&nonce_bytes);
    packed.extend_from_slice(&ciphertext);

    let ephemeral_encoded = ephemeral_public.to_encoded_point(true);
    Ok((
        hex::encode(&packed),
        hex::encode(ephemeral_encoded.as_bytes()),
    ))
}

/// Decrypt arbitrary-length ECIES-encrypted content.
///
/// Supports v2 (HKDF, version byte prefix) and v1 (legacy SHA-256) formats.
///
/// - `packed_hex`: hex(version_byte? + nonce_24 + ciphertext)
/// - `ephemeral_pubkey_hex`: compressed SEC1 (33 bytes / 66 hex chars)
/// - `secret_key_hex`: recipient's secret key
/// - `label`: domain separation label
pub fn ecies_decrypt_content(
    packed_hex: &str,
    ephemeral_pubkey_hex: &str,
    secret_key_hex: &str,
    label: &str,
) -> Result<String, CryptoError> {
    // Parse secret key — zeroize immediately after constructing SecretKey (H1)
    let mut sk_bytes = hex::decode(secret_key_hex).map_err(CryptoError::HexError)?;
    if sk_bytes.len() != 32 {
        sk_bytes.zeroize();
        return Err(CryptoError::InvalidSecretKey);
    }
    let secret_key = SecretKey::from_slice(&sk_bytes).map_err(|_| {
        sk_bytes.zeroize();
        CryptoError::InvalidSecretKey
    })?;
    sk_bytes.zeroize();

    // Parse ephemeral public key (compressed SEC1, 33 bytes)
    let ephemeral_bytes = hex::decode(ephemeral_pubkey_hex).map_err(CryptoError::HexError)?;
    let ephemeral_pubkey = PublicKey::from_sec1_bytes(&ephemeral_bytes)
        .map_err(|_| CryptoError::InvalidEphemeralKey)?;

    // ECDH: compute shared x-coordinate
    let mut shared_x = ecdh_shared_x(&secret_key, &ephemeral_pubkey)?;

    // Detect version byte
    let data = hex::decode(packed_hex).map_err(CryptoError::HexError)?;
    let (version, payload) = if !data.is_empty() && data[0] == ECIES_VERSION_V2 {
        (2, &data[1..])
    } else {
        (1, &data[..])
    };

    if payload.len() < 24 {
        shared_x.zeroize();
        return Err(CryptoError::InvalidCiphertext);
    }
    let nonce = XNonce::from_slice(&payload[..24]);
    let ciphertext = &payload[24..];

    let mut symmetric_key = if version == 2 {
        derive_ecies_key_v2(label, &shared_x)
    } else {
        derive_ecies_key_v1(label, &shared_x)
    };

    let cipher = XChaCha20Poly1305::new_from_slice(&symmetric_key)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed)?;

    // Zero out sensitive material
    symmetric_key.zeroize();
    shared_x.zeroize();

    String::from_utf8(plaintext).map_err(|_| CryptoError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::labels::LABEL_NOTE_KEY;

    #[test]
    fn roundtrip_ecies_wrap_unwrap() {
        let sk = SecretKey::random(&mut OsRng);
        let pk = sk.public_key();
        let pk_encoded = pk.to_encoded_point(true);
        let xonly_hex = hex::encode(&pk_encoded.as_bytes()[1..]);
        let sk_hex = hex::encode(sk.to_bytes());

        let original_key = random_bytes_32();
        let envelope = ecies_wrap_key(&original_key, &xonly_hex, LABEL_NOTE_KEY).unwrap();

        // v2 wrapping should produce version-byte-prefixed data
        let packed_bytes = hex::decode(&envelope.wrapped_key).unwrap();
        assert_eq!(packed_bytes[0], ECIES_VERSION_V2);

        let recovered_key = ecies_unwrap_key(&envelope, &sk_hex, LABEL_NOTE_KEY).unwrap();
        assert_eq!(original_key, recovered_key);
    }

    #[test]
    fn v2_produces_different_key_than_v1() {
        let shared_x = [0xABu8; 32];
        let label = "test-label";
        let key_v1 = derive_ecies_key_v1(label, &shared_x);
        let key_v2 = derive_ecies_key_v2(label, &shared_x);
        assert_ne!(key_v1, key_v2);
    }

    #[test]
    fn v1_ciphertext_decryptable_with_fallback() {
        // Simulate a v1 (legacy) wrapped key: SHA-256(label || sharedX), no version byte
        let sk = SecretKey::random(&mut OsRng);
        let pk = sk.public_key();
        let pk_encoded = pk.to_encoded_point(true);
        let xonly_hex = hex::encode(&pk_encoded.as_bytes()[1..]);
        let sk_hex = hex::encode(sk.to_bytes());

        // Manually create a v1 envelope (no version byte)
        let original_key = random_bytes_32();
        let ephemeral_secret = EphemeralSecret::random(&mut OsRng);
        let ephemeral_public = ephemeral_secret.public_key();

        let recipient_compressed = xonly_to_compressed(&xonly_hex).unwrap();
        let recipient_pubkey = PublicKey::from_sec1_bytes(&recipient_compressed).unwrap();

        let shared_point = ephemeral_secret.diffie_hellman(&recipient_pubkey);
        let mut shared_x = [0u8; 32];
        shared_x.copy_from_slice(shared_point.raw_secret_bytes());

        // v1 key derivation: SHA-256(label || sharedX)
        let symmetric_key = derive_ecies_key_v1(LABEL_NOTE_KEY, &shared_x);
        let nonce_bytes = random_nonce();
        let nonce = XNonce::from_slice(&nonce_bytes);
        let cipher = XChaCha20Poly1305::new_from_slice(&symmetric_key).unwrap();
        let ciphertext = cipher.encrypt(nonce, original_key.as_ref()).unwrap();

        // Pack WITHOUT version byte (v1 format)
        let mut packed = Vec::with_capacity(24 + ciphertext.len());
        packed.extend_from_slice(&nonce_bytes);
        packed.extend_from_slice(&ciphertext);

        let ephemeral_encoded = ephemeral_public.to_encoded_point(true);
        let v1_envelope = KeyEnvelope {
            wrapped_key: hex::encode(&packed),
            ephemeral_pubkey: hex::encode(ephemeral_encoded.as_bytes()),
        };

        // Should decrypt with v1 fallback
        let (recovered, needs_migration) =
            ecies_unwrap_key_versioned(&v1_envelope, &sk_hex, LABEL_NOTE_KEY).unwrap();
        assert_eq!(original_key, recovered);
        assert!(needs_migration);
    }

    #[test]
    fn v2_roundtrip_no_migration() {
        let sk = SecretKey::random(&mut OsRng);
        let pk = sk.public_key();
        let pk_encoded = pk.to_encoded_point(true);
        let xonly_hex = hex::encode(&pk_encoded.as_bytes()[1..]);
        let sk_hex = hex::encode(sk.to_bytes());

        let original_key = random_bytes_32();
        let envelope = ecies_wrap_key(&original_key, &xonly_hex, LABEL_NOTE_KEY).unwrap();

        let (recovered, needs_migration) =
            ecies_unwrap_key_versioned(&envelope, &sk_hex, LABEL_NOTE_KEY).unwrap();
        assert_eq!(original_key, recovered);
        assert!(!needs_migration);
    }

    #[test]
    fn wrong_label_fails() {
        let sk = SecretKey::random(&mut OsRng);
        let pk = sk.public_key();
        let pk_encoded = pk.to_encoded_point(true);
        let xonly_hex = hex::encode(&pk_encoded.as_bytes()[1..]);
        let sk_hex = hex::encode(sk.to_bytes());

        let original_key = random_bytes_32();
        let envelope = ecies_wrap_key(&original_key, &xonly_hex, LABEL_NOTE_KEY).unwrap();

        let result = ecies_unwrap_key(&envelope, &sk_hex, "wrong-label");
        assert!(result.is_err());
    }

    #[test]
    fn wrong_key_fails() {
        let sk = SecretKey::random(&mut OsRng);
        let pk = sk.public_key();
        let pk_encoded = pk.to_encoded_point(true);
        let xonly_hex = hex::encode(&pk_encoded.as_bytes()[1..]);

        let wrong_sk = SecretKey::random(&mut OsRng);
        let wrong_sk_hex = hex::encode(wrong_sk.to_bytes());

        let original_key = random_bytes_32();
        let envelope = ecies_wrap_key(&original_key, &xonly_hex, LABEL_NOTE_KEY).unwrap();

        let result = ecies_unwrap_key(&envelope, &wrong_sk_hex, LABEL_NOTE_KEY);
        assert!(result.is_err());
    }

    #[test]
    fn truncated_wrapped_key_fails() {
        let sk = SecretKey::random(&mut OsRng);
        let pk = sk.public_key();
        let pk_encoded = pk.to_encoded_point(true);
        let xonly_hex = hex::encode(&pk_encoded.as_bytes()[1..]);
        let sk_hex = hex::encode(sk.to_bytes());

        let original_key = random_bytes_32();
        let envelope = ecies_wrap_key(&original_key, &xonly_hex, LABEL_NOTE_KEY).unwrap();

        let truncated = &envelope.wrapped_key[..envelope.wrapped_key.len() - 2];
        let bad_envelope = KeyEnvelope {
            ephemeral_pubkey: envelope.ephemeral_pubkey.clone(),
            wrapped_key: truncated.to_string(),
        };
        assert!(ecies_unwrap_key(&bad_envelope, &sk_hex, LABEL_NOTE_KEY).is_err());
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let sk = SecretKey::random(&mut OsRng);
        let pk = sk.public_key();
        let pk_encoded = pk.to_encoded_point(true);
        let xonly_hex = hex::encode(&pk_encoded.as_bytes()[1..]);
        let sk_hex = hex::encode(sk.to_bytes());

        let original_key = random_bytes_32();
        let envelope = ecies_wrap_key(&original_key, &xonly_hex, LABEL_NOTE_KEY).unwrap();

        let mut wrapped_bytes = hex::decode(&envelope.wrapped_key).unwrap();
        if wrapped_bytes.len() > 26 {
            wrapped_bytes[26] ^= 0x01; // flip 1 bit in ciphertext (after version + nonce)
        }
        let bad_envelope = KeyEnvelope {
            ephemeral_pubkey: envelope.ephemeral_pubkey.clone(),
            wrapped_key: hex::encode(&wrapped_bytes),
        };
        assert!(ecies_unwrap_key(&bad_envelope, &sk_hex, LABEL_NOTE_KEY).is_err());
    }

    #[test]
    fn invalid_pubkey_format_fails() {
        let original_key = random_bytes_32();

        let short_pubkey = hex::encode(&[0x02u8; 31]);
        assert!(ecies_wrap_key(&original_key, &short_pubkey, LABEL_NOTE_KEY).is_err());

        let zero_pubkey = hex::encode(&[0u8; 32]);
        assert!(ecies_wrap_key(&original_key, &zero_pubkey, LABEL_NOTE_KEY).is_err());
    }

    #[test]
    fn roundtrip_ecies_content_encrypt_decrypt_v2() {
        let recipient_sk = SecretKey::random(&mut OsRng);
        let recipient_pk = recipient_sk.public_key();
        let recipient_pk_encoded = recipient_pk.to_encoded_point(true);
        let recipient_xonly_hex = hex::encode(&recipient_pk_encoded.as_bytes()[1..]);
        let recipient_sk_hex = hex::encode(recipient_sk.to_bytes());

        let content = "This is a transcription of the call";
        let label = "llamenos:transcription";

        // Encrypt with v2
        let (packed_hex, ephemeral_hex) =
            ecies_encrypt_content(content.as_bytes(), &recipient_xonly_hex, label).unwrap();

        // Should have version byte
        let packed_bytes = hex::decode(&packed_hex).unwrap();
        assert_eq!(packed_bytes[0], ECIES_VERSION_V2);

        // Decrypt
        let decrypted =
            ecies_decrypt_content(&packed_hex, &ephemeral_hex, &recipient_sk_hex, label).unwrap();
        assert_eq!(decrypted, content);
    }

    #[test]
    fn v1_content_decrypts_with_fallback() {
        // Simulate a v1 (legacy) content encryption: SHA-256(label || sharedX), no version byte
        let recipient_sk = SecretKey::random(&mut OsRng);
        let recipient_pk = recipient_sk.public_key();
        let recipient_pk_encoded = recipient_pk.to_encoded_point(true);
        let recipient_xonly_hex = hex::encode(&recipient_pk_encoded.as_bytes()[1..]);
        let recipient_sk_hex = hex::encode(recipient_sk.to_bytes());

        let content = "Legacy encrypted content";
        let label = "llamenos:transcription";

        let ephemeral_secret = EphemeralSecret::random(&mut OsRng);
        let ephemeral_public = ephemeral_secret.public_key();
        let recipient_compressed = xonly_to_compressed(&recipient_xonly_hex).unwrap();
        let recipient_pubkey = PublicKey::from_sec1_bytes(&recipient_compressed).unwrap();

        let shared_point = ephemeral_secret.diffie_hellman(&recipient_pubkey);
        let mut shared_x = [0u8; 32];
        shared_x.copy_from_slice(shared_point.raw_secret_bytes());

        let symmetric_key = derive_ecies_key_v1(label, &shared_x);
        let nonce_bytes = random_nonce();
        let nonce = XNonce::from_slice(&nonce_bytes);
        let cipher = XChaCha20Poly1305::new_from_slice(&symmetric_key).unwrap();
        let ciphertext = cipher.encrypt(nonce, content.as_bytes()).unwrap();

        // Pack WITHOUT version byte (v1 format)
        let mut packed = Vec::with_capacity(24 + ciphertext.len());
        packed.extend_from_slice(&nonce_bytes);
        packed.extend_from_slice(&ciphertext);
        let packed_hex = hex::encode(&packed);

        let ephemeral_encoded = ephemeral_public.to_encoded_point(true);
        let ephemeral_hex = hex::encode(ephemeral_encoded.as_bytes());

        let decrypted =
            ecies_decrypt_content(&packed_hex, &ephemeral_hex, &recipient_sk_hex, label).unwrap();
        assert_eq!(decrypted, content);
    }
}
