import XCTest
@testable import Llamenos

final class KeychainServiceTests: XCTestCase {

    private var keychainService: KeychainService!

    override func setUp() {
        super.setUp()
        keychainService = KeychainService()
        // Clean up any leftover test data from previous runs
        keychainService.delete(key: "test-key")
        keychainService.delete(key: "test-json")
        keychainService.delete(key: "test-string")
        keychainService.delete(key: "test-update")
        keychainService.delete(key: "test-delete")
        keychainService.clearLockoutState()
    }

    override func tearDown() {
        // Clean up test keys
        keychainService.delete(key: "test-key")
        keychainService.delete(key: "test-json")
        keychainService.delete(key: "test-string")
        keychainService.delete(key: "test-update")
        keychainService.delete(key: "test-delete")
        keychainService.clearLockoutState()
        keychainService = nil
        super.tearDown()
    }

    // MARK: - Store and Retrieve

    func testStoreAndRetrieveData() throws {
        let testData = "secret-data-12345".data(using: .utf8)!

        try keychainService.store(key: "test-key", data: testData)

        let retrieved = try keychainService.retrieve(key: "test-key")
        XCTAssertNotNil(retrieved, "Should retrieve stored data")
        XCTAssertEqual(retrieved, testData, "Retrieved data should match stored data")
    }

    func testRetrieveNonExistentKeyReturnsNil() throws {
        let result = try keychainService.retrieve(key: "nonexistent-key-\(UUID().uuidString)")
        XCTAssertNil(result, "Non-existent key should return nil")
    }

    func testStoreEmptyData() throws {
        let emptyData = Data()

        try keychainService.store(key: "test-key", data: emptyData)

        let retrieved = try keychainService.retrieve(key: "test-key")
        XCTAssertNotNil(retrieved)
        XCTAssertEqual(retrieved, emptyData)
    }

    // MARK: - Update Existing

    func testUpdateExistingKey() throws {
        let originalData = "original-value".data(using: .utf8)!
        let updatedData = "updated-value".data(using: .utf8)!

        try keychainService.store(key: "test-update", data: originalData)
        try keychainService.store(key: "test-update", data: updatedData)

        let retrieved = try keychainService.retrieve(key: "test-update")
        XCTAssertEqual(retrieved, updatedData, "Should return updated data, not original")
    }

    // MARK: - Delete

    func testDeleteExistingKey() throws {
        let testData = "to-be-deleted".data(using: .utf8)!

        try keychainService.store(key: "test-delete", data: testData)

        // Verify it exists
        let beforeDelete = try keychainService.retrieve(key: "test-delete")
        XCTAssertNotNil(beforeDelete)

        // Delete
        keychainService.delete(key: "test-delete")

        // Verify it's gone
        let afterDelete = try keychainService.retrieve(key: "test-delete")
        XCTAssertNil(afterDelete, "Deleted key should return nil")
    }

    func testDeleteNonExistentKeyDoesNotThrow() {
        // Should not throw or crash when deleting a non-existent key
        keychainService.delete(key: "nonexistent-key-\(UUID().uuidString)")
    }

    func testDeleteAll() throws {
        let data1 = "value-1".data(using: .utf8)!
        let data2 = "value-2".data(using: .utf8)!

        try keychainService.store(key: "test-key", data: data1)
        try keychainService.store(key: "test-string", data: data2)

        keychainService.deleteAll()

        XCTAssertNil(try keychainService.retrieve(key: "test-key"))
        XCTAssertNil(try keychainService.retrieve(key: "test-string"))
    }

    // MARK: - Typed Convenience: JSON

    func testStoreAndRetrieveJSON() throws {
        let testValue = EncryptedKeyData(
            salt: "abcdef1234567890",
            iterations: 600_000,
            nonce: "0123456789abcdef01234567",
            ciphertext: "encrypted-data-hex",
            pubkey: "pubkey-hex-64-chars-aaaa"
        )

        try keychainService.storeJSON(testValue, key: "test-json")

        let retrieved = try keychainService.retrieveJSON(EncryptedKeyData.self, key: "test-json")
        XCTAssertNotNil(retrieved)
        XCTAssertEqual(retrieved?.salt, testValue.salt)
        XCTAssertEqual(retrieved?.iterations, testValue.iterations)
        XCTAssertEqual(retrieved?.nonce, testValue.nonce)
        XCTAssertEqual(retrieved?.ciphertext, testValue.ciphertext)
        XCTAssertEqual(retrieved?.pubkey, testValue.pubkey)
    }

    func testRetrieveJSONNonExistentReturnsNil() throws {
        let result = try keychainService.retrieveJSON(
            EncryptedKeyData.self,
            key: "nonexistent-\(UUID().uuidString)"
        )
        XCTAssertNil(result)
    }

    // MARK: - Typed Convenience: String

    func testStoreAndRetrieveString() throws {
        let testURL = "https://hub.example.org"

        try keychainService.storeString(testURL, key: "test-string")

        let retrieved = try keychainService.retrieveString(key: "test-string")
        XCTAssertEqual(retrieved, testURL)
    }

    func testRetrieveStringNonExistentReturnsNil() throws {
        let result = try keychainService.retrieveString(key: "nonexistent-\(UUID().uuidString)")
        XCTAssertNil(result)
    }

    // MARK: - Large Data

    func testStoreLargeData() throws {
        // Simulate storing a large encrypted key payload
        let largeData = Data(repeating: 0xAA, count: 4096)

        try keychainService.store(key: "test-key", data: largeData)

        let retrieved = try keychainService.retrieve(key: "test-key")
        XCTAssertEqual(retrieved?.count, 4096)
        XCTAssertEqual(retrieved, largeData)
    }

    // MARK: - Keychain Key Constants

    func testKeychainKeyConstants() {
        // Verify key constants are defined and non-empty
        XCTAssertEqual(KeychainKey.encryptedKeys, "encrypted-keys")
        XCTAssertEqual(KeychainKey.hubURL, "hub-url")
        XCTAssertEqual(KeychainKey.deviceID, "device-id")
        XCTAssertEqual(KeychainKey.biometricEnabled, "biometric-enabled")
        XCTAssertEqual(KeychainKey.pinHash, "pin-verification")
        XCTAssertEqual(KeychainKey.biometricPIN, "biometric-pin")
        XCTAssertEqual(KeychainKey.pinLockoutAttempts, "pin-lockout-attempts")
        XCTAssertEqual(KeychainKey.pinLockoutUntil, "pin-lockout-until")
    }

    // MARK: - Multiple Keys

    func testMultipleKeysAreIndependent() throws {
        let data1 = "value-for-key-1".data(using: .utf8)!
        let data2 = "value-for-key-2".data(using: .utf8)!

        try keychainService.store(key: "test-key", data: data1)
        try keychainService.store(key: "test-string", data: data2)

        let retrieved1 = try keychainService.retrieve(key: "test-key")
        let retrieved2 = try keychainService.retrieve(key: "test-string")

        XCTAssertEqual(retrieved1, data1)
        XCTAssertEqual(retrieved2, data2)
        XCTAssertNotEqual(retrieved1, retrieved2, "Different keys should store different values")

        // Delete one, verify the other is unaffected
        keychainService.delete(key: "test-key")
        XCTAssertNil(try keychainService.retrieve(key: "test-key"))
        XCTAssertNotNil(try keychainService.retrieve(key: "test-string"))
    }

    // MARK: - PIN Lockout Persistence (H7)

    func testLockoutAttemptsDefaultsToZero() {
        let attempts = keychainService.getLockoutAttempts()
        XCTAssertEqual(attempts, 0, "Default lockout attempts should be 0")
    }

    func testSetAndGetLockoutAttempts() {
        keychainService.setLockoutAttempts(5)
        XCTAssertEqual(keychainService.getLockoutAttempts(), 5)

        keychainService.setLockoutAttempts(10)
        XCTAssertEqual(keychainService.getLockoutAttempts(), 10)
    }

    func testLockoutUntilDefaultsToDistantPast() {
        let until = keychainService.getLockoutUntil()
        XCTAssertEqual(until, .distantPast, "Default lockout until should be distant past")
    }

    func testSetAndGetLockoutUntil() {
        let future = Date().addingTimeInterval(300)
        keychainService.setLockoutUntil(future)

        let retrieved = keychainService.getLockoutUntil()
        // Compare with 1s tolerance for floating point
        XCTAssertEqual(retrieved.timeIntervalSince1970, future.timeIntervalSince1970, accuracy: 1.0)
    }

    func testClearLockoutState() {
        keychainService.setLockoutAttempts(7)
        keychainService.setLockoutUntil(Date().addingTimeInterval(120))

        keychainService.clearLockoutState()

        XCTAssertEqual(keychainService.getLockoutAttempts(), 0, "Attempts should be cleared")
        XCTAssertEqual(keychainService.getLockoutUntil(), .distantPast, "Lockout time should be cleared")
    }

    func testLockoutStateSurvivesServiceRecreation() {
        // Store lockout state
        keychainService.setLockoutAttempts(8)
        let lockoutTime = Date().addingTimeInterval(600)
        keychainService.setLockoutUntil(lockoutTime)

        // Create a new service instance (simulates app restart)
        let newService = KeychainService()

        // State should persist
        XCTAssertEqual(newService.getLockoutAttempts(), 8)
        XCTAssertEqual(
            newService.getLockoutUntil().timeIntervalSince1970,
            lockoutTime.timeIntervalSince1970,
            accuracy: 1.0
        )
    }
}
