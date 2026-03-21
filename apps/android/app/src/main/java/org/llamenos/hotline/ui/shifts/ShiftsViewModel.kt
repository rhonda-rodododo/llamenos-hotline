package org.llamenos.hotline.ui.shifts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.llamenos.hotline.api.ApiService
import org.llamenos.hotline.hub.ActiveHubState
import org.llamenos.hotline.model.ClockResponse
import org.llamenos.hotline.model.ShiftResponse
import org.llamenos.hotline.model.ShiftStatusResponse
import org.llamenos.hotline.model.ShiftsListResponse
import javax.inject.Inject

data class ShiftsUiState(
    val shifts: List<ShiftResponse> = emptyList(),
    val currentStatus: ShiftStatusResponse? = null,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isClockingInOut: Boolean = false,
    val error: String? = null,
    val showDropConfirmation: String? = null, // shift ID if dialog is showing
)

/**
 * ViewModel for the Shifts feature.
 *
 * Manages shift listing, clock in/out, sign up, and drop operations.
 * Shifts are grouped by day for display and include status badges
 * showing availability and assignment.
 */
@HiltViewModel
class ShiftsViewModel @Inject constructor(
    private val apiService: ApiService,
    private val activeHubState: ActiveHubState,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ShiftsUiState())
    val uiState: StateFlow<ShiftsUiState> = _uiState.asStateFlow()

    init {
        activeHubState.activeHubId
            .filterNotNull()
            .onEach { refresh() }
            .launchIn(viewModelScope)
    }

    /**
     * Load available shifts from the API.
     */
    fun loadShifts() {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = it.shifts.isEmpty(),
                    isRefreshing = it.shifts.isNotEmpty(),
                    error = null,
                )
            }

            try {
                val response = apiService.request<ShiftsListResponse>("GET", "/api/shifts")
                _uiState.update {
                    it.copy(
                        shifts = response.shifts,
                        isLoading = false,
                        isRefreshing = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isRefreshing = false,
                        error = e.message ?: "Failed to load shifts",
                    )
                }
            }
        }
    }

    /**
     * Load the current volunteer's shift status.
     */
    fun loadShiftStatus() {
        viewModelScope.launch {
            try {
                val status = apiService.request<ShiftStatusResponse>("GET", "/api/shifts/status")
                _uiState.update { it.copy(currentStatus = status) }
            } catch (_: Exception) {
                // Status fetch failure is non-critical
            }
        }
    }

    /**
     * Refresh all shift data (pull-to-refresh).
     */
    fun refresh() {
        loadShifts()
        loadShiftStatus()
    }

    /**
     * Clock in to start receiving calls.
     */
    fun clockIn() {
        viewModelScope.launch {
            _uiState.update { it.copy(isClockingInOut = true, error = null) }

            try {
                apiService.request<ClockResponse>("POST", "/api/shifts/clock-in")
                loadShiftStatus()
                _uiState.update { it.copy(isClockingInOut = false) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isClockingInOut = false,
                        error = e.message ?: "Failed to clock in",
                    )
                }
            }
        }
    }

    /**
     * Clock out to stop receiving calls.
     */
    fun clockOut() {
        viewModelScope.launch {
            _uiState.update { it.copy(isClockingInOut = true, error = null) }

            try {
                apiService.request<ClockResponse>("POST", "/api/shifts/clock-out")
                loadShiftStatus()
                _uiState.update { it.copy(isClockingInOut = false) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isClockingInOut = false,
                        error = e.message ?: "Failed to clock out",
                    )
                }
            }
        }
    }

    /**
     * Sign up for an available shift.
     */
    fun signUp(shiftId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(error = null) }

            try {
                apiService.requestNoContent("POST", "/api/shifts/$shiftId/signup")
                loadShifts()
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = e.message ?: "Failed to sign up for shift")
                }
            }
        }
    }

    /**
     * Show the drop confirmation dialog for a shift.
     */
    fun showDropConfirmation(shiftId: String) {
        _uiState.update { it.copy(showDropConfirmation = shiftId) }
    }

    /**
     * Dismiss the drop confirmation dialog.
     */
    fun dismissDropConfirmation() {
        _uiState.update { it.copy(showDropConfirmation = null) }
    }

    /**
     * Drop an assigned shift after user confirmation.
     */
    fun dropShift(shiftId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(showDropConfirmation = null, error = null) }

            try {
                apiService.requestNoContent("POST", "/api/shifts/$shiftId/drop")
                loadShifts()
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(error = e.message ?: "Failed to drop shift")
                }
            }
        }
    }

    /**
     * Clear the error state.
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
