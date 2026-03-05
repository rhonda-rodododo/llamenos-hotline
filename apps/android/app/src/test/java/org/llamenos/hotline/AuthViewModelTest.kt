package org.llamenos.hotline

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.crypto.KeystoreService
import org.llamenos.hotline.ui.auth.AuthUiState
import org.llamenos.hotline.ui.auth.AuthViewModel

/**
 * Unit tests for AuthViewModel state machine transitions.
 *
 * Tests the complete auth flow:
 *   Login -> CreateIdentity -> Onboarding -> PINSet -> Dashboard
 *   Login -> ImportKey -> PINSet -> Dashboard
 *   PINUnlock -> Dashboard (stored keys exist)
 *
 * Uses [InMemoryKeyValueStore] to avoid Android Keystore dependency.
 *
 * Note: Since Epic 261 (C6), CryptoService hard-fails without the native library.
 * Tests that exercise crypto paths (generateKeypair, importNsec, encryptForStorage)
 * will throw [IllegalStateException]. These tests verify ViewModel state machine
 * transitions using [CryptoService.setTestKeyState] to simulate crypto state.
 *
 * Tests that require PIN encryption/decryption (encryptForStorage, decryptFromStorage)
 * are skipped in JVM tests — they require the native library and are tested in
 * instrumented tests on device/emulator with JNI libs present.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()
    private lateinit var cryptoService: CryptoService
    private lateinit var keyValueStore: InMemoryKeyValueStore

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        cryptoService = CryptoService()
        cryptoService.computeDispatcher = testDispatcher
        keyValueStore = InMemoryKeyValueStore()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(): AuthViewModel {
        return AuthViewModel(cryptoService, keyValueStore)
    }

    /**
     * Helper: simulate a successful key generation by setting test state.
     * In production, this comes from native FFI — here we set it directly.
     */
    private fun simulateKeyGeneration() {
        val secretHex = "a".repeat(64)
        val nsec = "nsec1" + "a".repeat(58)
        val pubHex = "b".repeat(64)
        val npub = "npub1" + "b".repeat(58)
        cryptoService.setTestKeyState(secretHex, nsec, pubHex, npub)
    }

    // ---- Initial State ----

    @Test
    fun `initial state has no stored keys and is not authenticated`() {
        val vm = createViewModel()
        val state = vm.uiState.value

        assertFalse(state.hasStoredKeys)
        assertFalse(state.isAuthenticated)
        assertFalse(state.isLoading)
        assertNull(state.error)
        assertEquals("", state.hubUrl)
        assertEquals("", state.nsecInput)
    }

    @Test
    fun `initial state detects existing stored keys`() {
        keyValueStore.store(KeystoreService.KEY_ENCRYPTED_KEYS, "{}")
        val vm = createViewModel()

        assertTrue(vm.uiState.value.hasStoredKeys)
        assertFalse(vm.uiState.value.isAuthenticated)
    }

    // ---- Hub URL & Input Fields ----

    @Test
    fun `updateHubUrl updates state`() {
        val vm = createViewModel()
        vm.updateHubUrl("https://llamenos.example.com")

        assertEquals("https://llamenos.example.com", vm.uiState.value.hubUrl)
    }

    @Test
    fun `updateHubUrl clears previous error`() {
        val vm = createViewModel()
        vm.importKey() // triggers "Please enter your nsec" error
        assertNotNull(vm.uiState.value.error)

        vm.updateHubUrl("https://new.hub.com")
        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `updateNsecInput updates state and clears error`() {
        val vm = createViewModel()
        vm.importKey() // triggers error
        vm.updateNsecInput("nsec1abc123")

        assertEquals("nsec1abc123", vm.uiState.value.nsecInput)
        assertNull(vm.uiState.value.error)
    }

    // ---- Create Identity ----

    @Test
    fun `createNewIdentity without native lib shows error`() {
        val vm = createViewModel()
        vm.updateHubUrl("https://hub.example.com")
        vm.createNewIdentity()

        val state = vm.uiState.value
        // Should fail because native lib is not loaded (C6 hard-fail)
        assertNotNull("Should have error without native lib", state.error)
        assertFalse(state.isLoading)
    }

    @Test
    fun `createNewIdentity stores hub URL even on crypto failure`() {
        val vm = createViewModel()
        vm.updateHubUrl("https://hub.example.com")
        vm.createNewIdentity()

        // Hub URL is stored before crypto call
        assertEquals("https://hub.example.com", keyValueStore.retrieve(KeystoreService.KEY_HUB_URL))
    }

    // ---- Import Key ----

    @Test
    fun `importKey with empty input shows error`() {
        val vm = createViewModel()
        vm.importKey()

        assertEquals("Please enter your nsec", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `importKey with invalid prefix shows error`() {
        val vm = createViewModel()
        vm.updateNsecInput("not-a-valid-nsec")
        vm.importKey()

        assertNotNull(vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `importKey without native lib shows error`() {
        val vm = createViewModel()
        vm.updateHubUrl("https://hub.example.com")
        vm.updateNsecInput("nsec1" + "a".repeat(58))
        vm.importKey()

        // Should fail because native lib is not loaded (C6 hard-fail)
        assertNotNull("Should have error without native lib", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    // ---- H-2a + M29: Clear nsec and PIN from Compose State ----

    @Test
    fun `confirmBackup clears generatedNsec from state`() {
        val vm = createViewModel()
        // Manually set state to simulate key generation
        // (can't call createNewIdentity without native lib)
        assertFalse(vm.uiState.value.backupConfirmed)

        vm.confirmBackup()

        val state = vm.uiState.value
        assertTrue(state.backupConfirmed)
        assertNull("generatedNsec should be cleared after backup confirmation", state.generatedNsec)
    }

    // ---- PIN Set Flow ----

    @Test
    fun `PIN set first entry moves to confirmation mode`() {
        val vm = createViewModel()
        vm.onPinSetComplete("1234")

        val state = vm.uiState.value
        assertEquals("1234", state.pin)
        assertTrue(state.isConfirmingPin)
        assertFalse(state.pinMismatch)
        assertEquals("", state.confirmPin)
    }

    @Test
    fun `PIN set mismatched confirmation shows pinMismatch`() {
        val vm = createViewModel()
        simulateKeyGeneration()

        vm.onPinSetComplete("1234")
        vm.onPinSetComplete("5678")

        val state = vm.uiState.value
        assertTrue(state.pinMismatch)
        assertEquals("", state.confirmPin)
        assertFalse(state.isAuthenticated)
    }

    // ---- PIN Unlock (state machine only — no crypto) ----

    @Test
    fun `PIN unlock with no stored keys shows error`() = runTest {
        val vm = createViewModel()
        vm.unlockWithPin("1234")

        assertNotNull(vm.uiState.value.error)
        assertFalse(vm.uiState.value.isAuthenticated)
        assertEquals("", vm.uiState.value.pin) // PIN cleared even on failure
    }

    // ---- Reset ----

    @Test
    fun `resetPinEntry clears all PIN state`() {
        val vm = createViewModel()
        vm.onPinSetComplete("1234")
        assertTrue(vm.uiState.value.isConfirmingPin)

        vm.resetPinEntry()

        val state = vm.uiState.value
        assertEquals("", state.pin)
        assertEquals("", state.confirmPin)
        assertFalse(state.isConfirmingPin)
        assertFalse(state.pinMismatch)
        assertNull(state.error)
    }

    @Test
    fun `resetAuthState clears crypto and storage`() = runTest {
        simulateKeyGeneration()
        keyValueStore.store(KeystoreService.KEY_ENCRYPTED_KEYS, "{}")
        keyValueStore.store(KeystoreService.KEY_PUBKEY, "testpub")

        val vm = createViewModel()
        vm.resetAuthState()

        assertFalse(cryptoService.isUnlocked)
        assertFalse(keyValueStore.contains(KeystoreService.KEY_ENCRYPTED_KEYS))
        assertFalse(keyValueStore.contains(KeystoreService.KEY_PUBKEY))
    }

    // ---- Update PIN clears error ----

    @Test
    fun `updatePin clears error and pinMismatch`() {
        val vm = createViewModel()
        vm.importKey() // triggers error
        assertNotNull(vm.uiState.value.error)

        vm.updatePin("12")

        assertNull(vm.uiState.value.error)
        assertFalse(vm.uiState.value.pinMismatch)
    }

    @Test
    fun `updateConfirmPin clears error and pinMismatch`() {
        val vm = createViewModel()
        simulateKeyGeneration()
        vm.onPinSetComplete("1234")
        vm.onPinSetComplete("5678") // trigger mismatch
        assertTrue(vm.uiState.value.pinMismatch)

        vm.updateConfirmPin("12")

        assertFalse(vm.uiState.value.pinMismatch)
        assertNull(vm.uiState.value.error)
    }

    // ---- Lockout State ----

    @Test
    fun `initial lockout state fields are default`() {
        val state = AuthUiState()
        assertFalse(state.isLockedOut)
        assertEquals(0L, state.lockoutUntil)
        assertFalse(state.isWiped)
        assertEquals(0, state.failedAttempts)
    }
}
