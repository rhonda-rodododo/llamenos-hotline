# Epic 261: Android Security Hardening

## Summary
Fix 12 Android vulnerabilities from Audit Round 8: plaintext crypto fallback (C6), nsec in Compose state (H-2a/M29), PIN brute-force (H9), deep link relay URL injection (H10), alpha crypto library (H11), MasterKey not StrongBox-backed (H12), dev IP in release network config (H13), no certificate pinning (H14), AuthInterceptor race (M30), and ProGuard rules (M31).

## Context
- **Audit Round**: 8 (March 2026)
- **Severity**: 1 Critical, 7 High, 3 Medium
- Placeholder crypto stores nsec as raw Base64 with `String.hashCode()` — no encryption
- PIN unlock has zero brute-force rate limiting
- Release build permits cleartext to developer's home LAN IP

## Implementation

### C6: Hard-Fail Crypto Without Native Library

**`apps/android/.../crypto/CryptoService.kt`**:
```kotlin
suspend fun encryptForStorage(secret: String, pin: String): EncryptedKeyData {
    check(nativeLibLoaded) {
        "Cannot store keys: native crypto library not loaded."
    }
    return encryptForStorageNative(secret, pin)
}

suspend fun decryptFromStorage(encrypted: EncryptedKeyData, pin: String): String {
    check(nativeLibLoaded) {
        "Cannot decrypt keys: native crypto library not loaded."
    }
    return decryptFromStorageNative(encrypted, pin)
}
```

Remove the entire Base64 + `String.hashCode()` fallback branch.

### H-2a + M29: Clear nsec and PIN from Compose State

```kotlin
fun confirmBackup() {
    _uiState.update { it.copy(backupConfirmed = true, generatedNsec = null) }
}

private suspend fun importKey(nsec: String) {
    if (success) {
        _uiState.update { it.copy(isLoading = false, nsecInput = "", importError = null) }
    }
}
```

### H9: Add PIN Brute-Force Protection

**`apps/android/.../crypto/KeystoreService.kt`**:
```kotlin
sealed class PinLockoutState {
    data class Unlocked(val attemptsRemaining: Int) : PinLockoutState()
    data class LockedOut(val until: Long) : PinLockoutState()
    data object Wiped : PinLockoutState()
}

fun recordFailedAttempt(): PinLockoutState {
    val attempts = prefs.getInt("failed_attempts", 0) + 1
    prefs.edit().putInt("failed_attempts", attempts).apply()
    val lockoutMs = when (attempts) {
        in 1..4 -> 0L
        in 5..6 -> 30_000L
        in 7..8 -> 120_000L
        9 -> 600_000L
        else -> { wipeAllKeys(); return PinLockoutState.Wiped }
    }
    if (lockoutMs > 0) {
        prefs.edit().putLong("lockout_until", System.currentTimeMillis() + lockoutMs).apply()
        return PinLockoutState.LockedOut(System.currentTimeMillis() + lockoutMs)
    }
    return PinLockoutState.Unlocked(10 - attempts)
}
```

### H10: Validate Deep Link Relay URLs

```kotlin
private fun isValidRelayHost(host: String): Boolean {
    if (host == "localhost" || host == "127.0.0.1" || host == "::1") return false
    val blocked = listOf("10.", "192.168.", "169.254.", "fe80:") +
        (16..31).map { "172.$it." }
    return blocked.none { host.startsWith(it) }
}
```

### H11: Upgrade EncryptedSharedPreferences Library

**`apps/android/gradle/libs.versions.toml`**: `security-crypto = "1.0.0"` (stable)

### H12: Request StrongBox Backing

```kotlin
private val masterKey: MasterKey by lazy {
    MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .setRequestStrongBoxBacked(true)
        .build()
}
```

### H13: Remove Dev IP from Release Network Config

Move dev IPs to `app/src/debug/res/xml/network_security_config.xml`. Release config has only:
```xml
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors><certificates src="system" /></trust-anchors>
    </base-config>
</network-security-config>
```

### H14: Certificate Pinning

Pin hashes shared with iOS — stored in `docs/security/CERTIFICATE_PINS.md`. Extract with same openssl command documented in Epic 260.

```kotlin
val certificatePinner = CertificatePinner.Builder()
    // Pins from docs/security/CERTIFICATE_PINS.md — update on cert rotation
    .add("*.llamenos.org", "sha256/<pin-from-shared-doc>")
    .add("*.llamenos.org", "sha256/<backup-pin-from-shared-doc>")
    .build()
```

### M30: Fix AuthInterceptor Race

Return synthetic 401 instead of dispatching unauthenticated request:
```kotlin
} catch (_: Exception) {
    return Response.Builder()
        .code(401).message("Authentication failed")
        .protocol(Protocol.HTTP_1_1).request(originalRequest)
        .body("".toResponseBody(null)).build()
}
```

### M31: Narrow ProGuard Rules

```proguard
-keepclassmembers class org.llamenos.hotline.api.models.** { <fields>; <init>(...); }
-keep @kotlinx.serialization.Serializable class org.llamenos.hotline.api.models.** { *; }
```

## Tests

### Unit Tests (`src/test/`)
- `CryptoServiceTest`: verify throws when `nativeLibLoaded=false`
- `KeystoreServiceTest`: lockout after 5, 9, 10 attempts; persistence
- `DeviceLinkViewModelTest`: `isValidRelayHost` rejects private IPs
- `AuthInterceptorTest`: synthetic 401 on signing failure

### Instrumented Tests (`src/androidTest/`)
- PIN lockout UI shows countdown after 5 failures
- nsec cleared from state after import
- QR scan with localhost shows error

### Cucumber BDD
- Update `PINSteps.kt` with lockout scenarios
- Add `DeviceLinkSteps.kt` for QR validation

## Files to Modify
| File | Action |
|------|--------|
| `apps/android/.../crypto/CryptoService.kt` | Remove fallback, hard-fail |
| `apps/android/.../crypto/KeystoreService.kt` | StrongBox, PIN lockout |
| `apps/android/.../ui/auth/AuthViewModel.kt` | Clear state, wire lockout |
| `apps/android/.../ui/provisioning/DeviceLinkViewModel.kt` | URL validation |
| `apps/android/.../api/ApiService.kt` | Certificate pinning |
| `apps/android/.../api/AuthInterceptor.kt` | Synthetic 401 |
| `apps/android/gradle/libs.versions.toml` | Upgrade security-crypto |
| `apps/android/app/src/main/res/xml/network_security_config.xml` | Remove dev IP |
| `apps/android/app/src/debug/res/xml/network_security_config.xml` | Create debug overlay |
| `apps/android/app/proguard-rules.pro` | Narrow keep rules |

### Cross-Platform ECIES Migration E2E Test

After Epic 259 ECIES KDF v2 lands, add a unit test:
```kotlin
@Test
fun `ECIES v1 ciphertext decrypts with migration flag`() {
    // Pre-generated v1 ciphertext from test vectors
    val result = CryptoService.eciesDecrypt(v1Ciphertext, testKey)
    assertTrue(result.needsMigration)
    assertEquals(expectedText, result.plaintext)
}
```

## Dependencies
- Certificate pins must match deployment's TLS certificate chain — use shared `docs/security/CERTIFICATE_PINS.md`
- StrongBox falls back gracefully on unsupported devices
- Epic 259 (crypto KDF) should land first
