//! # llamenos-core
//!
//! Shared cryptographic core for the Llamenos project.
//!
//! This crate provides all cryptographic operations used across all three clients:
//! - **Desktop (Tauri)**: native Rust dependency
//! - **Mobile (React Native)**: UniFFI-generated Swift/Kotlin bindings
//! - **Web browser**: compiled to WASM via wasm-bindgen
//!
//! ## Security Design
//!
//! - All key material uses `Zeroize` on drop — no GC unpredictability
//! - Domain separation constants prevent cross-context key reuse
//! - ECIES with per-operation ephemeral keys provides forward secrecy
//! - PBKDF2 with 600K iterations for PIN-based key derivation

#[cfg(feature = "mobile")]
uniffi::setup_scaffolding!();

pub mod auth;
pub mod blind_index;
pub mod ecies;
pub mod encryption;
pub mod errors;
pub mod keys;
pub mod labels;
pub mod nostr;

#[cfg(feature = "mobile")]
mod ffi;

#[cfg(feature = "wasm")]
mod wasm;

// Re-export core types
pub use auth::AuthToken;
pub use ecies::{KeyEnvelope, RecipientKeyEnvelope};
pub use encryption::{EncryptedKeyData, EncryptedMessage, EncryptedNote};
pub use errors::CryptoError;
pub use keys::KeyPair;
pub use labels::*;
pub use nostr::SignedNostrEvent;
