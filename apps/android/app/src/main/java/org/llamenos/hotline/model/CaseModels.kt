package org.llamenos.hotline.model

import kotlinx.serialization.Serializable
import org.llamenos.protocol.AssignBody
import org.llamenos.protocol.CaseInteraction
import org.llamenos.protocol.CreateInteractionBody
import org.llamenos.protocol.CreateRecordBody
import org.llamenos.protocol.EntityTypeDefinition
import org.llamenos.protocol.Evidence
import org.llamenos.protocol.EvidenceListResponse
import org.llamenos.protocol.Interaction
import org.llamenos.protocol.InteractionListResponse
import org.llamenos.protocol.Record
import org.llamenos.protocol.RecordContact
import org.llamenos.protocol.UpdateRecordBody

// ---- Type aliases for codegen types with different names ----

/** Alias: codegen [Record] corresponds to the old hand-written CaseRecord. */
typealias CaseRecord = Record

/** Alias: codegen [Evidence] corresponds to the old hand-written EvidenceItem. */
typealias EvidenceItem = Evidence

/** Alias: codegen [AssignBody] corresponds to the old hand-written AssignRecordRequest. */
typealias AssignRecordRequest = AssignBody

/** Alias: codegen [CreateRecordBody] corresponds to the old hand-written CreateRecordRequest. */
typealias CreateRecordRequest = CreateRecordBody

/** Alias: codegen [UpdateRecordBody] corresponds to the old hand-written UpdateRecordRequest. */
typealias UpdateRecordRequest = UpdateRecordBody

/** Alias: codegen [CreateInteractionBody] corresponds to the old hand-written CreateInteractionRequest. */
typealias CreateInteractionRequest = CreateInteractionBody

// ---- Re-exports of codegen types that share the same name ----
// These are re-exported so existing `import org.llamenos.hotline.model.X` imports continue to work.
// NOTE: Kotlin does not allow re-exporting via typealias when the alias name == original name
// in a different package. So consumers should import directly from org.llamenos.protocol instead.

// ---- API Response Wrappers ----
// These wrap codegen types for API response deserialization.
// The codegen does not generate paginated list wrappers for all endpoints.

/**
 * Paginated records list response from GET /api/records.
 */
@Serializable
data class RecordsListResponse(
    val records: List<Record>,
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 20,
    val hasMore: Boolean = false,
)

/**
 * Entity types list response from GET /api/settings/cms/entity-types.
 */
@Serializable
data class EntityTypesResponse(
    val entityTypes: List<EntityTypeDefinition>,
)

/**
 * Interactions list response from GET /api/records/:id/interactions.
 * Uses the codegen [Interaction] type (the list response variant).
 */
@Serializable
data class InteractionsResponse(
    val interactions: List<Interaction>,
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 20,
    val hasMore: Boolean = false,
)

/**
 * Contacts linked to a record from GET /api/records/:id/contacts.
 */
@Serializable
data class RecordContactsResponse(
    val contacts: List<RecordContact>,
)

/**
 * Response from POST /api/records/:id/assign and POST /api/records/:id/unassign.
 */
@Serializable
data class AssignResponse(
    val assignedTo: List<String>,
)
