# Message Delivery Status & Read Receipts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Track and display message delivery status (pending → sent → delivered → read/failed) for outbound SMS/WhatsApp/Signal messages in the conversation thread. Backport from v2 (`~/projects/llamenos`).

**Context:** v1 sends messages but has no delivery status tracking. The ConversationDO sends via MessagingAdapter but never persists the result back to the message record. Volunteers don't know if messages were delivered.

---

## Phase 1: DB Schema

- [x] Add `deliveryStatus` enum to messages table in `src/server/db/schema/conversations.ts`:
  ```typescript
  export const messageDeliveryStatusEnum = pgEnum('message_delivery_status', [
    'pending', 'sent', 'delivered', 'read', 'failed'
  ])
  ```
- [x] Add column to `messages` table:
  ```typescript
  deliveryStatus: messageDeliveryStatusEnum('delivery_status').notNull().default('pending'),
  deliveryStatusUpdatedAt: timestamp('delivery_status_updated_at'),
  providerMessageId: varchar('provider_message_id', { length: 128 }), // SID or equiv
  deliveryError: text('delivery_error'),  // null on success
  ```
- [x] Run `bunx drizzle-kit generate` and verify migration
- [x] Add Zod schema update: `MessageRecord.deliveryStatus`, `MessageRecord.providerMessageId`

---

## Phase 2: Backend — Capture Send Result

### 2.1 MessagingAdapter return type
- [x] Open `src/server/messaging/messaging-adapter.ts`
- [x] Change `sendMessage()` return type from `void` to:
  ```typescript
  Promise<{ providerMessageId: string; status: 'sent' | 'failed'; error?: string }>
  ```
- [x] Update all 3 adapter implementations (SMS, WhatsApp, Signal):
  - `src/server/messaging/adapters/sms-adapter.ts`
  - `src/server/messaging/adapters/whatsapp-adapter.ts`
  - `src/server/messaging/adapters/signal-adapter.ts`
- [x] Each adapter: capture Twilio MessageSid (or equivalent) and initial status from API response

### 2.2 Update message send flow
- [x] In `ConversationService` (or DO equivalent), after `adapter.sendMessage()`:
  ```typescript
  const result = await adapter.sendMessage(...)
  await db.update(messages)
    .set({
      deliveryStatus: result.status,
      deliveryStatusUpdatedAt: new Date(),
      providerMessageId: result.providerMessageId,
      deliveryError: result.error ?? null,
    })
    .where(eq(messages.id, messageId))
  ```

---

## Phase 3: Delivery Status Webhooks

### 3.1 Twilio Status Callback
- [x] In `src/server/routes/telephony.ts` or new `src/server/routes/messaging.ts`:
  - Add `POST /api/messaging/status-callback` route
  - Parse `MessageSid`, `MessageStatus` from Twilio webhook body
  - Map Twilio statuses to our enum:
    - `queued` / `accepted` → `pending`
    - `sending` / `sent` → `sent`
    - `delivered` → `delivered`
    - `read` → `read`
    - `failed` / `undelivered` → `failed`
  - Update message by `providerMessageId`
  - Emit Nostr event `messaging:status-updated` with new status

### 3.2 Configure Twilio Status Callback URL
- [x] In SMS adapter `sendMessage()` call, add:
  ```typescript
  statusCallback: `${process.env.BASE_URL}/api/messaging/status-callback`
  ```
- [x] Document: `BASE_URL` env var must be set for status callbacks to work

### 3.3 WhatsApp / Signal status webhooks
- [x] WhatsApp: map Meta Webhook `statuses[].status` field similarly
- [x] Signal: Signal doesn't provide read receipts for business accounts — mark as `sent` permanently

---

## Phase 4: Frontend Display

### 4.1 MessageDeliveryStatus type
- [x] Add to `src/shared/types.ts`:
  ```typescript
  export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  ```

### 4.2 Status icon component
- [x] Create `src/client/components/conversations/message-status-icon.tsx`:
  ```tsx
  // pending: Clock icon (gray)
  // sent: Check icon (gray)
  // delivered: DoubleCheck icon (gray)
  // read: DoubleCheck icon (blue)
  // failed: AlertCircle icon (red) with tooltip showing error
  ```
  - Use `lucide-react` icons: `Clock`, `Check`, `CheckCheck`, `AlertCircle`

### 4.3 Update ConversationThread
- [x] In `src/client/components/conversations/` (or existing conversation component):
  - Add `deliveryStatus` and `deliveryError` to message type used in thread
  - Render `<MessageStatusIcon status={msg.deliveryStatus} error={msg.deliveryError} />` at bottom-right of outbound messages
  - Only show status icon for outbound (volunteer-sent) messages

### 4.4 Real-time status updates via Nostr
- [x] Subscribe to `messaging:status-updated` events in the conversation view
- [x] On event receipt: update message status optimistically in local state

---

## Phase 5: API Updates

- [x] Update `GET /api/conversations/:id/messages` response to include `deliveryStatus`, `deliveryStatusUpdatedAt`, `deliveryError`
- [x] Update Zod response schema

---

## Phase 6: i18n

- [x] Add to all 13 locale files:
  - `conversations.status.pending`
  - `conversations.status.sent`
  - `conversations.status.delivered`
  - `conversations.status.read`
  - `conversations.status.failed`
  - `conversations.status.failedTooltip` (with `{{error}}` placeholder)

---

## Phase 7: Tests

- [x] Add to `tests/messaging.spec.ts` or new test:
  - Send message → initial status shows `pending` or `sent`
  - Mock Twilio status callback → status updates to `delivered`
  - Failed delivery → status shows `failed` with error tooltip
  - Read receipt (where supported) → shows blue double-check

---

## Completion Checklist

- [x] `messages` table has `deliveryStatus`, `providerMessageId`, `deliveryError` columns
- [x] `MessagingAdapter.sendMessage()` returns `{ providerMessageId, status }`
- [x] Status callback route updates message status in DB
- [x] `MessageStatusIcon` component renders correct icon per status
- [x] Outbound messages show status icon in conversation thread
- [x] i18n keys added to 13 locales
- [x] `bun run typecheck` passes
- [x] `bun run build` passes
