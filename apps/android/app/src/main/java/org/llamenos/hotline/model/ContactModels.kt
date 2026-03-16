package org.llamenos.hotline.model

import kotlinx.serialization.Serializable

/**
 * Summary of interactions with a single contact (identified by phone hash).
 *
 * Contacts are aggregated across calls, conversations, notes, and reports.
 * The [contactHash] is a one-way HMAC hash of the contact's phone number
 * for privacy. Only admins can see the [last4] digits.
 */
@Serializable
data class ContactSummary(
    val contactHash: String,
    val last4: String? = null,
    val firstSeen: String,
    val lastSeen: String,
    val callCount: Int = 0,
    val conversationCount: Int = 0,
    val noteCount: Int = 0,
    val reportCount: Int = 0,
)

/**
 * Paginated contacts list response from GET /contacts.
 */
@Serializable
data class ContactsListResponse(
    val contacts: List<ContactSummary>,
    val total: Int,
)

/**
 * A single timeline event for a contact — represents a call, conversation,
 * note, or report interaction.
 */
@Serializable
data class ContactTimelineEvent(
    val id: String,
    val type: String, // "call", "conversation", "note", "report"
    val timestamp: String,
    val summary: String? = null,
    val status: String? = null,
    val duration: Int? = null,
)

/**
 * Timeline response from GET /contacts/{hash}/timeline.
 */
@Serializable
data class ContactTimelineResponse(
    val events: List<ContactTimelineEvent>,
    val total: Int = 0,
)

/**
 * Full contact profile including linked cases and identifiers.
 */
@Serializable
data class ContactDetail(
    val contactHash: String,
    val last4: String? = null,
    val firstSeen: String,
    val lastSeen: String,
    val callCount: Int = 0,
    val conversationCount: Int = 0,
    val noteCount: Int = 0,
    val reportCount: Int = 0,
    val contactType: String? = null,
    val linkedCases: List<ContactLinkedCase>? = null,
    val identifiers: List<ContactIdentifier>? = null,
)

/**
 * A case linked to a contact.
 */
@Serializable
data class ContactLinkedCase(
    val id: String,
    val caseNumber: String? = null,
    val entityTypeId: String,
    val statusHash: String,
    val role: String? = null,
    val createdAt: String,
)

/**
 * An identifier associated with a contact (phone, email, etc).
 */
@Serializable
data class ContactIdentifier(
    val type: String,
    val hash: String,
    val value: String? = null,
    val addedAt: String? = null,
)

@Serializable
data class ContactDetailResponse(
    val contact: ContactDetail,
)

/**
 * A relationship between two contacts.
 */
@Serializable
data class ContactRelationship(
    val relatedContactHash: String,
    val relatedLast4: String? = null,
    val relationshipType: String,
    val createdAt: String? = null,
)

@Serializable
data class ContactRelationshipsResponse(
    val relationships: List<ContactRelationship>,
)

/**
 * Trigram search response from GET /contacts/search.
 */
@Serializable
data class ContactSearchResponse(
    val contacts: List<ContactSummary>,
    val total: Int = 0,
)
