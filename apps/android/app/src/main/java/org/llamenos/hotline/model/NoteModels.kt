package org.llamenos.hotline.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Decrypted note payload — the plaintext content inside an encrypted note.
 *
 * The [text] field is the main note body. [fields] holds optional custom field
 * values keyed by field definition name.
 */
@Serializable
data class NotePayload(
    val text: String,
    val fields: Map<String, JsonElement>? = null,
)

/**
 * Wire format for a note as returned by the API.
 *
 * The [encryptedContent] is XChaCha20-Poly1305 ciphertext (base64).
 * Each [RecipientEnvelope] in [recipientEnvelopes] wraps the per-note
 * symmetric key via ECIES for one authorized reader.
 */
@Serializable
data class NoteResponse(
    val id: String,
    val encryptedContent: String,
    val authorPubkey: String,
    val recipientEnvelopes: List<RecipientEnvelope>,
    val callId: String? = null,
    val conversationId: String? = null,
    val replyCount: Int = 0,
    val createdAt: String,
    val updatedAt: String? = null,
)

/**
 * ECIES envelope wrapping a per-note symmetric key for a single recipient.
 *
 * To decrypt: ECDH(recipient_nsec, [ephemeralPubkey]) -> derive AES key -> unwrap [wrappedKey].
 * The unwrapped key is the XChaCha20-Poly1305 key for the note ciphertext.
 */
@Serializable
data class RecipientEnvelope(
    val pubkey: String,
    val wrappedKey: String,
    val ephemeralPubkey: String,
)

/**
 * Paginated notes list response from GET /api/notes.
 */
@Serializable
data class NotesListResponse(
    val notes: List<NoteResponse>,
    val total: Int,
    val page: Int,
)

/**
 * Request body for creating a new note via POST /api/notes.
 */
@Serializable
data class CreateNoteRequest(
    val encryptedContent: String,
    val recipientEnvelopes: List<CreateNoteEnvelope>,
    val callId: String? = null,
    val conversationId: String? = null,
)

/**
 * Response from GET /api/notes/:id/replies.
 */
@Serializable
data class NoteRepliesResponse(
    val replies: List<NoteReply>,
)

/**
 * A reply in a note thread.
 */
@Serializable
data class NoteReply(
    val id: String,
    val noteId: String,
    val authorPubkey: String,
    val encryptedContent: String,
    val recipientEnvelopes: List<RecipientEnvelope>,
    val createdAt: String,
)

/**
 * Request body for creating a note reply via POST /api/notes/:id/replies.
 */
@Serializable
data class CreateNoteReplyRequest(
    val encryptedContent: String,
    val readerEnvelopes: List<CreateNoteEnvelope>,
)

/**
 * Envelope structure for the create-note request body.
 */
@Serializable
data class CreateNoteEnvelope(
    val pubkey: String,
    val wrappedKey: String,
    val ephemeralPubkey: String,
)
