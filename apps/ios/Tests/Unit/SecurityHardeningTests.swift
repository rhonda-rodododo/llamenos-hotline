import XCTest
@testable import Llamenos

/// Unit tests for Epic 260 security hardening fixes.
/// Tests relay URL validation (H5), PIN lockout timing (H7), and API URL validation (H6).
final class SecurityHardeningTests: XCTestCase {

    // MARK: - H5: Relay URL Validation (isValidRelayHost)

    func testRejectsLocalhost() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("localhost"))
    }

    func testRejectsLocalhostCaseInsensitive() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("LOCALHOST"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("Localhost"))
    }

    func testRejectsLoopbackIPv4() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("127.0.0.1"))
    }

    func testRejectsLoopbackIPv4Range() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("127.0.0.2"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("127.255.255.255"))
    }

    func testRejectsLoopbackIPv6() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("::1"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("[::1]"))
    }

    func testRejectsPrivate10Range() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("10.0.0.1"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("10.255.255.255"))
    }

    func testRejectsPrivate172Range() {
        // 172.16.0.0 - 172.31.255.255 is private
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("172.16.0.1"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("172.31.255.255"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("172.20.0.1"))
    }

    func testRejectsPrivate192168Range() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("192.168.0.1"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("192.168.1.1"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("192.168.255.255"))
    }

    func testRejectsLinkLocalIPv4() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("169.254.0.1"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("169.254.255.255"))
    }

    func testRejectsLinkLocalIPv6() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("fe80:0:0:0:0:0:0:1"))
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost("fe80::1"))
    }

    func testRejectsEmptyHost() {
        XCTAssertFalse(DeviceLinkViewModel.isValidRelayHost(""))
    }

    func testAcceptsPublicHostname() {
        XCTAssertTrue(DeviceLinkViewModel.isValidRelayHost("relay.llamenos.org"))
    }

    func testAcceptsPublicIPv4() {
        XCTAssertTrue(DeviceLinkViewModel.isValidRelayHost("8.8.8.8"))
        XCTAssertTrue(DeviceLinkViewModel.isValidRelayHost("1.1.1.1"))
    }

    func testAcceptsPublic172OutsidePrivateRange() {
        // 172.15.x.x and 172.32.x.x are NOT private
        XCTAssertTrue(DeviceLinkViewModel.isValidRelayHost("172.15.0.1"))
        XCTAssertTrue(DeviceLinkViewModel.isValidRelayHost("172.32.0.1"))
    }

    func testAcceptsCloudflareSubdomain() {
        XCTAssertTrue(DeviceLinkViewModel.isValidRelayHost("app.llamenos.org"))
        XCTAssertTrue(DeviceLinkViewModel.isValidRelayHost("relay.example.com"))
    }

    // MARK: - H7: PIN Lockout Timing

    func testNoLockoutForFirstFourAttempts() {
        for attempts in 0...4 {
            XCTAssertNil(
                PINLockout.lockoutDuration(forAttempts: attempts),
                "No lockout expected for \(attempts) attempts"
            )
        }
    }

    func testThirtySecondLockoutForAttemptsFiveAndSix() {
        XCTAssertEqual(PINLockout.lockoutDuration(forAttempts: 5), 30)
        XCTAssertEqual(PINLockout.lockoutDuration(forAttempts: 6), 30)
    }

    func testTwoMinuteLockoutForAttemptsSevenAndEight() {
        XCTAssertEqual(PINLockout.lockoutDuration(forAttempts: 7), 120)
        XCTAssertEqual(PINLockout.lockoutDuration(forAttempts: 8), 120)
    }

    func testTenMinuteLockoutForAttemptNine() {
        XCTAssertEqual(PINLockout.lockoutDuration(forAttempts: 9), 600)
    }

    func testWipeOnTenthAttempt() {
        XCTAssertTrue(PINLockout.shouldWipeKeys(forAttempts: 10))
        XCTAssertEqual(PINLockout.lockoutDuration(forAttempts: 10), 0)
    }

    func testWipeOnMoreThanTenAttempts() {
        XCTAssertTrue(PINLockout.shouldWipeKeys(forAttempts: 11))
        XCTAssertTrue(PINLockout.shouldWipeKeys(forAttempts: 100))
    }

    func testNoWipeBelowTenAttempts() {
        for attempts in 0...9 {
            XCTAssertFalse(
                PINLockout.shouldWipeKeys(forAttempts: attempts),
                "Should not wipe at \(attempts) attempts"
            )
        }
    }

    // MARK: - H6: HTTP Rejection

    func testAPIServiceRejectsHTTP() {
        let crypto = CryptoService()
        let api = APIService(cryptoService: crypto)

        XCTAssertThrowsError(try api.configure(hubURLString: "http://evil.example.com")) { error in
            guard let apiError = error as? APIError else {
                XCTFail("Expected APIError, got \(type(of: error))")
                return
            }
            if case .insecureConnection = apiError {
                // Expected
            } else {
                XCTFail("Expected insecureConnection error, got \(apiError)")
            }
        }
    }

    func testAPIServiceRejectsHTTPCaseInsensitive() {
        let crypto = CryptoService()
        let api = APIService(cryptoService: crypto)

        XCTAssertThrowsError(try api.configure(hubURLString: "HTTP://evil.example.com"))
        XCTAssertThrowsError(try api.configure(hubURLString: "Http://evil.example.com"))
    }

    func testAPIServiceAcceptsHTTPS() throws {
        let crypto = CryptoService()
        let api = APIService(cryptoService: crypto)

        // Should not throw
        try api.configure(hubURLString: "https://app.llamenos.org")
    }

    func testAPIServiceAutoPrependsHTTPS() throws {
        let crypto = CryptoService()
        let api = APIService(cryptoService: crypto)

        // Should not throw — auto-prepends https://
        try api.configure(hubURLString: "app.llamenos.org")
    }

    // MARK: - Certificate Pinning Constants (H14)

    func testCertificatePinsDisabledByDefault() {
        // Pins are placeholders — should be disabled until populated
        // This test documents the expected state and will fail-fast when
        // real pins are added, reminding us to update the test.
        XCTAssertFalse(
            CertificatePins.isEnabled,
            "Certificate pinning should be disabled until real pin hashes are configured"
        )
    }
}
