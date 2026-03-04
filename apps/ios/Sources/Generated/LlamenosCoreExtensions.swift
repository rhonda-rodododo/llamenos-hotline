import Foundation

// MARK: - Codable Conformance for UniFFI-Generated Types
// UniFFI generates Equatable + Hashable but not Codable.
// These extensions are needed for JSON serialization (Keychain storage, API payloads).

extension EncryptedKeyData: Codable {
    enum CodingKeys: String, CodingKey {
        case salt, iterations, nonce, ciphertext, pubkey
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            salt: try container.decode(String.self, forKey: .salt),
            iterations: try container.decode(UInt32.self, forKey: .iterations),
            nonce: try container.decode(String.self, forKey: .nonce),
            ciphertext: try container.decode(String.self, forKey: .ciphertext),
            pubkey: try container.decode(String.self, forKey: .pubkey)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(salt, forKey: .salt)
        try container.encode(iterations, forKey: .iterations)
        try container.encode(nonce, forKey: .nonce)
        try container.encode(ciphertext, forKey: .ciphertext)
        try container.encode(pubkey, forKey: .pubkey)
    }
}

extension KeyEnvelope: Codable {
    enum CodingKeys: String, CodingKey {
        case wrappedKey, ephemeralPubkey
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            wrappedKey: try container.decode(String.self, forKey: .wrappedKey),
            ephemeralPubkey: try container.decode(String.self, forKey: .ephemeralPubkey)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(wrappedKey, forKey: .wrappedKey)
        try container.encode(ephemeralPubkey, forKey: .ephemeralPubkey)
    }
}

extension RecipientKeyEnvelope: Codable {
    enum CodingKeys: String, CodingKey {
        case pubkey, wrappedKey, ephemeralPubkey
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            pubkey: try container.decode(String.self, forKey: .pubkey),
            wrappedKey: try container.decode(String.self, forKey: .wrappedKey),
            ephemeralPubkey: try container.decode(String.self, forKey: .ephemeralPubkey)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pubkey, forKey: .pubkey)
        try container.encode(wrappedKey, forKey: .wrappedKey)
        try container.encode(ephemeralPubkey, forKey: .ephemeralPubkey)
    }
}
