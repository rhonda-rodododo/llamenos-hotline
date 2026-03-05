# Epic 260: iOS Security Hardening

## Summary
Fix 10 iOS vulnerabilities from Audit Round 8: non-functional biometric unlock (C5), SAS bypass in device linking (H4), QR relay URL SSRF (H5), HTTP scheme accepted (H6), in-memory PIN lockout (H7), wake key iCloud sync (H8), no certificate pinning (H14), hardcoded auto-lock timeout (M26), nsecInput not cleared (M27), and no screenshot protection (M28).

## Context
- **Audit Round**: 8 (March 2026)
- **Severity**: 1 Critical, 5 High, 3 Medium
- Biometric unlock shows Face ID prompt but never decrypts the nsec
- Device linking imports encrypted nsec without SAS confirmation, defeating MITM protection
- QR relay URLs are not validated — SSRF to internal networks

## Implementation

### C5: Fix Biometric Unlock

Store the user's PIN behind a biometric-protected Keychain item:

**`apps/ios/Sources/Services/KeychainService.swift`**:
```swift
func storePINForBiometric(_ pin: String) throws {
    let access = SecAccessControlCreateWithFlags(
        nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        .biometryCurrentSet, nil)!
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: serviceName,
        kSecAttrAccount as String: "biometric-pin",
        kSecAttrAccessControl as String: access,
        kSecValueData as String: pin.data(using: .utf8)!,
    ]
    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainError.unhandledError(status: status) }
}

func retrievePINWithBiometric() throws -> String? {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: serviceName,
        kSecAttrAccount as String: "biometric-pin",
        kSecReturnData as String: true,
        kSecUseOperationPrompt as String: NSLocalizedString("biometric_unlock_reason", comment: ""),
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
}
```

**`apps/ios/Sources/ViewModels/PINViewModel.swift`**:
```swift
func attemptBiometricUnlock() async {
    guard isBiometricEnabled else { return }
    do {
        if let pin = try keychainService.retrievePINWithBiometric() {
            await unlockWithPIN(pin)
        }
    } catch {
        errorMessage = nil // Fall back to PIN pad
    }
}
```

### H4: Gate nsec Import on SAS Confirmation

**`apps/ios/Sources/ViewModels/DeviceLinkViewModel.swift`**:
```swift
private var pendingEncryptedNsec: String?

// In processProvisioningMessage:
case "encrypted-nsec":
    guard let encryptedNsec = message["data"] as? String else { return }
    if sasConfirmed {
        Task { await importEncryptedNsec(encryptedNsec, sharedSecret: sharedSecret!) }
    } else {
        pendingEncryptedNsec = encryptedNsec
        status = .waitingForSASConfirmation
    }

func confirmSASCode() {
    sasConfirmed = true
    sendProvisioningMessage(["type": "sas-confirmed"])
    if let encrypted = pendingEncryptedNsec {
        pendingEncryptedNsec = nil
        Task { await importEncryptedNsec(encrypted, sharedSecret: sharedSecret!) }
    }
}
```

### H5: Validate QR Relay URL

```swift
private func isValidRelayHost(_ host: String) -> Bool {
    if host == "localhost" || host == "127.0.0.1" || host == "::1" { return false }
    let blocked = ["10.", "192.168.", "169.254.", "fe80:"]
        + (16...31).map { "172.\($0)." }
    return !blocked.contains(where: { host.hasPrefix($0) })
}
```

### H6: Reject HTTP Scheme

**`apps/ios/Sources/Services/APIService.swift`**:
```swift
static func configure(hubURLString: String) throws {
    var urlString = hubURLString.trimmingCharacters(in: .whitespacesAndNewlines)
    if urlString.hasPrefix("http://") {
        throw APIError.insecureConnection("HTTP not allowed. Use HTTPS.")
    }
    if !urlString.hasPrefix("https://") { urlString = "https://\(urlString)" }
}
```

### H7: Persist PIN Lockout (Keychain, Not UserDefaults)

Use Keychain instead of UserDefaults for lockout state — UserDefaults is readable by any process with the same app group and can be modified via backup restore.

```swift
// KeychainService extension for lockout storage
func setLockoutAttempts(_ count: Int) {
    let data = withUnsafeBytes(of: count) { Data($0) }
    setKeychainItem(account: "pin-lockout-attempts", data: data)
}
func getLockoutAttempts() -> Int {
    guard let data = getKeychainItem(account: "pin-lockout-attempts"),
          data.count == MemoryLayout<Int>.size else { return 0 }
    return data.withUnsafeBytes { $0.load(as: Int.self) }
}
func setLockoutUntil(_ date: Date) {
    let interval = date.timeIntervalSince1970
    let data = withUnsafeBytes(of: interval) { Data($0) }
    setKeychainItem(account: "pin-lockout-until", data: data)
}
func getLockoutUntil() -> Date {
    guard let data = getKeychainItem(account: "pin-lockout-until"),
          data.count == MemoryLayout<Double>.size else { return .distantPast }
    return Date(timeIntervalSince1970: data.withUnsafeBytes { $0.load(as: Double.self) })
}

func handleFailedAttempt() {
    failedAttempts += 1
    switch failedAttempts {
    case 1...4: break
    case 5...6: lockoutUntil = Date().addingTimeInterval(30)
    case 7...8: lockoutUntil = Date().addingTimeInterval(120)
    case 9: lockoutUntil = Date().addingTimeInterval(600)
    default: Task { await authService.wipeAllKeys() }
    }
}
```

### H8: Fix Wake Key Keychain Accessibility

```swift
kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
kSecAttrSynchronizable as String: kCFBooleanFalse!,
```

### H14: Certificate Pinning

Extract pins with: `openssl s_client -connect app.llamenos.org:443 -servername app.llamenos.org < /dev/null 2>/dev/null | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64`

Store pin hashes in a shared file `docs/security/CERTIFICATE_PINS.md` referenced by both iOS and Android.

Add `URLSessionDelegate` with certificate pinning against Cloudflare intermediate CA public key hashes:

### M26: Wire Auto-Lock Timeout

```swift
// LlamenosApp.swift
@AppStorage("autoLockTimeout") private var lockTimeout: TimeInterval = 300

// SettingsView.swift — persist on change
.onChange(of: selectedAutoLockTimeout) { _, newValue in
    UserDefaults.standard.set(newValue, forKey: "autoLockTimeout")
}
```

### M27: Clear nsecInput After Import

```swift
func submitImport() async {
    if success { nsecInput = "" }
}
```

### M28: Screenshot Protection

Apply `.privacySensitive()` to nsec display and note content. Show privacy overlay on `scenePhase == .inactive`.

## Tests

### XCUITest
- Biometric enable → biometric unlock succeeds
- SAS confirmation required before nsec import
- QR with localhost shows error
- http:// hub URL shows error
- PIN lockout persists after app restart
- Auto-lock timeout setting takes effect

### XCTest (Unit)
- `isValidRelayHost` rejects private IPs and accepts public hostnames
- PIN lockout timing (5→30s, 10→wipe)
- Wake key Keychain has `ThisDeviceOnly`

## Files to Modify
| File | Action |
|------|--------|
| `apps/ios/Sources/Services/KeychainService.swift` | Biometric PIN storage |
| `apps/ios/Sources/ViewModels/PINViewModel.swift` | Fix biometric, persist lockout |
| `apps/ios/Sources/Services/AuthService.swift` | Pass PIN to biometric enable |
| `apps/ios/Sources/ViewModels/DeviceLinkViewModel.swift` | SAS gate + URL validation |
| `apps/ios/Sources/Services/APIService.swift` | Reject http://, cert pinning |
| `apps/ios/Sources/Services/WakeKeyService.swift` | Fix Keychain accessibility |
| `apps/ios/Sources/App/LlamenosApp.swift` | Wire auto-lock, privacy overlay |
| `apps/ios/Sources/Views/Settings/SettingsView.swift` | Persist timeout |
| `apps/ios/Sources/ViewModels/AuthViewModel.swift` | Clear nsecInput |
| `apps/ios/Sources/Views/Auth/OnboardingView.swift` | .privacySensitive() |
| `apps/ios/Sources/Views/Notes/NoteDetailView.swift` | .privacySensitive() |

### Cross-Platform ECIES Migration E2E Test

After Epic 259 ECIES KDF v2 lands, add an E2E test:
```swift
func testECIES_v1_ciphertext_decrypts_with_migration_flag() {
    // Pre-generated v1 ciphertext from test vectors
    let result = try CryptoService.shared.eciesDecrypt(v1Ciphertext, secretKey: testKey)
    XCTAssertTrue(result.needsMigration)
    XCTAssertEqual(result.plaintext, expectedText)
}
```

## Dependencies
- Certificate pinning requires Cloudflare intermediate CA pins — extract and store in `docs/security/CERTIFICATE_PINS.md`
- Biometric PIN storage requires device with Face ID/Touch ID
- Epic 259 (crypto KDF) should land first since iOS uses FFI
