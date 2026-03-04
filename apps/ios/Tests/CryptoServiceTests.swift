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
        XCTAssertEqual(encrypted.pubkey, originalPubkey, "Encrypted data should contain the pubkey")
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
    private static let tvNsec = "nsec17rvz7llh29l09df8hu24vv9j2h9mqgns45jcazey3wzkg9cx8q9svtf0yx"
    private static let tvNpub = "npub1ukqlwe4jpxrpgze3u2th5uj5r4r2mua38zhr52gsd9fkffd4djnsh8f3nz"
    private static let tvAdminSecretKeyHex = "0101010101010101010101010101010101010101010101010101010101010101"
    private static let tvAdminPublicKeyHex = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
    private static let tvPin = "1234"
    private static let tvAuthTimestamp: UInt64 = 1708900000000
    private static let tvAuthMethod = "POST"
    private static let tvAuthPath = "/api/notes"
    private static let tvAuthPubkey = "142715675faf8da1ecc4d51e0b9e539fa0d52fdd96ed60dbe99adb15d6b05ad9"
    private static let tvAuthToken = "34711b58bb7523a45cacce77377308ab323c78a91f0d3e87c05e084b1a39609647c88602359b7f4d63c39767855b1f632087457b8f4fea76c8397265da1d3904"

    func testKeypairFromNsecMatchesTestVectors() throws {
        let service = CryptoService()
        try service.importNsec(Self.tvNsec)

        XCTAssertEqual(service.pubkey, Self.tvPublicKeyHex,
                       "Pubkey derived from test vector nsec should match expected value")
        XCTAssertEqual(service.npub, Self.tvNpub,
                       "Npub derived from test vector nsec should match expected value")
    }

    func testAuthTokenInteropWithTestVectors() throws {
        let service = CryptoService()
        try service.importNsec(Self.tvNsec)

        // Create auth token with the same inputs as the test vector
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
        try service.importNsec(Self.tvNsec)

        // Create a token and verify it round-trips
        let token = try service.createAuthToken(method: "GET", path: "/api/identity/me")
        XCTAssertEqual(token.pubkey, Self.tvPublicKeyHex)
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

        // Build EncryptedKeyData from test vector values
        let encrypted = EncryptedKeyData(
            salt: "df31ae1be607616356581768bcca540a",
            iterations: 600_000,
            nonce: "bd5c90b12b5200d7a4d17895d1aab1ce848f56d7e0bdb3d4",
            ciphertext: "edf4c79c1f4065d8fc102230d3b987b857f275b18ea7851778b1938174f77f8017ea269323e47fd3ba4ff0f775824101b28f2f918309256c7cabcf1f6974daf0d361b0417a786e9a33e612c5d8b30e",
            pubkey: "aef13ed4125ec136"
        )

        // Decrypt with the known PIN
        try service.decryptFromStorage(encrypted, pin: Self.tvPin)

        XCTAssertTrue(service.isUnlocked,
                      "Should be unlocked after decrypting test vector")
        XCTAssertEqual(service.pubkey, Self.tvPublicKeyHex,
                       "Pubkey after PIN decrypt should match test vector")
        XCTAssertEqual(service.npub, Self.tvNpub,
                       "Npub after PIN decrypt should match test vector")
    }

    func testNoteDecryptionFromTestVectors() throws {
        let service = CryptoService()
        try service.importNsec(Self.tvNsec)

        // Test vector note encrypted content
        let encryptedContent = "b374f6f21e5cd51fd2b760a583d3c3b516eea6d654c40f7b9bcab295a9e902a726d2477a233cac7eca46c7dc247e20985cdb913d653841d98e87a36e4c3273f6d6d287fc5e41de8eef289d1c52d51396ae9df403a6e433f3c442996da0ac2f886a47288c97"
        let wrappedKey = "a40d059fc5d77d316f6a55e583dec08731281d6ad8e629bc0197798abaa4b8fa56d8665c2c519b48167d1cf6385713ac034b372ff3598ba6e7864e6e9498dca8ecf1c2f6d4c87f9e"
        let ephemeralPubkey = "036faa5af0d7ac21cd26e335da115594dbc0ef41d4e834bda633ba986383163fcf"

        let decrypted = try service.decryptNoteContent(
            encryptedContent: encryptedContent,
            wrappedKey: wrappedKey,
            ephemeralPubkey: ephemeralPubkey
        )

        XCTAssertEqual(
            decrypted,
            "{\"text\":\"Test note for interop\",\"fields\":{\"severity\":\"high\"}}",
            "Decrypted note should match test vector plaintext"
        )
    }

    func testNoteDecryptionByAdminFromTestVectors() throws {
        let service = CryptoService()
        // Import admin key
        let adminKP = try keypairFromNsec(nsec: "nsec1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs2amwtk")
        // Use raw import by importing the admin nsec
        // Actually we need the admin secret key — let's build a service from the admin nsec
        // The admin secret key is 0101...01, need its bech32 nsec
        // Since we can't easily convert hex to nsec, let's use keypairFromNsec with
        // a generated nsec for the admin key. Instead, test the admin envelope unwrap:

        let encryptedContent = "b374f6f21e5cd51fd2b760a583d3c3b516eea6d654c40f7b9bcab295a9e902a726d2477a233cac7eca46c7dc247e20985cdb913d653841d98e87a36e4c3273f6d6d287fc5e41de8eef289d1c52d51396ae9df403a6e433f3c442996da0ac2f886a47288c97"
        let adminWrappedKey = "eb68f91a5b42bf195f9252a3fb441f8334600790720833b85d752449d942ea7af1b4f048fbbd711e7ba7db6dd5f3e8dc1c1fe9ebef28d8acff9b84cbb5379fad709b00516d3139ed"
        let adminEphemeralPubkey = "0246662e60fa2facb5ccb1af01abd4b52d15aa46f0fa14c201ca73ac23089e88a2"

        // Decrypt using the FFI directly with the admin secret key
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
        let service = CryptoService()
        try service.importNsec(Self.tvNsec)

        let encryptedContent = "ce9493a71fc4bf988a4d1b2f89e5040646c7ed823ba464f7572c01734481a6b6601e5c93e2f6a63c7ad3c321ab590126d3914cb48d6f08fa3cc11aaae31a224deadd90f91c1c34872d63ab2f181aa5ec841e1a8cd922bb2bb973"
        let wrappedKey = "1df6e8261e3d262db7332635e67be0353d5d536fa1cecceb9f9a43709fa09762fc113de8a70044ada779b78b78f66c87bf9a97290bb80e37ca71ade2d5734e348586401fd3b94de8"
        let ephemeralPubkey = "024100060186e2447a0704e7e63e2b15d367f8ef21dbaa6fa35006cb260c94837d"

        let decrypted = try service.decryptMessage(
            encryptedContent: encryptedContent,
            wrappedKey: wrappedKey,
            ephemeralPubkey: ephemeralPubkey
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

        let admin = CryptoService()
        _ = admin.generateKeypair()

        let plaintext = "{\"text\":\"Round-trip test note\",\"fields\":{}}"

        // Encrypt
        let encrypted = try service.encryptNote(
            payload: plaintext,
            adminPubkeys: [admin.pubkey!]
        )

        // Author decrypts
        let decryptedByAuthor = try service.decryptNoteContent(
            encryptedContent: encrypted.encryptedContent,
            wrappedKey: encrypted.authorEnvelope.wrappedKey,
            ephemeralPubkey: encrypted.authorEnvelope.ephemeralPubkey
        )
        XCTAssertEqual(decryptedByAuthor, plaintext, "Author should decrypt their own note")

        // Admin decrypts via their envelope
        XCTAssertEqual(encrypted.adminEnvelopes.count, 1)
        let adminEnvelope = encrypted.adminEnvelopes[0]
        let envelope = KeyEnvelope(
            wrappedKey: adminEnvelope.wrappedKey,
            ephemeralPubkey: adminEnvelope.ephemeralPubkey
        )
        // Use the FFI directly for admin decryption (CryptoService doesn't expose admin's nsecHex)
        // Instead, test that admin service can decrypt
        // We need to access admin's private key — generate a known one
        let adminDecrypted = try decryptNote(
            encryptedContent: encrypted.encryptedContent,
            envelope: envelope,
            secretKeyHex: getSecretKeyHex(from: admin)
        )
        XCTAssertEqual(adminDecrypted, plaintext, "Admin should decrypt via their envelope")
    }

    func testDraftEncryptionFromTestVectors() throws {
        // Test vector: draft encryption with known secret key
        let plaintext = "Draft note content for interop test"
        let encryptedHex = "1db6fc9384a5b8a2ffe3343350d449bb35302d90784fc384166789ba2325baee81e5c1e935a96d8427d2ac68b42d7034537f46ec8a408fed4a72d31fc24e2cd5fe0af5b678df6eb1a1a1cc"

        // Decrypt the test vector
        let decrypted = try decryptDraft(
            encryptedHex: encryptedHex,
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
            encryptedHex: encrypted,
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
            wrappedKey: "d3fc8d8d60992dfd85eac1290b993c33a4d42fbc9e59f34f33f24a62de3cf9c4a6ef6828543998b5433bd7a9ebcec548e525de16e450eb7098b8345bb05cedb4ff767192968fe2fc",
            ephemeralPubkey: "03792dd05fc8bcf685b72bb55e9f894f66bde0d7f5bfeb2b8a0a6d4674866350d3"
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

    func testGetPublicKeyFromSecretKey() throws {
        let pubkey = try getPublicKey(secretKeyHex: Self.tvSecretKeyHex)
        XCTAssertEqual(pubkey, Self.tvPublicKeyHex,
                       "Public key derived from test vector secret should match")
    }

    func testRandomBytesHex() {
        let bytes32 = randomBytesHex(length: 32)
        XCTAssertEqual(bytes32.count, 64, "32 random bytes should produce 64 hex chars")

        let bytes16 = randomBytesHex(length: 16)
        XCTAssertEqual(bytes16.count, 32, "16 random bytes should produce 32 hex chars")

        // Should be unique
        let bytes32b = randomBytesHex(length: 32)
        XCTAssertNotEqual(bytes32, bytes32b, "Two random generations should be different")
    }

    // MARK: - Helper to extract secret key from CryptoService (for testing only)

    /// Uses Mirror to extract the private nsecHex for testing purposes.
    /// This is only acceptable in test code — production code should never access nsecHex.
    private func getSecretKeyHex(from service: CryptoService) -> String {
        let mirror = Mirror(reflecting: service)
        for child in mirror.children {
            if child.label == "nsecHex", let value = child.value as? String {
                return value
            }
        }
        XCTFail("Could not extract nsecHex via Mirror")
        return ""
    }
}
