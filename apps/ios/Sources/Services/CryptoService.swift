import Foundation

// MARK: - Stand-in types until LlamenosCore XCFramework is linked
// These mirror the UniFFI-generated types from packages/crypto/bindings/swift/LlamenosCore.swift.
// When the XCFramework is linked, remove this block and `import LlamenosCore` instead.

#if !canImport(LlamenosCore)

struct KeyPair {
    let secretKeyHex: String
    let publicKey: String
    let nsec: String
    let npub: String
}

struct EncryptedKeyData: Codable, Equatable, Hashable {
    let salt: String
    let iterations: UInt32
    let nonce: String
    let ciphertext: String
    let pubkey: String
}

struct AuthToken {
    let pubkey: String
    let timestamp: UInt64
    let token: String
}

struct KeyEnvelope: Codable, Equatable, Hashable {
    let wrappedKey: String
    let ephemeralPubkey: String
}

struct RecipientKeyEnvelope: Codable, Equatable, Hashable {
    let pubkey: String
    let wrappedKey: String
    let ephemeralPubkey: String
}

struct EncryptedNote: Equatable {
    let encryptedContent: String
    let authorEnvelope: KeyEnvelope
    let adminEnvelopes: [RecipientKeyEnvelope]
}

// Stand-in free functions matching UniFFI signatures.
// These provide compile-time type checking so the call sites are already correct
// when the real XCFramework is linked.

private func llamenosCoreGenerateKeypair() -> KeyPair {
    // Generates a random secp256k1 keypair. Real implementation in Rust via UniFFI.
    let secretKeyHex = (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    let publicKey = String(secretKeyHex.prefix(64))
    let nsec = "nsec1\(secretKeyHex.prefix(58))"
    let npub = "npub1\(publicKey.prefix(58))"
    return KeyPair(secretKeyHex: secretKeyHex, publicKey: publicKey, nsec: nsec, npub: npub)
}

private func llamenosCoreKeypairFromNsec(_ nsec: String) throws -> KeyPair {
    guard nsec.hasPrefix("nsec1"), nsec.count >= 60 else {
        throw CryptoServiceError.invalidNsec
    }
    let secretKeyHex = String(repeating: "a", count: 64)
    let publicKey = String(repeating: "b", count: 64)
    let npub = "npub1\(publicKey.prefix(58))"
    return KeyPair(secretKeyHex: secretKeyHex, publicKey: publicKey, nsec: nsec, npub: npub)
}

private func llamenosCoreEncryptWithPin(nsec: String, pin: String, pubkeyHex: String) throws -> EncryptedKeyData {
    let salt = (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    let nonce = (0..<24).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    let ciphertext = (0..<48).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    return EncryptedKeyData(salt: salt, iterations: 600_000, nonce: nonce, ciphertext: ciphertext, pubkey: pubkeyHex)
}

private func llamenosCoreDecryptWithPin(data: EncryptedKeyData, pin: String) throws -> String {
    return "nsec1\(data.pubkey.prefix(58))"
}

private func llamenosCoreCreateAuthToken(secretKeyHex: String, timestamp: UInt64, method: String, path: String) throws -> AuthToken {
    let token = (0..<64).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    let publicKey = String(repeating: "c", count: 64)
    return AuthToken(pubkey: publicKey, timestamp: timestamp, token: token)
}

private func llamenosCoreEncryptNoteForRecipients(payloadJson: String, authorPubkey: String, adminPubkeys: [String]) throws -> EncryptedNote {
    let content = (0..<64).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    let authorEnvelope = KeyEnvelope(
        wrappedKey: String(repeating: "d", count: 144),
        ephemeralPubkey: String(repeating: "e", count: 66)
    )
    let adminEnvelopes = adminPubkeys.map { pk in
        RecipientKeyEnvelope(
            pubkey: pk,
            wrappedKey: String(repeating: "f", count: 144),
            ephemeralPubkey: String(repeating: "0", count: 66)
        )
    }
    return EncryptedNote(encryptedContent: content, authorEnvelope: authorEnvelope, adminEnvelopes: adminEnvelopes)
}

private func llamenosCoreIsValidNsec(_ nsec: String) -> Bool {
    return nsec.hasPrefix("nsec1") && nsec.count >= 60
}

private func llamenosCoreIsValidPin(_ pin: String) -> Bool {
    return pin.count >= 4 && pin.count <= 6 && pin.allSatisfy(\.isNumber)
}

private func llamenosCoreDecryptNote(encryptedContentHex: String, wrappedKeyHex: String, ephemeralPubkeyHex: String, secretKeyHex: String) throws -> String {
    // Stand-in: simulate note decryption.
    // Real implementation uses ECIES to unwrap the note key, then XChaCha20-Poly1305
    // to decrypt the content. See protocol spec Section 2.3.
    let simulated = """
    {"text":"Decrypted note content (stand-in)","fields":null}
    """
    return simulated
}

#endif

// MARK: - CryptoService

enum CryptoServiceError: LocalizedError {
    case noKeyLoaded
    case invalidNsec
    case invalidPin
    case encryptionFailed(String)
    case decryptionFailed(String)

    var errorDescription: String? {
        switch self {
        case .noKeyLoaded:
            return NSLocalizedString("error_no_key_loaded", comment: "No cryptographic key is loaded")
        case .invalidNsec:
            return NSLocalizedString("error_invalid_nsec", comment: "The provided nsec key is invalid")
        case .invalidPin:
            return NSLocalizedString("error_invalid_pin", comment: "PIN must be 4-6 digits")
        case .encryptionFailed(let detail):
            return String(format: NSLocalizedString("error_encryption_failed", comment: "Encryption failed: %@"), detail)
        case .decryptionFailed(let detail):
            return String(format: NSLocalizedString("error_decryption_failed", comment: "Decryption failed: %@"), detail)
        }
    }
}

/// Central cryptographic service. The nsec (private key) is held privately and NEVER
/// exposed outside this class. Views and view models interact only with the pubkey/npub
/// and high-level encrypt/decrypt/sign methods.
///
/// All crypto operations delegate to LlamenosCore (UniFFI FFI). Stand-in implementations
/// are provided for compilation until the XCFramework is linked.
@Observable
final class CryptoService: @unchecked Sendable {
    private(set) var pubkey: String?
    private(set) var npub: String?

    /// The secret key in hex. NEVER exposed outside this class.
    private var nsecHex: String?

    /// Whether a key is loaded and available for signing/decryption.
    var isUnlocked: Bool { nsecHex != nil }

    /// Whether any identity has been loaded (even if locked).
    var hasIdentity: Bool { pubkey != nil }

    // MARK: - Key Generation

    /// Generate a new secp256k1 keypair. Returns the nsec (for one-time backup display)
    /// and npub. The nsec is stored internally; callers must NOT persist the returned nsec.
    @discardableResult
    func generateKeypair() -> (nsec: String, npub: String) {
        #if canImport(LlamenosCore)
        let kp = LlamenosCore.generateKeypair()
        #else
        let kp = llamenosCoreGenerateKeypair()
        #endif
        self.nsecHex = kp.secretKeyHex
        self.pubkey = kp.publicKey
        self.npub = kp.npub
        return (kp.nsec, kp.npub)
    }

    // MARK: - Key Import

    /// Import an existing nsec (bech32-encoded secret key).
    func importNsec(_ nsec: String) throws {
        #if canImport(LlamenosCore)
        let kp = try LlamenosCore.keypairFromNsec(nsec)
        #else
        let kp = try llamenosCoreKeypairFromNsec(nsec)
        #endif
        self.nsecHex = kp.secretKeyHex
        self.pubkey = kp.publicKey
        self.npub = kp.npub
    }

    // MARK: - PIN Encryption

    /// Encrypt the nsec for persistent storage, protected by the user's PIN.
    /// Returns opaque encrypted data suitable for Keychain storage.
    func encryptForStorage(pin: String) throws -> EncryptedKeyData {
        guard let nsecHex else { throw CryptoServiceError.noKeyLoaded }
        guard let pubkey else { throw CryptoServiceError.noKeyLoaded }

        #if canImport(LlamenosCore)
        guard LlamenosCore.isValidPin(pin) else { throw CryptoServiceError.invalidPin }
        // The UniFFI function expects the nsec in bech32, but we store hex internally.
        // Reconstruct nsec bech32 from the keypair.
        let kp = try LlamenosCore.keypairFromNsec(LlamenosCore.getPublicKey(secretKeyHex: nsecHex))
        return try LlamenosCore.encryptWithPin(nsec: kp.nsec, pin: pin, pubkeyHex: pubkey)
        #else
        guard llamenosCoreIsValidPin(pin) else { throw CryptoServiceError.invalidPin }
        return try llamenosCoreEncryptWithPin(nsec: nsecHex, pin: pin, pubkeyHex: pubkey)
        #endif
    }

    /// Decrypt nsec from storage using the user's PIN and load it into memory.
    func decryptFromStorage(_ data: EncryptedKeyData, pin: String) throws {
        #if canImport(LlamenosCore)
        let nsec = try LlamenosCore.decryptWithPin(data: data, pin: pin)
        try importNsec(nsec)
        #else
        let nsec = try llamenosCoreDecryptWithPin(data: data, pin: pin)
        try importNsec(nsec)
        #endif
    }

    // MARK: - Auth Token

    /// Create a Schnorr-signed auth token for API requests.
    /// The nsec is used for signing but never leaves this service.
    func createAuthToken(method: String, path: String) throws -> AuthToken {
        guard let nsecHex else { throw CryptoServiceError.noKeyLoaded }
        let timestamp = UInt64(Date().timeIntervalSince1970 * 1000)

        #if canImport(LlamenosCore)
        return try LlamenosCore.createAuthToken(
            secretKeyHex: nsecHex,
            timestamp: timestamp,
            method: method,
            path: path
        )
        #else
        return try llamenosCoreCreateAuthToken(
            secretKeyHex: nsecHex,
            timestamp: timestamp,
            method: method,
            path: path
        )
        #endif
    }

    // MARK: - Note Encryption

    /// Encrypt a note payload with per-note forward secrecy. The note key is ECIES-wrapped
    /// for the author and each admin pubkey.
    func encryptNote(payload: String, adminPubkeys: [String]) throws -> EncryptedNote {
        guard let pubkey else { throw CryptoServiceError.noKeyLoaded }

        #if canImport(LlamenosCore)
        return try LlamenosCore.encryptNoteForRecipients(
            payloadJson: payload,
            authorPubkey: pubkey,
            adminPubkeys: adminPubkeys
        )
        #else
        return try llamenosCoreEncryptNoteForRecipients(
            payloadJson: payload,
            authorPubkey: pubkey,
            adminPubkeys: adminPubkeys
        )
        #endif
    }

    // MARK: - Note Decryption

    /// Decrypt a note using the recipient envelope that matches our pubkey.
    /// Finds our envelope, unwraps the note key via ECIES, then decrypts the content
    /// with XChaCha20-Poly1305.
    ///
    /// - Parameters:
    ///   - encryptedContent: Hex-encoded encrypted note content.
    ///   - wrappedKey: Hex-encoded ECIES-wrapped note symmetric key.
    ///   - ephemeralPubkey: Hex-encoded ephemeral public key used in ECIES.
    /// - Returns: Decrypted JSON string containing the `NotePayload`.
    func decryptNoteContent(encryptedContent: String, wrappedKey: String, ephemeralPubkey: String) throws -> String {
        guard let nsecHex else { throw CryptoServiceError.noKeyLoaded }

        #if canImport(LlamenosCore)
        return try LlamenosCore.decryptNote(
            encryptedContentHex: encryptedContent,
            wrappedKeyHex: wrappedKey,
            ephemeralPubkeyHex: ephemeralPubkey,
            secretKeyHex: nsecHex
        )
        #else
        return try llamenosCoreDecryptNote(
            encryptedContentHex: encryptedContent,
            wrappedKeyHex: wrappedKey,
            ephemeralPubkeyHex: ephemeralPubkey,
            secretKeyHex: nsecHex
        )
        #endif
    }

    // MARK: - Lock

    /// Clear the nsec from memory. The pubkey and npub remain so the UI can show
    /// which identity is locked ("Locked as npub1...").
    func lock() {
        nsecHex = nil
    }
}
