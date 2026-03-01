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
import org.llamenos.hotline.model.AddBanRequest
import org.llamenos.hotline.model.AuditEntry
import org.llamenos.hotline.model.AuditLogResponse
import org.llamenos.hotline.model.BanEntry
import org.llamenos.hotline.model.BanListResponse
import org.llamenos.hotline.model.CreateInviteRequest
import org.llamenos.hotline.model.Invite
import org.llamenos.hotline.model.InvitesListResponse
import org.llamenos.hotline.model.Volunteer
import org.llamenos.hotline.model.VolunteersListResponse
import javax.inject.Inject

/**
 * Admin panel tab indices for the TabRow.
 */
enum class AdminTab {
    VOLUNTEERS,
    BANS,
    AUDIT,
    INVITES,
}

data class AdminUiState(
    val selectedTab: AdminTab = AdminTab.VOLUNTEERS,

    // Volunteers
    val volunteers: List<Volunteer> = emptyList(),
    val isLoadingVolunteers: Boolean = false,
    val volunteersError: String? = null,
    val volunteerSearchQuery: String = "",

    // Ban list
    val bans: List<BanEntry> = emptyList(),
    val isLoadingBans: Boolean = false,
    val bansError: String? = null,
    val showAddBanDialog: Boolean = false,

    // Audit log
    val auditEntries: List<AuditEntry> = emptyList(),
    val isLoadingAudit: Boolean = false,
    val auditError: String? = null,
    val auditPage: Int = 1,
    val auditTotal: Int = 0,
    val hasMoreAuditPages: Boolean = false,

    // Invites
    val invites: List<Invite> = emptyList(),
    val isLoadingInvites: Boolean = false,
    val invitesError: String? = null,
    val showCreateInviteDialog: Boolean = false,
    val createdInviteCode: String? = null,
)

/**
 * ViewModel for the Admin panel.
 *
 * Provides CRUD operations for volunteers, ban lists, audit logs, and invites.
 * Only accessible to users with admin role. Data is fetched on tab selection
 * to avoid unnecessary API calls.
 */
@HiltViewModel
class AdminViewModel @Inject constructor(
    private val apiService: ApiService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AdminUiState())
    val uiState: StateFlow<AdminUiState> = _uiState.asStateFlow()

    init {
        loadVolunteers()
    }

    /**
     * Switch to a different admin tab and load its data.
     */
    fun selectTab(tab: AdminTab) {
        _uiState.update { it.copy(selectedTab = tab) }
        when (tab) {
            AdminTab.VOLUNTEERS -> loadVolunteers()
            AdminTab.BANS -> loadBans()
            AdminTab.AUDIT -> loadAuditLog(page = 1)
            AdminTab.INVITES -> loadInvites()
        }
    }

    // ---- Volunteers ----

    fun loadVolunteers() {
        viewModelScope.launch {
            _uiState.update {
                it.copy(isLoadingVolunteers = true, volunteersError = null)
            }

            try {
                val response = apiService.request<VolunteersListResponse>(
                    "GET",
                    "/api/admin/volunteers",
                )
                _uiState.update {
                    it.copy(
                        volunteers = response.volunteers,
                        isLoadingVolunteers = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoadingVolunteers = false,
                        volunteersError = e.message ?: "Failed to load volunteers",
                    )
                }
            }
        }
    }

    fun setVolunteerSearchQuery(query: String) {
        _uiState.update { it.copy(volunteerSearchQuery = query) }
    }

    /**
     * Filter volunteers by search query (matches display name or pubkey prefix).
     */
    fun filteredVolunteers(): List<Volunteer> {
        val query = _uiState.value.volunteerSearchQuery.lowercase()
        if (query.isBlank()) return _uiState.value.volunteers

        return _uiState.value.volunteers.filter { volunteer ->
            (volunteer.displayName?.lowercase()?.contains(query) == true) ||
                    volunteer.pubkey.lowercase().contains(query)
        }
    }

    // ---- Ban List ----

    fun loadBans() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingBans = true, bansError = null) }

            try {
                val response = apiService.request<BanListResponse>(
                    "GET",
                    "/api/admin/bans",
                )
                _uiState.update {
                    it.copy(
                        bans = response.bans,
                        isLoadingBans = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoadingBans = false,
                        bansError = e.message ?: "Failed to load ban list",
                    )
                }
            }
        }
    }

    fun showAddBanDialog() {
        _uiState.update { it.copy(showAddBanDialog = true) }
    }

    fun dismissAddBanDialog() {
        _uiState.update { it.copy(showAddBanDialog = false) }
    }

    fun addBan(identifier: String, reason: String?) {
        viewModelScope.launch {
            _uiState.update { it.copy(showAddBanDialog = false, bansError = null) }

            try {
                val request = AddBanRequest(
                    identifier = identifier,
                    reason = reason?.takeIf { it.isNotBlank() },
                )
                apiService.requestNoContent("POST", "/api/admin/bans", request)
                loadBans()
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(bansError = e.message ?: "Failed to add ban")
                }
            }
        }
    }

    fun removeBan(banId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(bansError = null) }

            try {
                apiService.requestNoContent("DELETE", "/api/admin/bans/$banId")
                loadBans()
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(bansError = e.message ?: "Failed to remove ban")
                }
            }
        }
    }

    // ---- Audit Log ----

    fun loadAuditLog(page: Int = 1) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingAudit = true, auditError = null) }

            try {
                val response = apiService.request<AuditLogResponse>(
                    "GET",
                    "/api/admin/audit?page=$page&limit=50",
                )

                _uiState.update {
                    val allEntries = if (page == 1) {
                        response.entries
                    } else {
                        it.auditEntries + response.entries
                    }
                    it.copy(
                        auditEntries = allEntries,
                        isLoadingAudit = false,
                        auditPage = page,
                        auditTotal = response.total,
                        hasMoreAuditPages = allEntries.size < response.total,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoadingAudit = false,
                        auditError = e.message ?: "Failed to load audit log",
                    )
                }
            }
        }
    }

    fun loadNextAuditPage() {
        val state = _uiState.value
        if (!state.hasMoreAuditPages || state.isLoadingAudit) return
        loadAuditLog(page = state.auditPage + 1)
    }

    // ---- Invites ----

    fun loadInvites() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingInvites = true, invitesError = null) }

            try {
                val response = apiService.request<InvitesListResponse>(
                    "GET",
                    "/api/admin/invites",
                )
                _uiState.update {
                    it.copy(
                        invites = response.invites,
                        isLoadingInvites = false,
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoadingInvites = false,
                        invitesError = e.message ?: "Failed to load invites",
                    )
                }
            }
        }
    }

    fun showCreateInviteDialog() {
        _uiState.update { it.copy(showCreateInviteDialog = true, createdInviteCode = null) }
    }

    fun dismissCreateInviteDialog() {
        _uiState.update { it.copy(showCreateInviteDialog = false, createdInviteCode = null) }
    }

    fun createInvite(role: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(invitesError = null) }

            try {
                val request = CreateInviteRequest(role = role)
                val invite = apiService.request<Invite>(
                    "POST",
                    "/api/admin/invites",
                    request,
                )
                _uiState.update {
                    it.copy(createdInviteCode = invite.code)
                }
                loadInvites()
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        invitesError = e.message ?: "Failed to create invite",
                    )
                }
            }
        }
    }

    fun clearCreatedInviteCode() {
        _uiState.update { it.copy(createdInviteCode = null) }
    }
}
