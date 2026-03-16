package org.llamenos.hotline.ui.admin

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
import javax.inject.Inject

/**
 * UI state for the schema browser screen.
 */
data class SchemaBrowserUiState(
    val entityTypes: List<EntityTypeDefinition> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val selectedEntityType: EntityTypeDefinition? = null,
)

/**
 * ViewModel for the read-only Schema Browser.
 * Fetches entity type definitions from the CMS API and exposes them
 * for display. No editing — that is desktop-only.
 */
@HiltViewModel
class SchemaBrowserViewModel @Inject constructor(
    private val apiService: ApiService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SchemaBrowserUiState())
    val uiState: StateFlow<SchemaBrowserUiState> = _uiState.asStateFlow()

    init {
        loadEntityTypes()
    }

    /**
     * Fetch entity type definitions from GET /api/settings/cms/entity-types.
     */
    fun loadEntityTypes() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            try {
                val response = apiService.request<EntityTypesResponse>(
                    "GET",
                    "/api/settings/cms/entity-types",
                )
                _uiState.update {
                    it.copy(
                        entityTypes = response.entityTypes.filter { et -> !et.isArchived },
                        isLoading = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to load entity types",
                    )
                }
            }
        }
    }

    /**
     * Select an entity type to view its details.
     */
    fun selectEntityType(entityType: EntityTypeDefinition) {
        _uiState.update { it.copy(selectedEntityType = entityType) }
    }

    /**
     * Clear selection (navigate back from detail).
     */
    fun clearSelection() {
        _uiState.update { it.copy(selectedEntityType = null) }
    }
}
