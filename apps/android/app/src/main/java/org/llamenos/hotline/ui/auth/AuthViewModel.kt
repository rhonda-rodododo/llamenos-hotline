package org.llamenos.hotline.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.crypto.EncryptedKeyData
import org.llamenos.hotline.crypto.KeyValueStore
import org.llamenos.hotline.crypto.KeystoreService
import javax.inject.Inject

/**
 * Serializable representation of EncryptedKeyData for storage in KeystoreService.
 */
@Serializable
data class StoredKeyData(
    val ciphertext: String,
    val salt: String,
    val nonce: String,
    val pubkeyHex: String,
)

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,

    // Login screen
    val hubUrl: String = "",
    val nsecInput: String = "",

    // Onboarding
    val generatedNsec: String? = null,
    val generatedNpub: String? = null,
    val backupConfirmed: Boolean = false,

    // PIN
    val pin: String = "",
    val confirmPin: String = "",
    val isConfirmingPin: Boolean = false,
    val pinMismatch: Boolean = false,

    // Auth state
    val hasStoredKeys: Boolean = false,
    val isAuthenticated: Boolean = false,
)

/**
 * ViewModel for the authentication flow.
 *
 * Manages state for login, onboarding (keypair generation), and PIN setup/unlock.
 * All crypto operations are delegated to [CryptoService] and key persistence
 * to [KeystoreService].
 *
 * Auth flow:
 * 1. Check for stored keys -> PINUnlock if found, Login if not
 * 2. Login: Import existing nsec OR generate new keypair (-> Onboarding)
 * 3. Onboarding: Display generated nsec for backup
 * 4. PINSet: Set 4-6 digit PIN with confirmation
 * 5. PINUnlock: Enter PIN to decrypt stored key
 * 6. -> Dashboard
 */
@HiltViewModel
class AuthViewModel @Inject constructor(
    private val cryptoService: CryptoService,
    private val keystoreService: KeyValueStore,
) : ViewModel() {

    private val json = Json { ignoreUnknownKeys = true }

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        checkStoredKeys()
    }

    /**
     * Check if encrypted keys exist in secure storage.
     * Determines initial navigation destination (PINUnlock vs Login).
     */
    private fun checkStoredKeys() {
        val hasKeys = keystoreService.contains(KeystoreService.KEY_ENCRYPTED_KEYS)
        _uiState.update { it.copy(hasStoredKeys = hasKeys) }
    }

    /**
     * Update the hub URL field.
     */
    fun updateHubUrl(url: String) {
        _uiState.update { it.copy(hubUrl = url, error = null) }
    }

    /**
     * Update the nsec input field.
     */
    fun updateNsecInput(nsec: String) {
        _uiState.update { it.copy(nsecInput = nsec, error = null) }
    }

    /**
     * Generate a new Nostr keypair and navigate to onboarding.
     */
    fun createNewIdentity() {
        _uiState.update { it.copy(isLoading = true, error = null) }

        try {
            val hubUrl = _uiState.value.hubUrl.trim()
            if (hubUrl.isNotEmpty()) {
                keystoreService.store(KeystoreService.KEY_HUB_URL, hubUrl)
            }

            val (nsec, npub) = cryptoService.generateKeypair()

            _uiState.update {
                it.copy(
                    isLoading = false,
                    generatedNsec = nsec,
                    generatedNpub = npub,
                )
            }
        } catch (e: Exception) {
            _uiState.update {
                it.copy(
                    isLoading = false,
                    error = e.message ?: "Failed to generate keypair",
                )
            }
        }
    }

    /**
     * Import an existing nsec and navigate to PIN setup.
     */
    fun importKey() {
        val nsec = _uiState.value.nsecInput.trim()
        if (nsec.isEmpty()) {
            _uiState.update { it.copy(error = "Please enter your nsec") }
            return
        }

        _uiState.update { it.copy(isLoading = true, error = null) }

        try {
            val hubUrl = _uiState.value.hubUrl.trim()
            if (hubUrl.isNotEmpty()) {
                keystoreService.store(KeystoreService.KEY_HUB_URL, hubUrl)
            }

            cryptoService.importNsec(nsec)

            _uiState.update { it.copy(isLoading = false) }
        } catch (e: Exception) {
            _uiState.update {
                it.copy(
                    isLoading = false,
                    error = e.message ?: "Failed to import key",
                )
            }
        }
    }

    /**
     * User confirmed they have backed up their nsec.
     */
    fun confirmBackup() {
        _uiState.update { it.copy(backupConfirmed = true) }
    }

    /**
     * Update the PIN entry during PIN set or PIN unlock.
     */
    fun updatePin(newPin: String) {
        _uiState.update { it.copy(pin = newPin, error = null, pinMismatch = false) }
    }

    /**
     * Update the confirmation PIN entry.
     */
    fun updateConfirmPin(newPin: String) {
        _uiState.update { it.copy(confirmPin = newPin, error = null, pinMismatch = false) }
    }

    /**
     * Handle PIN completion during PIN set flow.
     * First entry sets the PIN, second entry confirms it.
     */
    fun onPinSetComplete(enteredPin: String) {
        val state = _uiState.value

        if (!state.isConfirmingPin) {
            // First entry — store and move to confirmation
            _uiState.update {
                it.copy(
                    pin = enteredPin,
                    confirmPin = "",
                    isConfirmingPin = true,
                    pinMismatch = false,
                    error = null,
                )
            }
        } else {
            // Second entry — check match
            if (enteredPin == state.pin) {
                // PINs match — encrypt and store the key
                encryptAndStoreKey(enteredPin)
            } else {
                // Mismatch — reset confirmation
                _uiState.update {
                    it.copy(
                        confirmPin = "",
                        pinMismatch = true,
                        error = null,
                    )
                }
            }
        }
    }

    /**
     * Encrypt the current key with the PIN and persist it.
     */
    private fun encryptAndStoreKey(pin: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val encryptedData = cryptoService.encryptForStorage(pin)

                // Serialize and store
                val storedData = StoredKeyData(
                    ciphertext = encryptedData.ciphertext,
                    salt = encryptedData.salt,
                    nonce = encryptedData.nonce,
                    pubkeyHex = encryptedData.pubkeyHex,
                )
                keystoreService.store(
                    KeystoreService.KEY_ENCRYPTED_KEYS,
                    json.encodeToString(storedData),
                )

                // Store pubkey/npub for display when locked
                cryptoService.pubkey?.let { pk ->
                    keystoreService.store(KeystoreService.KEY_PUBKEY, pk)
                }
                cryptoService.npub?.let { npub ->
                    keystoreService.store(KeystoreService.KEY_NPUB, npub)
                }

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isAuthenticated = true,
                        hasStoredKeys = true,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to encrypt key",
                    )
                }
            }
        }
    }

    /**
     * Attempt to unlock stored keys with the entered PIN.
     */
    fun unlockWithPin(pin: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val storedJson = keystoreService.retrieve(KeystoreService.KEY_ENCRYPTED_KEYS)
                    ?: throw IllegalStateException("No stored keys found")

                val storedData = json.decodeFromString<StoredKeyData>(storedJson)
                val encryptedData = EncryptedKeyData(
                    ciphertext = storedData.ciphertext,
                    salt = storedData.salt,
                    nonce = storedData.nonce,
                    pubkeyHex = storedData.pubkeyHex,
                )

                cryptoService.decryptFromStorage(encryptedData, pin)

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isAuthenticated = true,
                        pin = "",
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = "Incorrect PIN",
                        pin = "",
                    )
                }
            }
        }
    }

    /**
     * Reset PIN entry state (when navigating back from confirm to initial entry).
     */
    fun resetPinEntry() {
        _uiState.update {
            it.copy(
                pin = "",
                confirmPin = "",
                isConfirmingPin = false,
                pinMismatch = false,
                error = null,
            )
        }
    }

    /**
     * Reset all auth state (for logout or starting over).
     */
    fun resetAuthState() {
        cryptoService.lock()
        keystoreService.clear()
        _uiState.value = AuthUiState()
    }
}
