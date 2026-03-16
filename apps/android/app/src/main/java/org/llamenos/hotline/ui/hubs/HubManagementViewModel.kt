package org.llamenos.hotline.ui.hubs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.llamenos.hotline.api.ApiService
import org.llamenos.hotline.model.CreateHubRequest
import org.llamenos.hotline.model.CreateHubResponse
import org.llamenos.hotline.model.Hub
import org.llamenos.hotline.model.HubsListResponse
import javax.inject.Inject

/**
 * UI state for the hub management screens.
 */
data class HubListState(
    val hubs: List<Hub> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,

    // Create hub
    val isCreating: Boolean = false,
    val createError: String? = null,
    val createSuccess: Boolean = false,

    // Active hub (the currently-connected hub)
    val activeHubId: String? = null,
    val isSwitching: Boolean = false,
)

/**
 * ViewModel for hub management screens (list + create).
 *
 * Loads hubs from GET /api/hubs and supports creating new hubs
 * via POST /api/hubs. Hub switching updates the active hub state.
 */
@HiltViewModel
class HubManagementViewModel @Inject constructor(
    private val apiService: ApiService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HubListState())
    val uiState: StateFlow<HubListState> = _uiState.asStateFlow()

    init {
        loadHubs()
    }

    /**
     * Load all hubs from GET /api/hubs.
     */
    fun loadHubs() {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = it.hubs.isEmpty(),
                    isRefreshing = it.hubs.isNotEmpty(),
                    error = null,
                )
            }
            try {
                val response = apiService.request<HubsListResponse>("GET", "/api/hubs")
                _uiState.update {
                    it.copy(
                        hubs = response.hubs,
                        isLoading = false,
                        isRefreshing = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isRefreshing = false,
                        error = e.message ?: "Failed to load hubs",
                    )
                }
            }
        }
    }

    /**
     * Create a new hub via POST /api/hubs.
     */
    fun createHub(name: String, description: String?, phoneNumber: String?) {
        viewModelScope.launch {
            _uiState.update { it.copy(isCreating = true, createError = null, createSuccess = false) }
            try {
                val request = CreateHubRequest(
                    name = name,
                    description = description?.takeIf { it.isNotBlank() },
                    phoneNumber = phoneNumber?.takeIf { it.isNotBlank() },
                )
                apiService.request<CreateHubResponse>("POST", "/api/hubs", request)
                _uiState.update { it.copy(isCreating = false, createSuccess = true) }
                loadHubs()
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isCreating = false,
                        createError = e.message ?: "Failed to create hub",
                    )
                }
            }
        }
    }

    /**
     * Switch the active hub.
     *
     * This updates local state only. The actual hub context switch
     * is handled by the ApiService/SessionState when making requests.
     */
    fun switchHub(hubId: String) {
        _uiState.update { it.copy(activeHubId = hubId) }
    }

    fun refresh() {
        loadHubs()
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }

    fun dismissCreateError() {
        _uiState.update { it.copy(createError = null) }
    }

    fun clearCreateSuccess() {
        _uiState.update { it.copy(createSuccess = false) }
    }
}
