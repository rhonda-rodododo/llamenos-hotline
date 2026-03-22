# Volunteer Invite Delivery — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Problem

Invite codes are generated server-side but administrators have no in-app way to deliver them to prospective volunteers. The only current option is to copy the raw code and share it through a separate channel. This creates an operational gap: the admin must leave the app, choose a channel, and paste the code manually.

Email is explicitly excluded as a delivery mechanism. This application protects volunteers who may be targeted by adversaries. Email metadata (sender, recipient, timestamps, links) is exposed to mail providers, corporate mail scanning, and legal discovery. An email from "hotline-org.example.com" to a prospective volunteer establishes a deniable but real association between that person and the organisation.

## Goals

1. Admin can send an invite link to a recipient's Signal number without leaving the app.
2. WhatsApp is the secondary option if Signal is not configured.
3. SMS is available as a last resort with an explicit risk acknowledgement.
4. Manual copy-link is always available regardless of messaging configuration.
5. The server stores only a hash of the recipient's phone number — never plaintext.

## Non-Goals

- Email delivery (intentionally excluded — see above).
- Bulk invite sending.
- Invite expiry extension (already 7 days; that is fixed).
- Delivery receipts for invite messages.

## Threat Model Note

The invite link itself (`/invite?code=XXXX`) is safe to transmit over Signal:
- The code has no PII; it only proves "an admin generated this"
- Redemption requires the new user to sign with their freshly-generated Nostr keypair
- A stolen code can be redeemed once — but the legitimate recipient would immediately notice they cannot register, and the admin can revoke and reissue
- Signal provides E2EE for the link in transit and doesn't expose sender/recipient metadata to server operators

## Delivery Channel Architecture

Reuse the existing `MessagingAdapter` interface. Invite delivery is a one-way outbound message, not a conversation — no `conversationId` needed.

**Prerequisite interface change:** The existing `MessagingAdapter.sendMessage()` requires a `conversationId`. This must be updated to make `conversationId` optional before invite delivery can be implemented. Change `SendMessageParams` to use `conversationId?: string` (optional). This change is a prerequisite and must land before the invite send implementation.

```
Admin enters recipient phone → client sends to server
Server: hash phone with HMAC_PHONE_PREFIX
Server: call MessagingAdapter.sendMessage(channel, phone, text)
Server: store recipientPhoneHash + channel + sentAt on invite record
Return: { sent: true, channel }
```

The message body is intentionally generic — no hub name, no organisation name:
> "You've been invited to join a volunteer platform. Accept here: [link] (expires [date])"

This prevents the message from establishing an association between the recipient and the organisation even if the recipient's device is later inspected.

## Available Channels Detection

`GET /api/invites/available-channels` returns which adapters are configured:
```json
{ "signal": true, "whatsapp": false, "sms": true }
```
This drives the UI — only show options that are actually configured.

Requires authentication (authMiddleware). Permission: `invites:read` or `invites:create`. This endpoint is not publicly accessible — exposing it unauthenticated would leak operational security information about which messaging channels are configured.

## Send Endpoint

```
POST /api/invites/:code/send
Body: { recipientPhone: string, channel: 'signal'|'whatsapp'|'sms', acknowledgedInsecure?: boolean }
Auth: admin
Permission required: invites:create (same as creating invite codes)
```

- Validates E.164 phone format
- For `channel = 'sms'`: requires `acknowledgedInsecure: true`; returns 400 otherwise
- Hashes phone with HMAC before storing — never stores plaintext
- Returns `{ sent: true, channel }`
- Returns 404 if invite code does not exist (not 403 — avoids confirming code validity)
- Returns 410 if invite is expired

## Schema Changes

```
invites (existing)
  + recipient_phone_hash  TEXT NULL   -- HMAC of phone, never plaintext
  + delivery_channel      TEXT NULL   -- 'signal'|'whatsapp'|'sms'
  + delivery_sent_at      TIMESTAMPTZ NULL
```

## Frontend

- After invite is created, admin sees: invite code (copy button) + "Send via [channel]" button
- "Send via Signal/WhatsApp/SMS" button opens a small dialog:
  - Phone number input (E.164 hint)
  - If SMS: red warning banner "SMS is not end-to-end encrypted. Use Signal or WhatsApp if possible."
  - SMS requires checkbox: "I understand this message is not end-to-end encrypted"
  - Send button
- Post-send: button changes to "Resend | Sent via Signal on [date]"
- If no channels configured: show only "Copy invite link" with a note explaining why messaging is unavailable

## Invite Redemption Route

Verify `src/client/routes/invite.tsx` (or `invite.$code.tsx`) exists:
- Reads `?code=` from URL query param
- Calls `GET /api/invites/validate/:code` → show error if expired/used
- Renders onboarding: generate keypair, set display name, optionally set up passkey
- On complete: `POST /api/invites/redeem` → redirect to `/profile-setup`

If the route does not exist, it must be created as part of this plan.

## Testing

- Admin sends invite via Signal (mocked adapter) → `recipientPhoneHash` stored, plaintext not stored
- Admin sends invite via SMS without acknowledging insecure → 400
- Admin sends invite via SMS with acknowledgement → sent
- Expired invite → 410
- Invalid E.164 phone → 422
- `GET /api/invites/available-channels` reflects adapter configuration
