package org.llamenos.hotline.ui.dashboard

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.llamenos.hotline.api.WebSocketService
import org.llamenos.hotline.crypto.CryptoService
import javax.inject.Inject

data class DashboardUiState(
    val npub: String = "",
    val isOnShift: Boolean = false,
    val activeCallCount: Int = 0,
    val connectionState: WebSocketService.ConnectionState = WebSocketService.ConnectionState.DISCONNECTED,
)

/**
 * ViewModel for the dashboard screen.
 *
 * Manages shift status display, active call count, and WebSocket connection state.
 * Full dashboard features (shift management, call handling, notes) will be
 * implemented in Epic 208 (Feature Parity Phase 1).
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val cryptoService: CryptoService,
    private val webSocketService: WebSocketService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init {
        val npub = cryptoService.npub ?: ""
        _uiState.value = DashboardUiState(npub = npub)

        // Connect to the Nostr relay for real-time events
        webSocketService.connect()
    }

    override fun onCleared() {
        super.onCleared()
        webSocketService.disconnect()
    }
}
