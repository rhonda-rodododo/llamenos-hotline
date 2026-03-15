package org.llamenos.hotline.model

import kotlinx.serialization.Serializable

/**
 * A case record — a structured entity stored in CaseDO.
 *
 * Case records use blind indexes (hashed status, severity, field values)
 * for server-side filtering without revealing plaintext values.
 * Sensitive content is E2EE across three tiers:
 *   - Summary: title, status text, severity text (broadest access)
 *   - Fields: custom field values (role-restricted)
 *   - PII: personal identifiers (admin-only)
 */
@Serializable
data class CaseRecord(
    val id: String,
    val hubId: String = "",
    val entityTypeId: String,
    val caseNumber: String? = null,
    val statusHash: String,
    val severityHash: String? = null,
    val categoryHash: String? = null,
    val assignedTo: List<String> = emptyList(),
    val blindIndexes: Map<String, String> = emptyMap(),
    val encryptedSummary: String,
    val summaryEnvelopes: List<RecordEnvelope> = emptyList(),
    val encryptedFields: String? = null,
    val fieldEnvelopes: List<RecordEnvelope>? = null,
    val encryptedPII: String? = null,
    val piiEnvelopes: List<RecordEnvelope>? = null,
    val contactCount: Int = 0,
    val interactionCount: Int = 0,
    val fileCount: Int = 0,
    val reportCount: Int = 0,
    val eventIds: List<String> = emptyList(),
    val reportIds: List<String> = emptyList(),
    val parentRecordId: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val closedAt: String? = null,
    val createdBy: String = "",
)

/**
 * ECIES envelope for a record reader.
 */
@Serializable
data class RecordEnvelope(
    val pubkey: String,
    val wrappedKey: String,
    val ephemeralPubkey: String,
)

/**
 * Entity type definition — template-driven schema for case records.
 *
 * Defines the full structure of a case type: fields, statuses, severities,
 * numbering, access control. Loaded from GET /api/settings/cms/entity-types.
 */
@Serializable
data class EntityTypeDefinition(
    val id: String,
    val hubId: String = "",
    val name: String,
    val label: String,
    val labelPlural: String,
    val description: String = "",
    val icon: String? = null,
    val color: String? = null,
    val category: String = "case",
    val templateId: String? = null,
    val templateVersion: String? = null,
    val fields: List<EntityFieldDefinition> = emptyList(),
    val statuses: List<EnumOption> = emptyList(),
    val defaultStatus: String = "",
    val closedStatuses: List<String> = emptyList(),
    val severities: List<EnumOption>? = null,
    val defaultSeverity: String? = null,
    val categories: List<EnumOption>? = null,
    val contactRoles: List<EnumOption>? = null,
    val numberPrefix: String? = null,
    val numberingEnabled: Boolean = false,
    val defaultAccessLevel: String = "assigned",
    val piiFields: List<String> = emptyList(),
    val allowSubRecords: Boolean = false,
    val allowFileAttachments: Boolean = true,
    val allowInteractionLinks: Boolean = true,
    val showInNavigation: Boolean = true,
    val showInDashboard: Boolean = false,
    val accessRoles: List<String>? = null,
    val editRoles: List<String>? = null,
    val isArchived: Boolean = false,
    val isSystem: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String = "",
)

/**
 * An option for an enum field (status, severity, category, contact role).
 */
@Serializable
data class EnumOption(
    val value: String,
    val label: String,
    val color: String? = null,
    val icon: String? = null,
    val order: Int = 0,
    val isDefault: Boolean? = null,
    val isClosed: Boolean? = null,
    val isDeprecated: Boolean? = null,
)

/**
 * A field definition within an entity type.
 */
@Serializable
data class EntityFieldDefinition(
    val id: String,
    val name: String,
    val label: String,
    val type: String,
    val required: Boolean = false,
    val options: List<EntityFieldOption>? = null,
    val lookupId: String? = null,
    val validation: EntityFieldValidation? = null,
    val section: String? = null,
    val helpText: String? = null,
    val placeholder: String? = null,
    val defaultValue: String? = null,
    val order: Int = 0,
    val indexable: Boolean = false,
    val indexType: String = "none",
    val accessLevel: String = "all",
    val accessRoles: List<String>? = null,
    val visibleToVolunteers: Boolean = true,
    val editableByVolunteers: Boolean = true,
    val templateId: String? = null,
    val hubEditable: Boolean = true,
    val createdAt: String? = null,
)

/**
 * Key-label option for select/multiselect fields.
 */
@Serializable
data class EntityFieldOption(
    val key: String,
    val label: String,
)

/**
 * Validation constraints for a field.
 */
@Serializable
data class EntityFieldValidation(
    val minLength: Int? = null,
    val maxLength: Int? = null,
    val min: Int? = null,
    val max: Int? = null,
    val pattern: String? = null,
)

/**
 * Conditional visibility rule for a field.
 */
@Serializable
data class ShowWhenRule(
    val field: String,
    val operator: String,
    val value: String? = null,
)

/**
 * A case interaction — a timeline entry linked to a case record.
 *
 * Interactions form the case timeline: comments, status changes,
 * linked notes/calls/messages, assessments, referrals, and evidence uploads.
 */
@Serializable
data class CaseInteraction(
    val id: String,
    val caseId: String,
    val interactionType: String,
    val sourceId: String? = null,
    val encryptedContent: String? = null,
    val contentEnvelopes: List<RecordEnvelope>? = null,
    val authorPubkey: String,
    val interactionTypeHash: String = "",
    val createdAt: String,
    val previousStatusHash: String? = null,
    val newStatusHash: String? = null,
)

/**
 * A contact linked to a case record with a role.
 */
@Serializable
data class RecordContact(
    val recordId: String,
    val contactId: String,
    val role: String,
    val addedAt: String,
    val addedBy: String,
)

/**
 * Evidence metadata for a file attached to a case record.
 */
@Serializable
data class EvidenceItem(
    val id: String,
    val caseId: String,
    val fileId: String,
    val filename: String,
    val mimeType: String,
    val sizeBytes: Long = 0,
    val classification: String,
    val integrityHash: String,
    val hashAlgorithm: String = "sha256",
    val source: String? = null,
    val sourceDescription: String? = null,
    val encryptedDescription: String? = null,
    val descriptionEnvelopes: List<RecordEnvelope>? = null,
    val uploadedAt: String,
    val uploadedBy: String = "",
    val custodyEntryCount: Int = 0,
)

// --- API Response Wrappers ---

/**
 * Paginated records list response from GET /api/records.
 */
@Serializable
data class RecordsListResponse(
    val records: List<CaseRecord>,
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
 */
@Serializable
data class InteractionsResponse(
    val interactions: List<CaseInteraction>,
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
 * Evidence list response from GET /api/records/:id/evidence.
 */
@Serializable
data class EvidenceListResponse(
    val evidence: List<EvidenceItem>,
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 20,
    val hasMore: Boolean = false,
)

// --- Request Bodies ---

/**
 * Request body for POST /api/records (create a new record).
 */
@Serializable
data class CreateRecordRequest(
    val entityTypeId: String,
    val statusHash: String,
    val severityHash: String? = null,
    val categoryHash: String? = null,
    val assignedTo: List<String> = emptyList(),
    val blindIndexes: Map<String, String> = emptyMap(),
    val encryptedSummary: String,
    val summaryEnvelopes: List<RecordEnvelope>,
    val encryptedFields: String? = null,
    val fieldEnvelopes: List<RecordEnvelope>? = null,
    val encryptedPII: String? = null,
    val piiEnvelopes: List<RecordEnvelope>? = null,
    val parentRecordId: String? = null,
)

/**
 * Request body for PATCH /api/records/:id (update).
 */
@Serializable
data class UpdateRecordRequest(
    val statusHash: String? = null,
    val severityHash: String? = null,
    val encryptedSummary: String? = null,
    val summaryEnvelopes: List<RecordEnvelope>? = null,
    val closedAt: String? = null,
    val statusChangeTypeHash: String? = null,
    val statusChangeContent: String? = null,
    val statusChangeEnvelopes: List<RecordEnvelope>? = null,
)

/**
 * Request body for POST /api/records/:id/assign.
 */
@Serializable
data class AssignRecordRequest(
    val pubkeys: List<String>,
)

/**
 * Request body for POST /api/records/:id/interactions (create interaction).
 */
@Serializable
data class CreateInteractionRequest(
    val interactionType: String,
    val sourceId: String? = null,
    val encryptedContent: String? = null,
    val contentEnvelopes: List<RecordEnvelope>? = null,
    val interactionTypeHash: String,
    val previousStatusHash: String? = null,
    val newStatusHash: String? = null,
)
