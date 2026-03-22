# Volunteer Invite Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure invite delivery for volunteer onboarding. Admins paste a recipient's Signal number (or WhatsApp as fallback); the system sends the invite link via encrypted messaging. Email is explicitly NOT used — it is insecure for this threat model (volunteers may be targeted by adversaries).

**Context:** `POST /api/invites` creates invite codes. The code must reach the new volunteer securely. Signal is the primary channel because invite links contain no PII but could be used to identify recruitment activity if intercepted via email.

---

## Design: Invite Delivery Channels (Prioritized)

1. **Signal** (primary) — sent via the app's existing Signal MessagingAdapter
2. **WhatsApp** (secondary fallback) — if Signal not configured, use WhatsApp adapter
3. **SMS** (last resort) — plaintext, not recommended; admin must acknowledge risk
4. **Manual** — always available: copy the raw link and share it however the admin chooses

**Email is explicitly excluded.** Email headers expose metadata (sender, recipient, timestamp), links may be scanned by mail providers, and email accounts are high-value attack targets for organizations like this.

---

## Phase 1: MessagingAdapter Reuse

- [ ] The `MessagingAdapter` interface already exists (`src/server/messaging/messaging-adapter.ts`)
- [ ] Signal adapter already exists (`src/server/messaging/adapters/signal-adapter.ts`)
- [ ] These adapters are currently used for conversation messaging — we will reuse them for invite delivery

No new adapter needed. The invite delivery service wraps the existing adapters.

---

## Phase 2: Invite Delivery Service

- [ ] Create `src/server/services/invite-delivery-service.ts`:
  ```typescript
  export type InviteDeliveryChannel = 'signal' | 'whatsapp' | 'sms'

  class InviteDeliveryService {
    async sendInvite(params: {
      recipientPhone: string        // E.164 format
      inviteCode: string
      channel: InviteDeliveryChannel
      expiresAt: Date
    }): Promise<{ sent: boolean; channel: InviteDeliveryChannel }>
  }
  ```

- [ ] `sendInvite()` implementation:
  1. Construct invite link: `${process.env.APP_URL}/invite?code=${inviteCode}`
  2. Compose message text (kept short, no hub name or identifiable info in message body):
     ```
     You've been invited to join a volunteer platform.
     Accept here: [link] (expires [date])
     ```
  3. Use the specified adapter to send via `sendMessage()` (single outbound message, no conversation)
  4. Record delivery: store `recipientPhone` HMAC hash + `channel` + `sentAt` on invite record

- [ ] Phone number stored as HMAC hash (using `LABEL_PHONE_HMAC`), never plaintext

---

## Phase 3: Backend Endpoint

- [ ] In `src/server/routes/invites.ts`, add:
  ```
  POST /api/invites/:code/send
  Body: { recipientPhone: string, channel: 'signal' | 'whatsapp' | 'sms' }
  Auth: admin
  ```
  - Validate invite exists and hasn't expired
  - Validate E.164 phone format
  - For `sms`: require explicit `{ acknowledgedInsecure: true }` flag in body
  - Call `inviteDeliveryService.sendInvite()`
  - Return `{ sent: true, channel }`

- [ ] Add `recipientPhoneHash TEXT`, `deliveryChannel VARCHAR(16)`, `deliverySentAt TIMESTAMPTZ` to invites:
  - Drizzle migration: add columns to the `invites` table in the main branch schema.

---

## Phase 4: Available Channels Detection

- [ ] Add `GET /api/invites/available-channels` (admin):
  - Returns which messaging channels are configured for this hub:
    ```json
    { "signal": true, "whatsapp": false, "sms": true }
    ```
  - Based on `MessagingAdapter` configuration in settings

---

## Phase 5: Admin UI

### 5.1 Send invite dialog
- [ ] In the volunteer invite management UI (volunteers page or admin settings):
  - After creating invite code, show "Send invite" button
  - Opens dialog:
    - Phone number field (E.164 hint)
    - Channel selector: Signal / WhatsApp / SMS (only show configured channels)
    - If SMS selected: show warning banner "SMS is not end-to-end encrypted. Use Signal or WhatsApp if possible."
    - "Send invite" button
  - On success: show "Sent via [Channel] to [last 4 digits of number]"
  - "Copy invite link" button always available as fallback

### 5.2 Invite status in list
- [ ] Show delivery status per invite:
  - "Not sent — copy link to share manually"
  - "Sent via Signal on [date]"
  - "Sent via WhatsApp on [date]"

---

## Phase 6: Invite Link Frontend Route

- [ ] Verify `src/client/routes/invite.tsx` (or `invite.$code.tsx`) exists and handles the onboarding flow:
  - Reads `?code=` from URL
  - Calls `GET /api/invites/validate/:code`
  - Shows error if expired/used
  - Shows onboarding form: set display name, generate keypair, optionally passkey setup
  - After redemption: redirect to `/profile-setup`
- [ ] If route doesn't exist: create it

---

## Phase 7: Tests

- [ ] Admin sends invite via Signal → message sent (mocked adapter)
- [ ] Admin sends invite via SMS → shown warning but allowed with `acknowledgedInsecure: true`
- [ ] Expired invite code → 410 Gone
- [ ] Invalid phone format → 422
- [ ] Invite link in message navigates to onboarding page
- [ ] `recipientPhoneHash` stored (not plaintext) after send

---

## Completion Checklist

- [ ] `InviteDeliveryService` reuses existing messaging adapters
- [ ] `POST /api/invites/:code/send` endpoint with channel selection
- [ ] Available channels endpoint for UI
- [ ] No email pathway. Signal > WhatsApp > SMS > manual.
- [ ] SMS requires explicit insecure acknowledgment
- [ ] Phone stored as HMAC hash, never plaintext
- [ ] Admin UI: channel selector, send button, delivery status
- [ ] Invite link frontend route exists and handles onboarding
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
