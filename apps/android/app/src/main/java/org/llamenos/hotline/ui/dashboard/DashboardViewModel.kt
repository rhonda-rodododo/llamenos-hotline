package org.llamenos.hotline.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import androidx.annotation.StringRes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.llamenos.hotline.R
import org.llamenos.hotline.api.ApiService
import org.llamenos.hotline.api.SessionState
import org.llamenos.hotline.api.WebSocketService
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.model.ClockResponse
import org.llamenos.hotline.model.LlamenosEvent
import org.llamenos.hotline.model.MeResponse
import org.llamenos.hotline.model.ShiftStatusResponse
import javax.inject.Inject

data class DashboardUiState(
    val npub: String = "",
    val isOnShift: Boolean = false,
    val isOnBreak: Boolean = false,
    val shiftStartedAt: String? = null,
    val activeCallCount: Int = 0,
    val callsToday: Int = 0,
    val connectionState: WebSocketService.ConnectionState = WebSocketService.ConnectionState.DISCONNECTED,
    val isRefreshing: Boolean = false,
    val isClockingInOut: Boolean = false,
    val isTogglingBreak: Boolean = false,
    @StringRes val errorRes: Int? = null,
)

/**
 * ViewModel for the dashboard screen.
 *
 * Manages shift status display, active call count, WebSocket connection state,
 * and real-time event processing. Subscribes to the WebSocket event flow to
 * react to incoming calls, shift updates, and note creation in real time.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val cryptoService: CryptoService,
    private val webSocketService: WebSocketService,
    private val apiService: ApiService,
    private val sessionState: SessionState,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init {
        val npub = cryptoService.npub ?: ""
        _uiState.value = DashboardUiState(npub = npub)

        // Fetch auth info (including server event key) before connecting WebSocket
        viewModelScope.launch {
            fetchServerEventKey()
            webSocketService.connect()
        }

        // Subscribe to connection state changes
        viewModelScope.launch {
            webSocketService.connectionState.collect { state ->
                _uiState.update { it.copy(connectionState = state) }
            }
        }

        // Subscribe to typed (decrypted + parsed) events from the relay
        viewModelScope.launch {
            webSocketService.typedEvents.collect { event ->
                handleEvent(event)
            }
        }

        // Load initial shift status
        viewModelScope.launch { loadShiftStatus() }
    }

    /**
     * React to typed application events by updating dashboard state.
     */
    private fun handleEvent(event: LlamenosEvent) {
        when (event) {
            is LlamenosEvent.CallRing -> {
                _uiState.update { it.copy(activeCallCount = it.activeCallCount + 1) }
            }
            is LlamenosEvent.CallEnded -> {
                _uiState.update {
                    it.copy(activeCallCount = maxOf(0, it.activeCallCount - 1))
                }
            }
            is LlamenosEvent.ShiftUpdate -> {
                viewModelScope.launch { loadShiftStatus() }
            }
            is LlamenosEvent.NoteCreated -> {
                // Notes list will refresh via its own ViewModel
            }
            is LlamenosEvent.MessageNew -> {
                // Conversations list will refresh via its own ViewModel
            }
            is LlamenosEvent.ConversationAssigned,
            is LlamenosEvent.ConversationClosed -> {
                // Conversations list will refresh via its own ViewModel
            }
            is LlamenosEvent.CallUpdate -> {
                // Call status updates handled by call UI
            }
            is LlamenosEvent.VoicemailNew -> {
                // Voicemail notifications handled by call UI
            }
            is LlamenosEvent.PresenceSummary -> {
                // Presence updates could refresh availability indicators
            }
            is LlamenosEvent.Unknown -> {
                // Forward compatibility — ignore unknown events
            }
        }
    }

    /**
     * Fetch the server event encryption key from GET /api/auth/me.
     * Sets it on WebSocketService so relay events can be decrypted.
     */
    private suspend fun fetchServerEventKey() {
        try {
            val me = apiService.request<MeResponse>("GET", "/api/auth/me")
            webSocketService.serverEventKeyHex = me.serverEventKeyHex
            sessionState.adminDecryptionPubkey = me.adminDecryptionPubkey
        } catch (_: Exception) {
            // Non-fatal — WebSocket will still connect but events won't decrypt.
            // The key will be retried on next refresh.
        }
    }

    /**
     * Load the current volunteer's shift status from the API.
     * Returns true on success, false on failure.
     */
    private suspend fun loadShiftStatus(): Boolean {
        return try {
            val status = apiService.request<ShiftStatusResponse>("GET", "/api/shifts/status")
            _uiState.update {
                it.copy(
                    isOnShift = status.isOnShift,
                    isOnBreak = status.onBreak,
                    shiftStartedAt = status.startedAt,
                    activeCallCount = status.activeCallCount ?: it.activeCallCount,
                    callsToday = status.callsToday ?: it.callsToday,
                    errorRes = null,
                )
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Quick clock in from the dashboard.
     */
    fun clockIn() {
        viewModelScope.launch {
            _uiState.update { it.copy(isClockingInOut = true, errorRes = null) }
            try {
                apiService.request<ClockResponse>("POST", "/api/shifts/clock-in")
                loadShiftStatus()
            } catch (_: Exception) {
                _uiState.update { it.copy(errorRes = R.string.dashboard_error_clock_in) }
            }
            _uiState.update { it.copy(isClockingInOut = false) }
        }
    }

    /**
     * Quick clock out from the dashboard.
     */
    fun clockOut() {
        viewModelScope.launch {
            _uiState.update { it.copy(isClockingInOut = true, errorRes = null) }
            try {
                apiService.request<ClockResponse>("POST", "/api/shifts/clock-out")
                loadShiftStatus()
            } catch (_: Exception) {
                _uiState.update { it.copy(errorRes = R.string.dashboard_error_clock_out) }
            }
            _uiState.update { it.copy(isClockingInOut = false) }
        }
    }

    /**
     * Toggle break status.
     */
    fun toggleBreak() {
        viewModelScope.launch {
            _uiState.update { it.copy(isTogglingBreak = true, errorRes = null) }
            val newBreakState = !_uiState.value.isOnBreak
            try {
                apiService.requestNoContent(
                    "PATCH",
                    "/api/auth/me/availability",
                    mapOf("onBreak" to newBreakState),
                )
                _uiState.update {
                    it.copy(isOnBreak = newBreakState, isTogglingBreak = false)
                }
            } catch (_: Exception) {
                _uiState.update {
                    it.copy(
                        isTogglingBreak = false,
                        errorRes = R.string.dashboard_error_break,
                    )
                }
            }
        }
    }

    /**
     * Pull-to-refresh on the dashboard.
     */
    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true, errorRes = null) }
            val success = loadShiftStatus()
            if (!success) {
                _uiState.update { it.copy(errorRes = R.string.dashboard_error_refresh) }
            }
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    /**
     * Dismiss the error message.
     */
    fun dismissError() {
        _uiState.update { it.copy(errorRes = null) }
    }

    override fun onCleared() {
        super.onCleared()
        webSocketService.serverEventKeyHex = null
        webSocketService.disconnect()
    }
}
