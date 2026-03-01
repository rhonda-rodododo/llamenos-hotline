package org.llamenos.hotline.model

/**
 * Typed application events parsed from Nostr relay messages.
 *
 * Raw Nostr events arrive as encrypted blobs via [WebSocketService].
 * After hub-key decryption, the plaintext JSON is parsed into one of
 * these sealed subtypes based on the "type" field.
 *
 * The [Unknown] variant captures event types this client version does
 * not yet handle, ensuring forward compatibility with server updates.
 */
sealed class LlamenosEvent {

    /** A new call is ringing -- all on-shift volunteers receive this. */
    data class CallRing(val callId: String) : LlamenosEvent()

    /** A call has ended (answered by another volunteer or caller hung up). */
    data class CallEnded(val callId: String) : LlamenosEvent()

    /** A shift's status has changed (assignment, clock in/out by another volunteer). */
    data class ShiftUpdate(val shiftId: String, val status: String) : LlamenosEvent()

    /** A new note was created (by the current user or an admin). */
    data class NoteCreated(val noteId: String) : LlamenosEvent()

    /** A new message arrived in a conversation. */
    data class MessageReceived(
        val conversationId: String,
        val messageId: String,
    ) : LlamenosEvent()

    /** A conversation's status changed (assigned, closed, etc.). */
    data class ConversationUpdate(
        val conversationId: String,
        val status: String,
    ) : LlamenosEvent()

    /** An event type this client version does not recognize. */
    data class Unknown(val type: String) : LlamenosEvent()
}
