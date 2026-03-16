package org.llamenos.hotline.ui.events

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.llamenos.hotline.api.ApiService
import org.llamenos.hotline.model.EntityTypeDefinition
import org.llamenos.hotline.model.EntityTypesResponse
import org.llamenos.hotline.model.RecordsListResponse
import org.llamenos.hotline.model.UpdateRecordRequest
import org.llamenos.protocol.Record
import javax.inject.Inject

/**
 * UI state for the events screens.
 *
 * Events are CMS records whose entity type has category === "event".
 * This mirrors the desktop events page which filters entity types by category.
 */
data class EventsUiState(
    // Entity types
    val entityTypes: List<EntityTypeDefinition> = emptyList(),
    val isLoadingEntityTypes: Boolean = false,

    // Event records
    val events: List<Record> = emptyList(),
    val total: Int = 0,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,

    // Selected event detail
    val selectedEvent: Record? = null,
    val isLoadingDetail: Boolean = false,
    val detailError: String? = null,

    // Search
    val searchQuery: String = "",

    // CMS enabled check
    val cmsEnabled: Boolean? = null,

    // Status update
    val isUpdatingStatus: Boolean = false,
    val actionError: String? = null,
    val actionSuccess: String? = null,
) {
    /**
     * Event entity types only (category === "event").
     */
    val eventEntityTypes: List<EntityTypeDefinition>
        get() = entityTypes.filter { it.category == "event" && !it.isArchived }

    /**
     * Map of entity type ID to definition for quick lookup.
     */
    val entityTypeMap: Map<String, EntityTypeDefinition>
        get() = entityTypes.associateBy { it.id }

    /**
     * Events filtered by search query.
     */
    val filteredEvents: List<Record>
        get() = if (searchQuery.isBlank()) {
            events
        } else {
            val query = searchQuery.lowercase()
            events.filter { record ->
                (record.caseNumber ?: record.id).lowercase().contains(query)
            }
        }
}

/**
 * ViewModel for the events screens (list + detail).
 *
 * Loads entity type definitions filtered to event category, then fetches
 * records for those entity types. Supports search, status updates,
 * and pull-to-refresh.
 */
@HiltViewModel
class EventsViewModel @Inject constructor(
    private val apiService: ApiService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(EventsUiState())
    val uiState: StateFlow<EventsUiState> = _uiState.asStateFlow()

    init {
        checkCmsEnabled()
        loadEntityTypes()
    }

    /**
     * Check if CMS is enabled for this hub.
     */
    private fun checkCmsEnabled() {
        viewModelScope.launch {
            try {
                @kotlinx.serialization.Serializable
                data class CmsStatusResponse(val enabled: Boolean)

                val response = apiService.request<CmsStatusResponse>(
                    "GET",
                    "/api/settings/cms/enabled",
                )
                _uiState.update { it.copy(cmsEnabled = response.enabled) }
            } catch (_: Exception) {
                _uiState.update { it.copy(cmsEnabled = false) }
            }
        }
    }

    /**
     * Load entity type definitions from GET /api/settings/cms/entity-types.
     * After loading, triggers event record loading for event types.
     */
    fun loadEntityTypes() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingEntityTypes = true) }
            try {
                val response = apiService.request<EntityTypesResponse>(
                    "GET",
                    "/api/settings/cms/entity-types",
                )
                _uiState.update {
                    it.copy(
                        entityTypes = response.entityTypes,
                        isLoadingEntityTypes = false,
                    )
                }
                // Now load events for the first event entity type
                loadEvents()
            } catch (_: Exception) {
                _uiState.update { it.copy(isLoadingEntityTypes = false) }
                // Entity types unavailable — likely CMS not configured
            }
        }
    }

    /**
     * Load event records from GET /api/records filtered to event entity types.
     */
    fun loadEvents() {
        val eventTypes = _uiState.value.eventEntityTypes
        if (eventTypes.isEmpty()) {
            _uiState.update {
                it.copy(
                    events = emptyList(),
                    total = 0,
                    isLoading = false,
                    isRefreshing = false,
                )
            }
            return
        }

        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = it.events.isEmpty(),
                    isRefreshing = it.events.isNotEmpty(),
                    error = null,
                )
            }
            try {
                // Load records for the first event entity type
                val firstEventType = eventTypes.first()
                val response = apiService.request<RecordsListResponse>(
                    "GET",
                    "/api/records?entityTypeId=${firstEventType.id}&limit=50",
                )
                _uiState.update {
                    it.copy(
                        events = response.records,
                        total = response.total,
                        isLoading = false,
                        isRefreshing = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isRefreshing = false,
                        error = e.message ?: "Failed to load events",
                    )
                }
            }
        }
    }

    /**
     * Load a single event by ID for the detail view.
     */
    fun selectEvent(eventId: String) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoadingDetail = true,
                    detailError = null,
                    selectedEvent = null,
                )
            }
            try {
                val record = apiService.request<Record>("GET", "/api/records/$eventId")
                _uiState.update {
                    it.copy(
                        selectedEvent = record,
                        isLoadingDetail = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoadingDetail = false,
                        detailError = e.message ?: "Failed to load event",
                    )
                }
            }
        }
    }

    /**
     * Update the status of an event record.
     */
    fun updateStatus(recordId: String, statusHash: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isUpdatingStatus = true, actionError = null) }
            try {
                val request = UpdateRecordRequest(statusHash = statusHash)
                apiService.request<Record>("PATCH", "/api/records/$recordId", request)
                _uiState.update {
                    it.copy(
                        isUpdatingStatus = false,
                        actionSuccess = "Status updated",
                    )
                }
                loadEvents()
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isUpdatingStatus = false,
                        actionError = e.message ?: "Failed to update status",
                    )
                }
            }
        }
    }

    /**
     * Set the search query for filtering events.
     */
    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun refresh() {
        loadEntityTypes()
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }

    fun dismissActionError() {
        _uiState.update { it.copy(actionError = null) }
    }

    fun dismissActionSuccess() {
        _uiState.update { it.copy(actionSuccess = null) }
    }

    fun clearSelection() {
        _uiState.update {
            it.copy(
                selectedEvent = null,
                detailError = null,
            )
        }
    }
}
