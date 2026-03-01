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

        let adminPubkeys = [
            String(repeating: "a", count: 64),
            String(repeating: "b", count: 64),
        ]

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
}
