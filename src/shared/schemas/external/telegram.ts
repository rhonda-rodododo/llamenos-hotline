import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Telegram Bot API Webhook Schemas
//
// Telegram sends JSON-encoded Update objects to the webhook URL.
// Only the fields relevant to messaging are modeled here; Telegram's
// Update type has many optional fields for inline queries, polls, etc.
// that are irrelevant for the crisis hotline use case.
//
// Reference: https://core.telegram.org/bots/api#update
// ---------------------------------------------------------------------------

/**
 * Telegram User object.
 * Represents a Telegram user or bot.
 */
export const TelegramUserSchema = z.object({
  /** Unique identifier for this user or bot */
  id: z.number().int(),
  /** True if this user is a bot */
  is_bot: z.boolean(),
  /** User's or bot's first name */
  first_name: z.string(),
  /** User's or bot's last name */
  last_name: z.string().optional(),
  /** User's or bot's username */
  username: z.string().optional(),
  /** IETF language tag of the user's language */
  language_code: z.string().optional(),
})
export type TelegramUser = z.infer<typeof TelegramUserSchema>

/**
 * Telegram Chat object.
 * Represents a chat (private, group, supergroup, or channel).
 */
export const TelegramChatSchema = z.object({
  /** Unique identifier for this chat */
  id: z.number().int(),
  /** Type of chat: "private", "group", "supergroup", or "channel" */
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
  /** Title for groups, supergroups, and channels */
  title: z.string().optional(),
  /** Username for private chats, supergroups, and channels */
  username: z.string().optional(),
  /** First name of the other party in a private chat */
  first_name: z.string().optional(),
  /** Last name of the other party in a private chat */
  last_name: z.string().optional(),
})
export type TelegramChat = z.infer<typeof TelegramChatSchema>

/**
 * Telegram Voice message object.
 * Represents a voice message (OGG encoded with OPUS codec).
 */
export const TelegramVoiceSchema = z.object({
  /** Identifier for this file, used to download or reuse */
  file_id: z.string(),
  /** Unique identifier for this file (consistent over time and across bots) */
  file_unique_id: z.string(),
  /** Duration of the audio in seconds */
  duration: z.number().int(),
  /** MIME type of the file */
  mime_type: z.string().optional(),
  /** File size in bytes */
  file_size: z.number().int().optional(),
})
export type TelegramVoice = z.infer<typeof TelegramVoiceSchema>

/**
 * Telegram PhotoSize object.
 * Represents one size of a photo or a file/sticker thumbnail.
 */
export const TelegramPhotoSizeSchema = z.object({
  /** Identifier for this file */
  file_id: z.string(),
  /** Unique identifier for this file */
  file_unique_id: z.string(),
  /** Photo width */
  width: z.number().int(),
  /** Photo height */
  height: z.number().int(),
  /** File size in bytes */
  file_size: z.number().int().optional(),
})
export type TelegramPhotoSize = z.infer<typeof TelegramPhotoSizeSchema>

/**
 * Telegram Document object.
 * Represents a general file (as opposed to photos, voice messages, etc.).
 */
export const TelegramDocumentSchema = z.object({
  /** Identifier for this file */
  file_id: z.string(),
  /** Unique identifier for this file */
  file_unique_id: z.string(),
  /** Original filename */
  file_name: z.string().optional(),
  /** MIME type of the file */
  mime_type: z.string().optional(),
  /** File size in bytes */
  file_size: z.number().int().optional(),
})
export type TelegramDocument = z.infer<typeof TelegramDocumentSchema>

/**
 * Telegram Message object (subset relevant to crisis messaging).
 * Full spec has 50+ optional fields; we model only what the adapter needs.
 */
export const TelegramMessageSchema = z.object({
  /** Unique message identifier inside this chat */
  message_id: z.number().int(),
  /** Sender of the message (empty for messages sent to channels) */
  from: TelegramUserSchema.optional(),
  /** Chat the message belongs to */
  chat: TelegramChatSchema,
  /** Date the message was sent (Unix timestamp) */
  date: z.number().int(),
  /** Text of the message (0-4096 characters) */
  text: z.string().optional(),
  /** Caption for media messages (0-1024 characters) */
  caption: z.string().optional(),
  /** Voice message, if the message is a voice message */
  voice: TelegramVoiceSchema.optional(),
  /** Photos — array of PhotoSize (different sizes of the same photo) */
  photo: z.array(TelegramPhotoSizeSchema).optional(),
  /** Document (general file) */
  document: TelegramDocumentSchema.optional(),
})
export type TelegramMessage = z.infer<typeof TelegramMessageSchema>

/**
 * Telegram File object returned by getFile API.
 * Used to construct the download URL for voice messages, photos, documents.
 */
export const TelegramFileSchema = z.object({
  /** Identifier for this file */
  file_id: z.string(),
  /** Unique identifier for this file */
  file_unique_id: z.string(),
  /** File size in bytes */
  file_size: z.number().int().optional(),
  /** File path — use https://api.telegram.org/file/bot<token>/<file_path> to download */
  file_path: z.string().optional(),
})
export type TelegramFile = z.infer<typeof TelegramFileSchema>

/**
 * Telegram Update object (webhook payload).
 * Each webhook POST contains exactly one Update with one of the optional fields set.
 * For crisis messaging, we care about `message` (and potentially `edited_message`).
 */
export const TelegramUpdateSchema = z.object({
  /** The update's unique identifier */
  update_id: z.number().int(),
  /** New incoming message of any kind (text, photo, voice, document, etc.) */
  message: TelegramMessageSchema.optional(),
  /** Edited version of a known message */
  edited_message: TelegramMessageSchema.optional(),
})
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>

/**
 * Telegram Bot API response wrapper.
 * All Bot API methods return a JSON object with ok + result.
 */
export const TelegramApiResponseSchema = <T extends z.ZodType>(resultSchema: T) =>
  z.object({
    ok: z.boolean(),
    description: z.string().optional(),
    result: resultSchema.optional(),
    error_code: z.number().int().optional(),
  })

/** Response from getMe */
export const TelegramGetMeResponseSchema = TelegramApiResponseSchema(TelegramUserSchema)
export type TelegramGetMeResponse = z.infer<typeof TelegramGetMeResponseSchema>

/** Response from getFile */
export const TelegramGetFileResponseSchema = TelegramApiResponseSchema(TelegramFileSchema)
export type TelegramGetFileResponse = z.infer<typeof TelegramGetFileResponseSchema>

/** Response from sendMessage */
export const TelegramSendMessageResponseSchema = TelegramApiResponseSchema(TelegramMessageSchema)
export type TelegramSendMessageResponse = z.infer<typeof TelegramSendMessageResponseSchema>
