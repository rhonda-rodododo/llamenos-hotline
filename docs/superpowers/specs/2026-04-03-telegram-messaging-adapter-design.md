# Design: Telegram Messaging Adapter

**Date:** 2026-04-03
**Status:** Draft

## Overview

Add Telegram as a messaging channel using the Telegram Bot API. This enables crisis hotlines to receive and respond to messages from Telegram users — the most popular messaging app in Eastern Europe, Central Asia, Middle East, and parts of Latin America.

## Why Telegram?

- **2 billion+ active users** globally
- **Primary messaging app** in many countries where crisis hotlines are needed
- **Bot API is simple** — REST-based, no bridge container needed (unlike Signal)
- **Voice messages** supported (OGG Opus) — integrates with existing Whisper transcription
- **End-to-end encryption available** via Secret Chats (though Bot API uses server-encrypted by default)
- **No phone number required** for users — username-based, important for anonymous crisis contact

## Architecture

```
Telegram User → Telegram Cloud → Webhook POST → Llamenos Server → ConversationService
                                                                 ↓
Llamenos Server → Telegram Bot API (sendMessage) → Telegram Cloud → User
```

Unlike Signal (which needs a signal-cli bridge container), Telegram uses a cloud API:
- **Inbound:** Telegram POSTs webhook updates to our server
- **Outbound:** We call `https://api.telegram.org/bot{token}/sendMessage`
- **No bridge container needed** — direct HTTPS to Telegram's servers

## Bot Setup

1. Operator creates a Telegram Bot via @BotFather
2. Gets a bot token (e.g., `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
3. Enters token in Llamenos admin setup wizard
4. Server calls `setWebhook` to register the callback URL
5. Optionally sets bot description, about text, and commands menu

## MessagingAdapter Implementation

```typescript
class TelegramAdapter implements MessagingAdapter {
  readonly channelType: MessagingChannelType = 'telegram'
  
  constructor(
    private botToken: string,
    private crypto: CryptoService,
    private webhookSecret?: string  // for webhook verification
  )
}
```

### Methods

| Method | Implementation |
|--------|---------------|
| `parseIncomingMessage` | Parse Update JSON → extract `message.text`, `message.from.id`, attachments |
| `validateWebhook` | Check `X-Telegram-Bot-Api-Secret-Token` header matches configured secret |
| `sendMessage` | POST to `api.telegram.org/bot{token}/sendMessage` |
| `sendMediaMessage` | POST to `api.telegram.org/bot{token}/sendPhoto` (or sendDocument, sendVoice) |
| `getChannelStatus` | Call `getMe` to verify bot token is valid |
| `parseStatusWebhook` | N/A — Telegram doesn't have delivery receipts via Bot API |

### Webhook Payload (Telegram Update)

```json
{
  "update_id": 123456789,
  "message": {
    "message_id": 100,
    "from": {
      "id": 987654321,
      "is_bot": false,
      "first_name": "Anonymous",
      "username": "user123"
    },
    "chat": {
      "id": 987654321,
      "type": "private"
    },
    "date": 1712108400,
    "text": "I need help"
  }
}
```

### Voice Messages

Telegram sends voice messages as OGG Opus files:
```json
{
  "message": {
    "voice": {
      "file_id": "AwACAgIAAxkB...",
      "duration": 5,
      "mime_type": "audio/ogg",
      "file_size": 12345
    }
  }
}
```

The adapter downloads the file via `getFile` API and passes it to the existing Whisper transcription pipeline (same as Signal voice messages).

### Contact Identity

- **Identifier:** Telegram user ID (numeric, stable)
- **Display:** Username or first_name (for admin view)
- **Hash:** HMAC of user ID (for privacy — same pattern as phone hashing)
- **No phone number needed** — users can contact the bot without revealing their phone

This is a privacy advantage over SMS/WhatsApp — callers don't expose their phone number.

## Webhook Security

Telegram supports a `secret_token` parameter in `setWebhook`. When set, all webhook requests include `X-Telegram-Bot-Api-Secret-Token` header with the token value. This is simpler than HMAC signature verification but equally effective.

```typescript
async validateWebhook(request: Request): Promise<boolean> {
  const token = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
  return token === this.webhookSecret
}
```

## Configuration Schema

```typescript
const TelegramConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string().min(1),
  webhookSecret: z.string().optional(), // auto-generated during setup
  botUsername: z.string().optional(),    // filled after getMe
  autoResponse: z.string().optional(),  // auto-reply for /start command
  afterHoursResponse: z.string().optional(),
})
```

## Setup Flow

1. Admin enters bot token in setup wizard
2. Server calls `getMe` to validate token and get bot info
3. Server generates random `webhookSecret`
4. Server calls `setWebhook` with callback URL + secret
5. Server calls `setMyCommands` to register `/start` and `/help` commands
6. Server saves config, enables Telegram channel

## Privacy Considerations for Crisis Hotlines

- **Default privacy mode:** Bot only receives messages sent directly to it (not group messages)
- **No phone number exposure:** Users contact via username, not phone
- **Message retention:** Server-encrypted by Telegram (not E2E like Signal Secret Chats)
- **Bot API limitation:** Bot cannot initiate Secret Chats (E2E encryption)
- **Metadata:** Telegram knows the user is messaging this bot — consider operational security implications
- **Bot token security:** Must be encrypted at rest (using existing credential encryption)

## Files

| File | Action | Description |
|------|--------|-------------|
| `src/shared/schemas/common.ts` | Modify | Add 'telegram' to MessagingChannelType |
| `src/shared/schemas/providers.ts` | Modify | Add TelegramConfigSchema |
| `src/shared/schemas/external/telegram.ts` | Create | Zod schemas for webhook Update payloads |
| `src/server/messaging/telegram/adapter.ts` | Create | TelegramAdapter class |
| `src/server/messaging/telegram/client.ts` | Create | Telegram Bot API client |
| `src/server/messaging/capabilities.ts` | Modify | Add Telegram channel capability |
| `src/server/messaging/router.ts` | Modify | Route /messaging/telegram/webhook |
| `src/client/components/setup/TelegramSetup.tsx` | Create | Setup wizard UI for bot token |

## Testing

- Unit tests: webhook parsing, message sending, voice message handling
- Integration: Mock Telegram API, test full message flow
- E2E: Create test bot, send/receive messages (requires Telegram account)
