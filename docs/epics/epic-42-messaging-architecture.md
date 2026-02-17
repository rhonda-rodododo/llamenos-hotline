# Epic 42: Messaging Architecture & Threaded Conversations

## Problem

Llamenos currently supports voice calls only. Many crisis contacts prefer text-based communication (easier to express feelings, more private from nearby people, accessible when calling isn't safe). Adding SMS, WhatsApp, and Signal requires a unified messaging layer that doesn't exist. The current data model is call-centric (`CallRecord`, `EncryptedNote` with `callId`). There's no concept of a text conversation, message threading, or multi-channel routing.

## Solution

Build a foundational messaging architecture parallel to the existing telephony system: a `MessagingAdapter` interface, a new `ConversationDO` Durable Object for message state, a conversation/thread data model, and WebSocket events for real-time message delivery. This epic provides the infrastructure; epics 43-45 implement specific channel adapters.

## Threat Model Considerations

- **Transport encryption varies by channel.** SMS has none (carrier-visible). WhatsApp Cloud API decrypts at Meta. Signal bridge decrypts at the self-hosted bridge server. Each channel's honest limitations must be documented and surfaced to admins in the UI.
- **At-rest encryption is consistent.** Regardless of channel, all stored message content is encrypted client-side using the existing ECIES dual-encryption scheme (volunteer copy + admin copy) before reaching the server. The server stores only ciphertext.
- **Metadata exposure differs.** SMS exposes phone numbers to carriers. WhatsApp exposes phone numbers + metadata to Meta. Signal exposes minimal metadata but requires a bridge server. The system must log which channel was used (for audit) but minimize stored metadata.
- **Channel security labels.** Each channel must display its transport security level in the UI so volunteers understand the trust boundary.

## MessagingAdapter Interface

New file: `src/worker/messaging/adapter.ts`

```typescript
interface MessagingAdapter {
  // Channel identity
  readonly channelType: MessagingChannelType

  // Inbound
  parseIncomingMessage(request: Request): Promise<IncomingMessage>
  validateWebhook(request: Request): Promise<boolean>

  // Outbound
  sendMessage(params: SendMessageParams): Promise<SendResult>
  sendMediaMessage(params: SendMediaParams): Promise<SendResult>

  // Channel management
  getChannelStatus(): Promise<ChannelStatus>
}

type MessagingChannelType = 'sms' | 'whatsapp' | 'signal'

interface IncomingMessage {
  channelType: MessagingChannelType
  externalId: string          // provider's message ID
  senderIdentifier: string    // phone number, WhatsApp ID, Signal UUID
  senderIdentifierHash: string // hashed for storage
  body?: string               // text content (plaintext from transport)
  mediaUrls?: string[]        // attachments
  mediaTypes?: string[]       // MIME types
  timestamp: string
  metadata?: Record<string, string>
}

interface SendMessageParams {
  recipientIdentifier: string
  body: string
  conversationId: string
}

interface SendMediaParams extends SendMessageParams {
  mediaUrl: string
  mediaType: string
}
```

**Design decisions:**
- `MessagingAdapter` is deliberately simpler than `TelephonyAdapter` (no IVR, queues, DTMF)
- `senderIdentifier` is hashed before storage (like `callerNumber` hashing in `CallRouterDO`)
- Media attachments are URLs that the adapter provides; the server downloads, encrypts, and stores them in R2 (see epic 46)

## ConversationDO

New Durable Object: `ConversationDO` (singleton, `idFromName('global-conversations')`)

**State stored:**
- `conversations: Conversation[]` — all conversation records
- `messages:{conversationId}: EncryptedMessage[]` — messages per conversation

```typescript
interface Conversation {
  id: string
  channelType: MessagingChannelType
  contactIdentifierHash: string  // hashed phone/ID
  contactLast4?: string          // last 4 digits (admin-only, like callerLast4)
  assignedTo?: string            // volunteer pubkey
  status: 'active' | 'waiting' | 'closed'
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  metadata?: {
    linkedCallId?: string        // if conversation started from a call
    reportId?: string            // if conversation is a report thread (epic 46)
  }
}

interface EncryptedMessage {
  id: string
  conversationId: string
  direction: 'inbound' | 'outbound'
  authorPubkey: string           // volunteer pubkey or 'system:inbound'
  encryptedContent: string       // ECIES-encrypted message text
  ephemeralPubkey: string        // for ECIES decryption
  encryptedContentAdmin: string  // admin copy
  ephemeralPubkeyAdmin: string
  hasAttachments: boolean
  attachmentIds?: string[]       // references to R2 encrypted blobs
  createdAt: string
  externalId?: string            // provider's message ID
}
```

**Key behaviors:**
- Route new inbound messages to on-shift volunteers (reuses `ShiftManagerDO.getCurrentVolunteers()`)
- Assignment: first available volunteer claims the conversation (similar to call answering)
- Conversation timeout: auto-close after configurable inactivity period
- Message pagination for long conversations

**API routes** (new subrouter: `/api/conversations/*`):
- `GET /conversations` — list active/waiting conversations (role-filtered)
- `GET /conversations/:id` — get conversation details
- `GET /conversations/:id/messages` — paginated messages
- `POST /conversations/:id/messages` — send outbound message (encrypts, stores, sends via adapter)
- `PATCH /conversations/:id` — assign, close, reopen
- `POST /conversations/:id/claim` — volunteer claims a waiting conversation

## WebSocket Events

New events broadcast via `CallRouterDO` (extend existing WS hub):

```
conversation:new        — new inbound conversation waiting for assignment
conversation:assigned   — conversation claimed by a volunteer
conversation:closed     — conversation ended
message:new             — new message in a conversation (inbound or outbound)
conversations:sync      — full state on WS connect (like calls:sync)
```

Volunteers see only their assigned conversations + waiting queue. Admins see all.

## Webhook Routing

New route tree: `/api/messaging/:channel/webhook`
- `/api/messaging/sms/webhook` — SMS provider webhooks
- `/api/messaging/whatsapp/webhook` — WhatsApp webhooks
- `/api/messaging/signal/webhook` — Signal bridge webhooks

No auth middleware on webhook routes (like telephony). Each adapter validates its own webhook signature.

## Messaging Configuration

Extend `SettingsDO` with:

```typescript
interface MessagingConfig {
  enabledChannels: MessagingChannelType[]
  sms: SMSConfig | null
  whatsapp: WhatsAppConfig | null
  signal: SignalConfig | null
  autoAssign: boolean              // auto-assign to on-shift volunteers
  inactivityTimeout: number        // minutes before auto-close
  maxConcurrentPerVolunteer: number // conversation limit per volunteer
}
```

Admin Settings UI gets a new "Messaging Channels" section with per-channel enable/disable toggles and configuration.

## Client Components

- `ConversationList` — sidebar list of active/waiting conversations (volunteer + admin views)
- `ConversationThread` — message thread view with encrypted message display
- `MessageComposer` — text input + attachment button + send
- `ChannelBadge` — visual indicator of channel type + transport security level
- `ConversationAssignment` — claim/reassign UI

## Inbound Message Encryption Flow

When an inbound message arrives via webhook:
1. Adapter parses and validates the webhook
2. Server retrieves the assigned volunteer's pubkey (or all on-shift pubkeys if unassigned)
3. Server encrypts message content using ECIES (`encryptForPublicKey`) — one copy for assigned volunteer, one for admin
4. Encrypted message stored in `ConversationDO`
5. Plaintext discarded from server memory
6. WebSocket broadcast notifies connected clients

**Note:** The transport-to-server leg is the vulnerability. SMS content is visible to carriers + Twilio. WhatsApp content is visible to Meta. Signal content is visible at the bridge. Once content reaches our server, it's immediately encrypted and the plaintext is discarded. This is the same model as voice call transcriptions.

## Files

- **Create:** `src/worker/messaging/adapter.ts` — MessagingAdapter interface + types
- **Create:** `src/worker/messaging/router.ts` — messaging webhook route handler
- **Create:** `src/worker/durable-objects/conversation-do.ts` — ConversationDO
- **Create:** `src/worker/routes/conversations.ts` — conversations API routes
- **Create:** `src/client/routes/conversations.tsx` — conversations page
- **Create:** `src/client/components/ConversationList.tsx`
- **Create:** `src/client/components/ConversationThread.tsx`
- **Create:** `src/client/components/MessageComposer.tsx`
- **Create:** `src/client/components/ChannelBadge.tsx`
- **Create:** `src/shared/messaging-types.ts` — shared messaging types
- **Modify:** `src/worker/durable-objects/call-router.ts` — add conversation WS events
- **Modify:** `src/worker/durable-objects/settings-do.ts` — add MessagingConfig
- **Modify:** `src/worker/app.ts` — mount messaging routes
- **Modify:** `src/worker/types.ts` — add Conversation, EncryptedMessage types
- **Modify:** `src/shared/types.ts` — add MessagingChannelType, MessagingConfig
- **Modify:** `wrangler.jsonc` — add ConversationDO binding
- **Modify:** `src/client/lib/ws.ts` — add conversation event handlers
- **Modify:** `src/client/routes/__root.tsx` — add conversations nav item

## Dependencies

- None (foundation epic)

## Blocked By

- Nothing

## Blocks

- Epic 43 (SMS), Epic 44 (WhatsApp), Epic 45 (Signal), Epic 46 (Reporter Role)
