package org.llamenos.hotline.model

import kotlinx.serialization.Serializable

/**
 * A messaging conversation between a contact and the hotline.
 *
 * Each conversation is scoped to a single channel ([channelType]) and contact.
 * The [contactHash] is a one-way hash of the contact's identifier for privacy.
 * Conversations can be assigned to a specific volunteer or remain unassigned
 * in a pool visible to all on-shift volunteers.
 */
@Serializable
data class Conversation(
    val id: String,
    val channelType: String,
    val contactHash: String,
    val assignedVolunteerPubkey: String? = null,
    val status: String,
    val lastMessageAt: String? = null,
    val unreadCount: Int = 0,
    val createdAt: String,
)

/**
 * An encrypted message within a conversation.
 *
 * Message content is E2EE: a random symmetric key encrypts the plaintext,
 * then the key is ECIES-wrapped in [recipientEnvelopes] for each authorized
 * reader (assigned volunteer + admins).
 */
@Serializable
data class ConversationMessage(
    val id: String,
    val conversationId: String,
    val direction: String,
    val encryptedContent: String,
    val recipientEnvelopes: List<RecipientEnvelope>,
    val channelType: String,
    val createdAt: String,
    val readAt: String? = null,
)

/**
 * Paginated response from GET /api/conversations.
 */
@Serializable
data class ConversationsListResponse(
    val conversations: List<Conversation>,
    val total: Int,
)

/**
 * Paginated response from GET /api/conversations/:id/messages.
 */
@Serializable
data class MessagesListResponse(
    val messages: List<ConversationMessage>,
    val total: Int,
)

/**
 * Request body for sending an encrypted reply via POST /api/conversations/:id/messages.
 */
@Serializable
data class SendMessageRequest(
    val encryptedContent: String,
    val recipientEnvelopes: List<CreateMessageEnvelope>,
    val channelType: String,
)

/**
 * Envelope structure for the send-message request body.
 */
@Serializable
data class CreateMessageEnvelope(
    val pubkey: String,
    val wrappedKey: String,
    val ephemeralPubkey: String,
)

/**
 * Decrypted message for UI display.
 *
 * This is the client-side representation after ECIES unwrap + XChaCha20-Poly1305
 * decryption. It is never serialized or sent over the wire.
 */
data class DecryptedMessage(
    val id: String,
    val text: String,
    val direction: String,
    val channelType: String,
    val createdAt: String,
    val isRead: Boolean,
)
