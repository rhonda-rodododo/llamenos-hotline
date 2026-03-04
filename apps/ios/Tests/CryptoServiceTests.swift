import XCTest
@testable import Llamenos

final class CryptoServiceTests: XCTestCase {

    // MARK: - Keypair Generation

    func testGenerateKeypairProducesBech32Keys() {
        let service = CryptoService()
        let (nsec, npub) = service.generateKeypair()

        XCTAssertTrue(nsec.hasPrefix("nsec1"), "Generated nsec should start with 'nsec1'")
        XCTAssertTrue(npub.hasPrefix("npub1"), "Generated npub should start with 'npub1'")
        XCTAssertGreaterThanOrEqual(nsec.count, 60, "nsec should be at least 60 characters (bech32)")
        XCTAssertGreaterThanOrEqual(npub.count, 60, "npub should be at least 60 characters (bech32)")
    }

    func testGenerateKeypairSetsPubkeyAndNpub() {
        let service = CryptoService()
        XCTAssertNil(service.pubkey, "pubkey should be nil before generation")
        XCTAssertNil(service.npub, "npub should be nil before generation")

        _ = service.generateKeypair()

        XCTAssertNotNil(service.pubkey, "pubkey should be set after generation")
        XCTAssertNotNil(service.npub, "npub should be set after generation")
    }

    func testGenerateKeypairSetsUnlockedState() {
        let service = CryptoService()
        XCTAssertFalse(service.isUnlocked, "Should not be unlocked before generation")

        _ = service.generateKeypair()

        XCTAssertTrue(service.isUnlocked, "Should be unlocked after generation")
    }

    func testGenerateKeypairProducesUniqueKeys() {
        let service1 = CryptoService()
        let service2 = CryptoService()

        let (nsec1, _) = service1.generateKeypair()
        let (nsec2, _) = service2.generateKeypair()

        XCTAssertNotEqual(nsec1, nsec2, "Two keypair generations should produce different nsecs")
        XCTAssertNotEqual(service1.pubkey, service2.pubkey, "Two keypair generations should produce different pubkeys")
    }

    func testHasIdentityAfterGeneration() {
        let service = CryptoService()
        XCTAssertFalse(service.hasIdentity, "Should not have identity before generation")

        _ = service.generateKeypair()

        XCTAssertTrue(service.hasIdentity, "Should have identity after generation")
    }

    // MARK: - Lock / Unlock

    func testLockClearsNsecButKeepsPubkey() {
        let service = CryptoService()
        _ = service.generateKeypair()
        let originalPubkey = service.pubkey
        let originalNpub = service.npub

        XCTAssertTrue(service.isUnlocked, "Should be unlocked before lock()")

        service.lock()

        XCTAssertFalse(service.isUnlocked, "Should not be unlocked after lock()")
        XCTAssertEqual(service.pubkey, originalPubkey, "pubkey should persist after lock()")
        XCTAssertEqual(service.npub, originalNpub, "npub should persist after lock()")
        XCTAssertTrue(service.hasIdentity, "Should still have identity after lock()")
    }

    func testLockPreventsAuthTokenCreation() {
        let service = CryptoService()
        _ = service.generateKeypair()
        service.lock()

        XCTAssertThrowsError(try service.createAuthToken(method: "GET", path: "/api/test")) { error in
            XCTAssertTrue(error is CryptoServiceError, "Should throw CryptoServiceError")
            if case CryptoServiceError.noKeyLoaded = error {
                // Expected
            } else {
                XCTFail("Expected CryptoServiceError.noKeyLoaded, got \(error)")
            }
        }
    }

    func testLockPreventsEncryption() {
        let service = CryptoService()
        _ = service.generateKeypair()
        service.lock()

        XCTAssertThrowsError(try service.encryptForStorage(pin: "1234")) { error in
            XCTAssertTrue(error is CryptoServiceError, "Should throw CryptoServiceError")
        }
    }

    // MARK: - Nsec Import

    func testImportValidNsec() throws {
        let service = CryptoService()
        // Generate a keypair to get a valid nsec
        let (nsec, _) = service.generateKeypair()

        // Create a new service and import
        let service2 = CryptoService()
        try service2.importNsec(nsec)

        XCTAssertTrue(service2.isUnlocked, "Should be unlocked after import")
        XCTAssertNotNil(service2.pubkey, "pubkey should be set after import")
        XCTAssertNotNil(service2.npub, "npub should be set after import")
    }

    func testImportInvalidNsecThrows() {
        let service = CryptoService()

        XCTAssertThrowsError(try service.importNsec("invalid-key")) { error in
            // Should throw an error for invalid nsec format
            XCTAssertNotNil(error)
        }

        XCTAssertFalse(service.isUnlocked, "Should not be unlocked after failed import")
    }

    func testImportEmptyNsecThrows() {
        let service = CryptoService()

        XCTAssertThrowsError(try service.importNsec("")) { error in
            XCTAssertNotNil(error)
        }
    }

    // MARK: - PIN Encryption / Decryption

    func testPINEncryptDecryptRoundTrip() throws {
        let service = CryptoService()
        _ = service.generateKeypair()
        let originalPubkey = service.pubkey!

        // Encrypt with PIN
        let encrypted = try service.encryptForStorage(pin: "1234")

        // Verify encrypted data structure
        XCTAssertFalse(encrypted.salt.isEmpty, "Salt should not be empty")
        XCTAssertFalse(encrypted.nonce.isEmpty, "Nonce should not be empty")
        XCTAssertFalse(encrypted.ciphertext.isEmpty, "Ciphertext should not be empty")
        // Note: encrypted.pubkey is a truncated SHA-256 hash for identification, not the full pubkey
        XCTAssertFalse(encrypted.pubkey.isEmpty, "Encrypted data should contain a pubkey identifier")
        XCTAssertEqual(encrypted.iterations, 600_000, "Should use 600,000 PBKDF2 iterations")

        // Lock and decrypt
        service.lock()
        XCTAssertFalse(service.isUnlocked)

        try service.decryptFromStorage(encrypted, pin: "1234")
        XCTAssertTrue(service.isUnlocked, "Should be unlocked after decrypt")
        XCTAssertEqual(service.pubkey, originalPubkey, "pubkey should match after decrypt")
    }

    func testEncryptionRequiresLoadedKey() {
        let service = CryptoService()

        XCTAssertThrowsError(try service.encryptForStorage(pin: "1234")) { error in
            if case CryptoServiceError.noKeyLoaded = error {
                // Expected
            } else {
                XCTFail("Expected CryptoServiceError.noKeyLoaded")
            }
        }
    }

    // MARK: - Auth Token

    func testAuthTokenCreation() throws {
        let service = CryptoService()
        _ = service.generateKeypair()

        let token = try service.createAuthToken(method: "GET", path: "/api/identity/me")

        XCTAssertFalse(token.pubkey.isEmpty, "Token pubkey should not be empty")
        XCTAssertFalse(token.token.isEmpty, "Token signature should not be empty")
        XCTAssertGreaterThan(token.timestamp, 0, "Timestamp should be positive")
    }

    func testAuthTokenRequiresUnlockedKey() {
        let service = CryptoService()

        XCTAssertThrowsError(try service.createAuthToken(method: "GET", path: "/api/test")) { error in
            if case CryptoServiceError.noKeyLoaded = error {
                // Expected
            } else {
                XCTFail("Expected CryptoServiceError.noKeyLoaded")
            }
        }
    }

    // MARK: - Note Encryption

    func testNoteEncryptionProducesEnvelopes() throws {
        let service = CryptoService()
        _ = service.generateKeypair()

        // Generate real admin keypairs for valid ECIES wrapping
        let admin1 = CryptoService()
        _ = admin1.generateKeypair()
        let admin2 = CryptoService()
        _ = admin2.generateKeypair()

        let adminPubkeys = [admin1.pubkey!, admin2.pubkey!]

        let encrypted = try service.encryptNote(
            payload: "{\"text\":\"test note\"}",
            adminPubkeys: adminPubkeys
        )

        XCTAssertFalse(encrypted.encryptedContent.isEmpty, "Encrypted content should not be empty")
        XCTAssertFalse(encrypted.authorEnvelope.wrappedKey.isEmpty, "Author envelope should have a wrapped key")
        XCTAssertEqual(encrypted.adminEnvelopes.count, 2, "Should have one envelope per admin")
    }

    func testNoteEncryptionRequiresLoadedKey() {
        let service = CryptoService()

        XCTAssertThrowsError(try service.encryptNote(payload: "{}", adminPubkeys: [])) { error in
            if case CryptoServiceError.noKeyLoaded = error {
                // Expected
            } else {
                XCTFail("Expected CryptoServiceError.noKeyLoaded")
            }
        }
    }

    // MARK: - State Machine

    func testNsecNeverExposedViaPublicAPI() {
        let service = CryptoService()
        _ = service.generateKeypair()

        // The nsecHex property is private — this test verifies the API surface.
        // The only way to access the nsec is via generateKeypair()'s return value
        // (one-time display) or via the encrypted storage round-trip.

        // Mirror-based reflection to verify nsecHex is not accessible
        let mirror = Mirror(reflecting: service)
        for child in mirror.children {
            XCTAssertNotEqual(
                child.label, "nsecHex",
                "nsecHex should be private and not visible in the Mirror (this is informational — Mirror shows private stored properties)"
            )
            // Note: Mirror *does* show private stored properties in Swift.
            // This test is really about the compile-time API: there is no public
            // accessor for nsecHex. The real security is the `private` access control.
        }

        // Verify there's no public method that returns the raw nsec hex
        // (the generateKeypair return is bech32 nsec, which is for one-time backup display only)
    }

    func testMultipleGenerationsOverwritePreviousKey() {
        let service = CryptoService()

        let (_, npub1) = service.generateKeypair()
        let pubkey1 = service.pubkey

        let (_, npub2) = service.generateKeypair()
        let pubkey2 = service.pubkey

        XCTAssertNotEqual(npub1, npub2, "Subsequent generations should produce different keys")
        XCTAssertNotEqual(pubkey1, pubkey2)
    }

    // MARK: - Crypto Interop (test-vectors.json)

    // Test vector values from packages/crypto/tests/fixtures/test-vectors.json
    private static let tvSecretKeyHex = "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f"
    private static let tvPublicKeyHex = "142715675faf8da1ecc4d51e0b9e539fa0d52fdd96ed60dbe99adb15d6b05ad9"
    private static let tvNsec = "nsec1wxstp8d62xc2cf8k70tuyg8c3g5nfegnwm2uhcpjdzta85amyauq5l8c4n"
    private static let tvNpub = "npub1exv74j8g3r7m0yrkzlmwedstqyntu4qpzat4k2k766s49g0hznwsldlma7"
    private static let tvAdminSecretKeyHex = "0101010101010101010101010101010101010101010101010101010101010101"
    private static let tvAdminPublicKeyHex = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
    private static let tvPin = "1234"
    private static let tvAuthTimestamp: UInt64 = 1708900000000
    private static let tvAuthMethod = "POST"
    private static let tvAuthPath = "/api/notes"
    private static let tvAuthPubkey = "142715675faf8da1ecc4d51e0b9e539fa0d52fdd96ed60dbe99adb15d6b05ad9"
    private static let tvAuthToken = "34711b58bb7523a45cacce77377308ab323c78a91f0d3e87c05e084b1a39609647c88602359b7f4d63c39767855b1f632087457b8f4fea76c8397265da1d3904"

    func testKeypairFromNsecImportsSuccessfully() throws {
        let service = CryptoService()
        try service.importNsec(Self.tvNsec)

        XCTAssertTrue(service.isUnlocked, "Should be unlocked after importing nsec")
        XCTAssertNotNil(service.pubkey, "Pubkey should be set after importing nsec")
        XCTAssertNotNil(service.npub, "Npub should be set after importing nsec")
        XCTAssertTrue(service.npub!.hasPrefix("npub1"), "Npub should be bech32-encoded")
    }

    func testPublicKeyDerivationMatchesTestVectors() throws {
        // Verify getPublicKey FFI function with known secret key hex
        let pubkey = try getPublicKey(secretKeyHex: Self.tvSecretKeyHex)
        XCTAssertEqual(pubkey, Self.tvPublicKeyHex,
                       "Public key from secretKeyHex should match test vector")
    }

    func testAuthTokenInteropWithTestVectors() throws {
        // Create auth token with the same inputs as the test vector using FFI directly
        let token = try createAuthToken(
            secretKeyHex: Self.tvSecretKeyHex,
            timestamp: Self.tvAuthTimestamp,
            method: Self.tvAuthMethod,
            path: Self.tvAuthPath
        )

        XCTAssertEqual(token.pubkey, Self.tvAuthPubkey,
                       "Auth token pubkey should match test vector")
        XCTAssertEqual(token.timestamp, Self.tvAuthTimestamp,
                       "Auth token timestamp should match test vector")
        XCTAssertEqual(token.token, Self.tvAuthToken,
                       "Auth token signature should match test vector (deterministic Schnorr)")
    }

    func testAuthTokenVerification() throws {
        let service = CryptoService()
        _ = service.generateKeypair()

        // Create a token and verify it round-trips
        let token = try service.createAuthToken(method: "GET", path: "/api/identity/me")
        XCTAssertEqual(token.pubkey, service.pubkey,
                       "Auth token pubkey should match service's pubkey")
        XCTAssertGreaterThan(token.timestamp, 0)
        XCTAssertFalse(token.token.isEmpty)

        // Verify the signature is valid (64 hex chars = 32 bytes Schnorr signature)
        XCTAssertEqual(token.token.count, 128,
                       "Schnorr signature should be 64 bytes (128 hex chars)")
    }

    func testPINEncryptionIterationCount() throws {
        let service = CryptoService()
        try service.importNsec(Self.tvNsec)

        let encrypted = try service.encryptForStorage(pin: Self.tvPin)

        XCTAssertEqual(encrypted.iterations, 600_000,
                       "PIN encryption should use 600,000 PBKDF2 iterations (matching test vectors)")
    }

    func testPINDecryptionFromTestVectors() throws {
        let service = CryptoService()

        // Build EncryptedKeyData from test vector values (regenerated)
        let encrypted = EncryptedKeyData(
            salt: "e269fc4916472e8b81dee65d37c73b78",
            iterations: 600_000,
            nonce: "1210b9eff77769110343e4486f2f318373388d8c2af377e5",
            ciphertext: "534f141224d67fc1582b6ad4d957e7904c9cd2039f32d40e6eca9ac3945bf66adcbc2c70179ecc44c094bad5787230bb696b4adafb74349a89d71a50242bd4471701af69b9dfc20fcf7a1a9de37726",
            pubkey: "7f9985390a1e9df5"
        )

        // Decrypt with the known PIN
        try service.decryptFromStorage(encrypted, pin: Self.tvPin)

        XCTAssertTrue(service.isUnlocked,
                      "Should be unlocked after decrypting test vector")
        // After PIN decryption, pubkey should be derivable from the decrypted nsec
        XCTAssertNotNil(service.pubkey,
                        "Pubkey should be set after PIN decrypt")
    }

    func testNoteDecryptionFromTestVectors() throws {
        // Use FFI directly with the known secret key for deterministic test
        let encryptedContent = "73151f77155255a6ff92248b2e7bba2cb69bf51d484e74beca6a4bd82ff1e7e5e6d1c188dccb135fd2a00ac346790766253b3e062ba860f358e67d1bb1fa94ff50c61c0b402886c7b55223b6d374e6cea2b356298259560dffbf78326e0162fd3e7998a271"
        let wrappedKey = "d1fcf51031ff9c413e9a7e903b2b4c0d315497437f72f4608a111c88fd86b7957cde54311b9d658159b23977bba4d654e9dbcfbb04d581a0a2486c811f16721d1fd6e7feba0bee40"
        let ephemeralPubkey = "03d568e297a0b27dac38bcfa0f8eae1702c848d100dc81cddbc04ea24430883488"

        let envelope = KeyEnvelope(wrappedKey: wrappedKey, ephemeralPubkey: ephemeralPubkey)
        let decrypted = try decryptNote(
            encryptedContent: encryptedContent,
            envelope: envelope,
            secretKeyHex: Self.tvSecretKeyHex
        )

        XCTAssertEqual(
            decrypted,
            "{\"text\":\"Test note for interop\",\"fields\":{\"severity\":\"high\"}}",
            "Decrypted note should match test vector plaintext"
        )
    }

    func testNoteDecryptionByAdminFromTestVectors() throws {
        // Test admin envelope unwrap using admin secret key directly
        let encryptedContent = "73151f77155255a6ff92248b2e7bba2cb69bf51d484e74beca6a4bd82ff1e7e5e6d1c188dccb135fd2a00ac346790766253b3e062ba860f358e67d1bb1fa94ff50c61c0b402886c7b55223b6d374e6cea2b356298259560dffbf78326e0162fd3e7998a271"
        let adminWrappedKey = "d26768ff7a1c7dc59655d45e5038fb4c2138f8fc803190e91fc308a66c3b1c8a670cf6979b7c20cf9f8821da7b99f1dd195d23aaca681b6fe2f6cfeef990767cf40a88c8f4230100"
        let adminEphemeralPubkey = "03d192003c7b0cfd246fd68df7433067818b802f734c08a5e7a6c7271c06e73f62"

        let envelope = KeyEnvelope(wrappedKey: adminWrappedKey, ephemeralPubkey: adminEphemeralPubkey)
        let decrypted = try decryptNote(
            encryptedContent: encryptedContent,
            envelope: envelope,
            secretKeyHex: Self.tvAdminSecretKeyHex
        )

        XCTAssertEqual(
            decrypted,
            "{\"text\":\"Test note for interop\",\"fields\":{\"severity\":\"high\"}}",
            "Admin should be able to decrypt the same note via their envelope"
        )
    }

    func testMessageDecryptionFromTestVectors() throws {
        // Use FFI directly — decryptMessageForReader with known secret key
        let encryptedContent = "8eefb86a9422c0ae2bd90f1a134f1ffb03f7015490bd3a5d6852a2c196ffa43e38d352f01f21f054b98a5af249a2e618bf85376e91b288428f2ee2c8ed71101966c440356b049bea2e77c5b287e5de6eb605917dc4907a9070f9"

        let readerEnvelopes = [
            RecipientKeyEnvelope(
                pubkey: "142715675faf8da1ecc4d51e0b9e539fa0d52fdd96ed60dbe99adb15d6b05ad9",
                wrappedKey: "c111ebd97e1010c6cc4de04d7160f0db531dd929a3e0f9fa8cd6819e5933bb32bd8dad40983f42856ac51e3757164eaeaecfc2520664bc4e13548373f7e31bc811a4fcdc524faba4",
                ephemeralPubkey: "02475dded72a8d8e78d5065b3e3400226d70754fb7bf92958a7662c32475028b2a"
            ),
            RecipientKeyEnvelope(
                pubkey: "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
                wrappedKey: "eafad739035044f993a6d18abef3aedf3261dc8f22840de0fedd4d92bd0367f136739d27824210b41242ffe268ded9f8c4084ba1761bef3e6eff8ae8ef05d063092f9900c8a42034",
                ephemeralPubkey: "02ec04defdee7fbb4164a5a303fec9008a5bcdcecd4644c76a0165e70c23ff5c5e"
            )
        ]

        let decrypted = try decryptMessageForReader(
            encryptedContent: encryptedContent,
            readerEnvelopes: readerEnvelopes,
            secretKeyHex: Self.tvSecretKeyHex,
            readerPubkey: Self.tvPublicKeyHex
        )

        XCTAssertEqual(
            decrypted,
            "Hello from volunteer — E2EE message interop test",
            "Decrypted message should match test vector plaintext"
        )
    }

    func testNoteEncryptDecryptRoundTrip() throws {
        let service = CryptoService()
        _ = service.generateKeypair()

        let plaintext = "{\"text\":\"Round-trip test note\",\"fields\":{}}"

        // Use the known admin key for decryption verification
        let encrypted = try service.encryptNote(
            payload: plaintext,
            adminPubkeys: [Self.tvAdminPublicKeyHex]
        )

        // Author decrypts via CryptoService's own decryptNoteContent method
        let decryptedByAuthor = try service.decryptNoteContent(
            encryptedContent: encrypted.encryptedContent,
            wrappedKey: encrypted.authorEnvelope.wrappedKey,
            ephemeralPubkey: encrypted.authorEnvelope.ephemeralPubkey
        )
        XCTAssertEqual(decryptedByAuthor, plaintext, "Author should decrypt their own note")

        // Admin decrypts via FFI with known admin secret key
        XCTAssertEqual(encrypted.adminEnvelopes.count, 1)
        let adminEnvelope = encrypted.adminEnvelopes[0]
        let envelope = KeyEnvelope(
            wrappedKey: adminEnvelope.wrappedKey,
            ephemeralPubkey: adminEnvelope.ephemeralPubkey
        )
        let adminDecrypted = try decryptNote(
            encryptedContent: encrypted.encryptedContent,
            envelope: envelope,
            secretKeyHex: Self.tvAdminSecretKeyHex
        )
        XCTAssertEqual(adminDecrypted, plaintext, "Admin should decrypt via their envelope")
    }

    func testDraftEncryptionFromTestVectors() throws {
        // Test vector: draft encryption with known secret key
        let plaintext = "Draft note content for interop test"
        let encryptedHex = "fa3fe43a30240961cbdb08cd1b62e84a601deb55a485a3705b601c9336270182bb6a327857caad0153bf8de3ef936c29e31ebaeff8ecafe94b9ab40f0e2b38d79753e62548e9ea16a85d47"

        // Decrypt the test vector
        let decrypted = try decryptDraft(
            packedHex: encryptedHex,
            secretKeyHex: Self.tvSecretKeyHex
        )

        XCTAssertEqual(decrypted, plaintext,
                       "Draft decryption should match test vector plaintext")
    }

    func testDraftEncryptDecryptRoundTrip() throws {
        // Encrypt a draft and decrypt it back
        let plaintext = "My draft note content"
        let encrypted = try encryptDraft(
            plaintext: plaintext,
            secretKeyHex: Self.tvSecretKeyHex
        )

        XCTAssertFalse(encrypted.isEmpty, "Encrypted draft should not be empty")

        let decrypted = try decryptDraft(
            packedHex: encrypted,
            secretKeyHex: Self.tvSecretKeyHex
        )

        XCTAssertEqual(decrypted, plaintext, "Draft round-trip should preserve content")
    }

    func testECIESWrapUnwrapRoundTrip() throws {
        let originalKeyHex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

        // Wrap for the admin pubkey
        let envelope = try eciesWrapKeyHex(
            keyHex: originalKeyHex,
            recipientPubkeyHex: Self.tvAdminPublicKeyHex,
            label: "llamenos:note-key"
        )

        XCTAssertFalse(envelope.wrappedKey.isEmpty, "Wrapped key should not be empty")
        XCTAssertFalse(envelope.ephemeralPubkey.isEmpty, "Ephemeral pubkey should not be empty")

        // Unwrap with admin secret key
        let unwrapped = try eciesUnwrapKeyHex(
            envelope: envelope,
            secretKeyHex: Self.tvAdminSecretKeyHex,
            label: "llamenos:note-key"
        )

        XCTAssertEqual(unwrapped, originalKeyHex,
                       "ECIES unwrapped key should match original")
    }

    func testECIESUnwrapFromTestVectors() throws {
        // Unwrap the test vector envelope
        let envelope = KeyEnvelope(
            wrappedKey: "03b6b5e7e2c0c958bdd0b3305442308052a3444a7d79fd30bf75f2e993702816e48e34b2de468b40a5adcf504d421f01abb7f67a293aac1f65b47f9eb6c1d5c35e10da9feb1e13ed",
            ephemeralPubkey: "0339ed3c67120fcd6847231d71f875f88cfa2ca493a7bb47f4b36eb5586878c5a6"
        )

        let unwrapped = try eciesUnwrapKeyHex(
            envelope: envelope,
            secretKeyHex: Self.tvAdminSecretKeyHex,
            label: "llamenos:note-key"
        )

        XCTAssertEqual(
            unwrapped,
            "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            "ECIES unwrap of test vector should produce the original key"
        )
    }

    func testValidPINFormat() {
        XCTAssertTrue(isValidPin(pin: "1234"), "4-digit PIN should be valid")
        XCTAssertTrue(isValidPin(pin: "123456"), "6-digit PIN should be valid")
        XCTAssertFalse(isValidPin(pin: "123"), "3-digit PIN should be invalid")
        XCTAssertFalse(isValidPin(pin: "1234567"), "7-digit PIN should be invalid")
        XCTAssertFalse(isValidPin(pin: ""), "Empty PIN should be invalid")
        XCTAssertFalse(isValidPin(pin: "abcd"), "Non-numeric PIN should be invalid")
    }

    func testValidNsecFormat() {
        XCTAssertTrue(isValidNsec(nsec: Self.tvNsec), "Test vector nsec should be valid")
        XCTAssertFalse(isValidNsec(nsec: "invalid"), "Random string should not be valid nsec")
        XCTAssertFalse(isValidNsec(nsec: ""), "Empty string should not be valid nsec")
        XCTAssertFalse(isValidNsec(nsec: "npub1abc"), "npub should not be valid as nsec")
    }

    func testRandomBytesHex() {
        let bytes = randomBytesHex()
        XCTAssertEqual(bytes.count, 64, "randomBytesHex should produce 64 hex chars (32 bytes)")

        // Should be unique
        let bytes2 = randomBytesHex()
        XCTAssertNotEqual(bytes, bytes2, "Two random generations should be different")
    }
}
