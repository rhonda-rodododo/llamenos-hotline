# Spec 4: Event Registration & Contact Invitation Flow

**Status:** Deferred
**Date:** 2026-04-03
**Dependencies:** Spec 2 (Meeting Lifecycle), existing contact directory, existing blast system
**Blocked by:** Meeting data model must exist; contact directory and blast system must exist (both already do)

## Context

Meetings need to reach people beyond hub members — new volunteer recruits, partner org contacts, community members being trained. The existing contact directory and blast (mass messaging) system provide the foundation. This spec extends them with event registration, guest token issuance, and an onboarding funnel that tracks contacts from first invite through to hub membership.

## Access Levels (from Spec 2)

| Level | Behavior |
|-------|----------|
| `members_only` | Only authenticated hub members in the participant list can join. No guest flow. |
| `registered_contacts` | Contacts must be invited, register via form, AND be approved by host before receiving a join token. |
| `open_invite` | Any contact with a valid invite token can register and join immediately. |

## Data Model

### `event_registrations` Table

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
meeting_id          uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE
contact_id          uuid NOT NULL REFERENCES contacts(id)
invited_at          timestamptz
invited_via         text CHECK (invited_via IN ('sms', 'whatsapp', 'signal', 'telegram', 'rcs', 'email', 'manual'))
registration_status text NOT NULL DEFAULT 'invited' CHECK (registration_status IN (
  'invited',           -- invite sent, no response yet
  'pending_approval',  -- registered, waiting for host approval (registered_contacts mode)
  'registered',        -- confirmed registration
  'waitlisted',        -- max participants reached
  'rejected',          -- host rejected registration
  'cancelled'          -- contact cancelled their registration
))
guest_token         text UNIQUE               -- single-use or time-limited join token
token_expires_at    timestamptz
attended_at         timestamptz               -- set when contact actually joins the meeting
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
UNIQUE(meeting_id, contact_id)
```

### Custom Field Integration

The existing `custom_field_definitions` table (hub-scoped, admin-configured) defines available fields. The `meeting_custom_fields` join table (Spec 2) selects which fields appear on a meeting's registration form.

When a contact registers, their custom field values are stored on the **contact record** — not on the registration. This means:
- Field values persist across events (contact fills in "organization" once, it carries forward)
- Values can be pre-populated from previous registrations
- The contact directory gets richer over time as contacts attend more events
- Fields are encrypted per the existing custom field encryption pattern

## Invite Distribution Flow

### Step 1: Host Configures Invites

Host creates/edits a meeting with `guestAccessEnabled: true` and selects invitees:

- **Individual selection** — pick specific contacts from the directory
- **Tag-based** — invite all contacts with certain tags (e.g., "new-recruit", "partner-org")
- **Language-based** — invite contacts by preferred language
- **Combined filters** — tag + language (same targeting as existing blasts)

Host also selects which custom fields appear on the registration form and marks which are required.

### Step 2: Blast Creation

Invites are distributed via the existing blast system with a new type:

```typescript
blastType: 'message' | 'event_invite'
```

For `event_invite` blasts:
- Server generates a unique `guest_token` per contact
- Token is a cryptographically random string (32 bytes, base64url-encoded)
- Token is time-limited: expires at `meeting.scheduled_end + 1 hour`
- Server creates `event_registrations` records with `status: 'invited'`
- Blast delivery uses each contact's preferred messaging channel

### Step 3: Message Template

The invite message sent via Signal/SMS/WhatsApp:

```
You're invited to: [Meeting Title]
Date: [Scheduled Start] — [Scheduled End]
Host: [Host Name]

Register here: https://{hub-domain}/events/{meetingId}/register?token={guestToken}
```

Message content is channel-appropriate (SMS is shorter, Signal/WhatsApp can be richer). Title and host name are decrypted server-side for the outbound message (server has hub key access for operational messages — same pattern as blast content).

### Step 4: Registration Page

Contact clicks the link → lands on a lightweight, unauthenticated SPA route:

**Route:** `/events/:meetingId/register`

**Page content (minimal, no app chrome):**
- Meeting title, description, date/time, host name
- Custom field registration form (fields selected by host)
- RSVP buttons: "Register" / "Decline"
- If meeting is currently live: "Join Now" button

**Token validation:**
- `token` query param validated server-side
- Invalid/expired token → "This invite has expired" message
- Already-registered token → shows current registration status
- Valid token → shows registration form

### Step 5: Registration Submission

Contact fills in custom fields and submits:

1. Custom field values saved/updated on the contact record (encrypted)
2. Registration status updated:
   - `open_invite` → `registered` immediately
   - `registered_contacts` → `pending_approval` (host must approve)
3. Confirmation shown to contact:
   - "You're registered! You'll receive a join link when the meeting starts."
   - OR "Your registration is pending approval."

### Step 6: Host Approval (registered_contacts only)

Host sees pending registrations in the meeting detail view:
- Contact name, custom field values (decrypted client-side)
- Approve / Reject buttons
- Approve → status becomes `registered`, confirmation message sent to contact
- Reject → status becomes `rejected`, rejection message sent

### Step 7: Join Flow

When the meeting starts:
1. Registered contacts receive a "Meeting is starting" message via their invite channel
2. Message contains the same registration link (now shows "Join Now" instead of registration form)
3. Contact clicks "Join Now" → server validates token + registration status
4. Server calls `VideoAdapter.generateToken()` with guest role permissions
5. Contact enters the LiveKit room
6. `attended_at` set on registration record

## Blast System Extensions

### New Fields on `blasts` Table

```sql
blast_type      text NOT NULL DEFAULT 'message' CHECK (blast_type IN ('message', 'event_invite'))
meeting_id      uuid REFERENCES meetings(id)  -- set for event_invite blasts
```

### Delivery Tracking

Existing blast delivery tracking (`blast_deliveries` table) works unchanged. Each contact's invite is a delivery record with success/fail status. The `event_registrations` table tracks the registration funnel separately.

### Re-Invites

Host can re-send invites to contacts who haven't registered:
- New blast targeting: contacts in `event_registrations` with `status: 'invited'` (no response yet)
- Reuses the same guest token (not regenerated)
- Delivery tracked as a new blast delivery

## Onboarding Funnel

The contact lifecycle becomes visible without any new tables — it's derived from existing data:

```
contact created
  → invited to event (event_registrations.invited_at)
    → registered (event_registrations.registration_status = 'registered')
      → attended (event_registrations.attended_at IS NOT NULL)
        → onboarded as hub member (hub_members record exists)
```

### Funnel Queries

Useful views for admins:

- **"Engaged but not onboarded"** — contacts who attended 2+ events but aren't hub members
- **"Invited but never responded"** — contacts with only `invited` status across all events
- **"Drop-off"** — contacts who registered but didn't attend
- **"Active participants"** — contacts who attended in the last 30 days

These are read queries against existing tables, not new infrastructure. Could be exposed as dashboard widgets (deferred — not part of this spec).

## Guest Token Security

- Tokens are 32 bytes of `crypto.getRandomValues`, base64url-encoded
- One token per contact per meeting — not reusable across meetings
- Time-limited: expires at `meeting.scheduled_end + 1 hour`
- Single-identity: token is bound to a specific contact ID. Sharing the link doesn't help — the token validates against the contact record
- Rate-limited: token validation endpoint rate-limited to prevent enumeration
- Tokens stored hashed in the database (SHA-256). The plaintext token appears only in the invite URL. Server compares `SHA-256(presented_token)` against stored hash.

## API Routes

### Registration (unauthenticated, token-validated)

```
GET    /api/events/:meetingId/info?token=...           — meeting info for registration page
POST   /api/events/:meetingId/register                 — submit registration + custom fields
GET    /api/events/:meetingId/status?token=...          — check registration status
POST   /api/events/:meetingId/join?token=...            — get guest LiveKit token
POST   /api/events/:meetingId/decline?token=...         — decline invitation
```

### Management (authenticated, hub-scoped)

```
GET    /api/meetings/:id/registrations                  — list all registrations
PATCH  /api/meetings/:id/registrations/:contactId       — approve/reject registration
POST   /api/meetings/:id/invite                         — create invite blast for selected contacts
POST   /api/meetings/:id/reinvite                       — re-invite non-responsive contacts
GET    /api/meetings/:id/registrations/stats             — funnel statistics
```

## Audit Events

```
event:invited       — invite sent to contact (actor: host, metadata: contactId, channel)
event:registered    — contact registered (actor: contact via token, metadata: contactId)
event:approved      — host approved registration (actor: host, metadata: contactId)
event:rejected      — host rejected registration (actor: host, metadata: contactId)
event:cancelled     — contact cancelled registration (actor: contact, metadata: contactId)
event:attended      — contact joined the meeting (actor: contact, metadata: contactId)
event:declined      — contact declined invitation (actor: contact, metadata: contactId)
```

## Privacy Considerations

- Registration pages show minimal meeting info — title, date, host name only
- No participant list visible to guests
- Custom field values are encrypted on the contact record — server doesn't see plaintext
- Guest tokens are hashed at rest — database breach doesn't yield usable tokens
- Invite URLs sent via encrypted channels (Signal) where possible; SMS/WhatsApp are inherently less secure but acceptable for invite links (the link itself doesn't contain sensitive data beyond the token)
