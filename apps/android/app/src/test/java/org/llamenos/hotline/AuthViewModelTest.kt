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

    // ─── Initial State ─────────────────────────────────────────

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

    // ─── Hub URL & Input Fields ────────────────────────────────

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

    // ─── Create Identity ───────────────────────────────────────

    @Test
    fun `createNewIdentity generates keypair with valid format`() {
        val vm = createViewModel()
        vm.updateHubUrl("https://hub.example.com")
        vm.createNewIdentity()

        val state = vm.uiState.value
        assertNotNull(state.generatedNsec)
        assertNotNull(state.generatedNpub)
        assertTrue(state.generatedNsec!!.startsWith("nsec1"))
        assertTrue(state.generatedNpub!!.startsWith("npub1"))
        assertFalse(state.isLoading)
        assertNull(state.error)
    }

    @Test
    fun `createNewIdentity stores hub URL in key-value store`() {
        val vm = createViewModel()
        vm.updateHubUrl("https://hub.example.com")
        vm.createNewIdentity()

        assertEquals("https://hub.example.com", keyValueStore.retrieve(KeystoreService.KEY_HUB_URL))
    }

    @Test
    fun `createNewIdentity with empty hub URL skips storage`() {
        val vm = createViewModel()
        vm.createNewIdentity()

        assertNull(keyValueStore.retrieve(KeystoreService.KEY_HUB_URL))
        // Should still generate keypair successfully
        assertNotNull(vm.uiState.value.generatedNsec)
    }

    @Test
    fun `createNewIdentity unlocks crypto service`() {
        val vm = createViewModel()
        vm.createNewIdentity()

        assertTrue(cryptoService.isUnlocked)
        assertNotNull(cryptoService.pubkey)
    }

    // ─── Import Key ────────────────────────────────────────────

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
    fun `importKey with valid nsec unlocks crypto and stores hub URL`() {
        val vm = createViewModel()
        vm.updateHubUrl("https://hub.example.com")
        vm.updateNsecInput("nsec1" + "a".repeat(58))
        vm.importKey()

        assertTrue(cryptoService.isUnlocked)
        assertFalse(vm.uiState.value.isLoading)
        assertNull(vm.uiState.value.error)
        assertEquals("https://hub.example.com", keyValueStore.retrieve(KeystoreService.KEY_HUB_URL))
    }

    // ─── Backup Confirmation ───────────────────────────────────

    @Test
    fun `confirmBackup sets backupConfirmed flag`() {
        val vm = createViewModel()
        assertFalse(vm.uiState.value.backupConfirmed)

        vm.confirmBackup()

        assertTrue(vm.uiState.value.backupConfirmed)
    }

    // ─── PIN Set Flow ──────────────────────────────────────────

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
    fun `PIN set matching confirmation encrypts and stores key`() = runTest {
        val vm = createViewModel()
        vm.createNewIdentity()

        vm.onPinSetComplete("1234")  // First entry
        vm.onPinSetComplete("1234")  // Confirmation matches



        val state = vm.uiState.value
        assertTrue(state.isAuthenticated)
        assertTrue(state.hasStoredKeys)
        assertTrue(keyValueStore.contains(KeystoreService.KEY_ENCRYPTED_KEYS))
    }

    @Test
    fun `PIN set mismatched confirmation shows pinMismatch`() {
        val vm = createViewModel()
        vm.createNewIdentity()

        vm.onPinSetComplete("1234")
        vm.onPinSetComplete("5678")

        val state = vm.uiState.value
        assertTrue(state.pinMismatch)
        assertEquals("", state.confirmPin)
        assertFalse(state.isAuthenticated)
    }

    @Test
    fun `PIN set stores pubkey and npub for locked display`() = runTest {
        val vm = createViewModel()
        vm.createNewIdentity()

        vm.onPinSetComplete("1234")
        vm.onPinSetComplete("1234")


        assertNotNull(keyValueStore.retrieve(KeystoreService.KEY_PUBKEY))
        assertNotNull(keyValueStore.retrieve(KeystoreService.KEY_NPUB))
    }

    // ─── PIN Unlock ────────────────────────────────────────────

    @Test
    fun `PIN unlock with correct PIN authenticates`() = runTest {
        val vm = createViewModel()
        vm.createNewIdentity()
        vm.onPinSetComplete("1234")
        vm.onPinSetComplete("1234")


        // Simulate app restart
        cryptoService.lock()
        val vm2 = createViewModel()
        assertTrue(vm2.uiState.value.hasStoredKeys)

        vm2.unlockWithPin("1234")


        assertTrue(vm2.uiState.value.isAuthenticated)
        assertNull(vm2.uiState.value.error)
        assertEquals("", vm2.uiState.value.pin) // PIN cleared after unlock
    }

    @Test
    fun `PIN unlock with wrong PIN shows error`() = runTest {
        val vm = createViewModel()
        vm.createNewIdentity()
        vm.onPinSetComplete("1234")
        vm.onPinSetComplete("1234")


        cryptoService.lock()
        val vm2 = createViewModel()
        vm2.unlockWithPin("9999")


        assertEquals("Incorrect PIN", vm2.uiState.value.error)
        assertFalse(vm2.uiState.value.isAuthenticated)
        assertEquals("", vm2.uiState.value.pin) // PIN cleared even on failure
    }

    // ─── Reset ─────────────────────────────────────────────────

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
    fun `resetAuthState clears crypto, storage, and UI state`() = runTest {
        val vm = createViewModel()
        vm.createNewIdentity()
        vm.onPinSetComplete("1234")
        vm.onPinSetComplete("1234")


        assertTrue(vm.uiState.value.isAuthenticated)

        vm.resetAuthState()

        assertFalse(cryptoService.isUnlocked)
        assertFalse(keyValueStore.contains(KeystoreService.KEY_ENCRYPTED_KEYS))
        assertEquals(AuthUiState(), vm.uiState.value)
    }

    // ─── Update PIN clears error ───────────────────────────────

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
        vm.createNewIdentity()
        vm.onPinSetComplete("1234")
        vm.onPinSetComplete("5678") // trigger mismatch
        assertTrue(vm.uiState.value.pinMismatch)

        vm.updateConfirmPin("12")

        assertFalse(vm.uiState.value.pinMismatch)
        assertNull(vm.uiState.value.error)
    }
}
