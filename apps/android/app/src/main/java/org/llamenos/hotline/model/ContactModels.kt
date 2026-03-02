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
