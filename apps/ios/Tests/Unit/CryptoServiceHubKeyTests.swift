import Foundation
import Testing
@testable import Llamenos

struct CryptoServiceHubKeyTests {

    @Test func loadHubKeyStoresKeyInCache() throws {
        let crypto = CryptoService()
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "deadbeef00112233")
        #expect(crypto.hasHubKey(hubId: "hub-001") == true)
        #expect(crypto.allHubKeys()["hub-001"] == "deadbeef00112233")
    }

    @Test func clearHubKeysEvictsAllKeys() throws {
        let crypto = CryptoService()
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "aabbcc")
        crypto.storeHubKeyForTesting(hubId: "hub-002", keyHex: "ddeeff")
        crypto.clearHubKeys()
        #expect(crypto.hubKeyCount == 0)
        #expect(crypto.allHubKeys().isEmpty == true)
    }

    @Test func hubKeyCountReflectsCurrentCacheSize() {
        let crypto = CryptoService()
        #expect(crypto.hubKeyCount == 0)
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "aabbcc")
        #expect(crypto.hubKeyCount == 1)
        crypto.storeHubKeyForTesting(hubId: "hub-002", keyHex: "ddeeff")
        #expect(crypto.hubKeyCount == 2)
    }

    @Test func lockClearsHubKeyCache() {
        let crypto = CryptoService()
        crypto.storeHubKeyForTesting(hubId: "hub-001", keyHex: "aabbcc")
        crypto.lock()
        #expect(crypto.hubKeyCount == 0)
    }
}
