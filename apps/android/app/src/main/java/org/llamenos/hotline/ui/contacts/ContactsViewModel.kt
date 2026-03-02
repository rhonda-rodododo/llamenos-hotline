package org.llamenos.hotline.ui.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.llamenos.hotline.api.ApiService
import org.llamenos.hotline.model.ContactSummary
import org.llamenos.hotline.model.ContactsListResponse
import javax.inject.Inject

data class ContactsUiState(
    val contacts: List<ContactSummary> = emptyList(),
    val total: Int = 0,
    val currentPage: Int = 1,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
)

/**
 * ViewModel for the contacts screen.
 *
 * Loads paginated contact summaries from GET /contacts. Each contact
 * shows aggregated interaction counts (calls, conversations, notes, reports).
 */
@HiltViewModel
class ContactsViewModel @Inject constructor(
    private val apiService: ApiService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ContactsUiState())
    val uiState: StateFlow<ContactsUiState> = _uiState.asStateFlow()

    init {
        loadContacts()
    }

    fun loadContacts(page: Int = 1) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = page == 1 && it.contacts.isEmpty(),
                    isRefreshing = page == 1 && it.contacts.isNotEmpty(),
                    error = null,
                )
            }
            try {
                val response = apiService.request<ContactsListResponse>(
                    "GET",
                    "/api/contacts?page=$page&limit=50",
                )
                _uiState.update {
                    it.copy(
                        contacts = if (page == 1) response.contacts else it.contacts + response.contacts,
                        total = response.total,
                        currentPage = page,
                        isLoading = false,
                        isRefreshing = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isRefreshing = false,
                        error = e.message ?: "Failed to load contacts",
                    )
                }
            }
        }
    }

    fun refresh() {
        loadContacts(page = 1)
    }

    fun loadNextPage() {
        val state = _uiState.value
        if (state.contacts.size < state.total && !state.isLoading) {
            loadContacts(page = state.currentPage + 1)
        }
    }
}
