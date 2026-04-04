# Spec 2: Meeting/Event Lifecycle & Scheduling

**Status:** Deferred
**Date:** 2026-04-03
**Dependencies:** Spec 1 (LiveKit Infrastructure & VideoAdapter)
**Blocked by:** VideoAdapter must exist before meetings can create rooms

## Context

Meetings are a first-class feature of the Llamenos secure communications hub. They cover volunteer trainings (webinar-style, primary use case), team coordination, admin briefings, and occasional hybrid sessions with breakout groups. Meetings are completely separate from the hotline call system — no shared lifecycle or routing.

## Data Model

### `meetings` Table

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
hub_id          uuid NOT NULL REFERENCES hubs(id)
encrypted_title ciphertext NOT NULL          -- hub-key encrypted
encrypted_desc  ciphertext                   -- hub-key encrypted, nullable
meeting_type    text NOT NULL CHECK (meeting_type IN ('training', 'coordination', 'briefing', 'other'))
access_level    text NOT NULL CHECK (access_level IN ('members_only', 'registered_contacts', 'open_invite'))
status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled'))
scheduled_start timestamptz NOT NULL
scheduled_end   timestamptz NOT NULL
actual_start    timestamptz
actual_end      timestamptz
host_pubkey     text NOT NULL                -- pubkey of the meeting creator/host
room_id         text                         -- LiveKit room ID, set when meeting starts
max_participants integer NOT NULL DEFAULT 100
guest_access_enabled boolean NOT NULL DEFAULT false
e2ee_required   boolean NOT NULL DEFAULT true
rrule           text                         -- RFC 5545 recurrence rule, nullable
parent_meeting_id uuid REFERENCES meetings(id) -- for recurring: points to the template
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```

Title and description follow the hub-key encryption pattern (same tier as shift names, role names). `meeting_type` and `access_level` are plaintext enums the server needs for filtering and access control.

### `meeting_participants` Table

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
meeting_id          uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE
identity            text NOT NULL             -- pubkey (hub member) or contactId (guest)
identity_type       text NOT NULL CHECK (identity_type IN ('member', 'contact'))
role                text NOT NULL CHECK (role IN ('host', 'presenter', 'participant', 'guest'))
invited_at          timestamptz
rsvp_status         text NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending', 'pending_approval', 'accepted', 'declined', 'rejected', 'waitlisted', 'cancelled'))
joined_at           timestamptz
left_at             timestamptz
UNIQUE(meeting_id, identity)
```

### `meeting_custom_fields` Table

Links meetings to the hub's custom field definitions for registration forms (see Spec 4):

```sql
meeting_id      uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE
custom_field_id uuid NOT NULL REFERENCES custom_field_definitions(id)
required        boolean NOT NULL DEFAULT false
display_order   integer NOT NULL DEFAULT 0
UNIQUE(meeting_id, custom_field_id)
```

## Meeting Lifecycle

### 1. Create

Admin or user with `meeting:create` permission creates a meeting. Server stores encrypted title/description, sets status to `scheduled`.

For recurring meetings: server stores the `rrule` on a "template" meeting and generates individual instances up to a configurable horizon (default: 4 weeks ahead). A cron job or scheduled task generates further instances as time passes.

### 2. Invite

Host selects participants:
- Hub members — selected from member list, notified via Nostr `meeting:created` event
- Contacts — selected from contact directory (individually or by tag/language filter), invited via messaging adapters (Spec 4 handles the full invite flow)

Participant records created with `rsvp_status: 'pending'` (or `pending_approval` if `access_level: 'registered_contacts'`).

### 3. Open (Start)

Host hits "Start Meeting" → server:
1. Calls `VideoAdapter.createRoom()` with meeting config
2. Stores `room_id` on the meeting record
3. Sets `status: 'live'`, `actual_start: now()`
4. Generates host's LiveKit token with full permissions
5. Publishes `meeting:started` Nostr event

### 4. Join

Participants request to join → server:
1. Validates participant is in `meeting_participants` with appropriate `rsvp_status`
2. Checks `access_level` rules (see Access Control below)
3. Calls `VideoAdapter.generateToken()` with role-appropriate permissions
4. Updates `joined_at` on participant record
5. Publishes `meeting:participant:joined` Nostr event

### 5. Live

During the meeting:
- Host can mute/remove participants via VideoAdapter
- Host can promote participant → presenter (grants publish permission)
- Host can start/stop recording (Spec 3)
- Participant list updates in real-time via Nostr events
- Chat via LiveKit data channels (ephemeral, not persisted unless explicitly configured)

### 6. End

Host ends meeting OR scheduled end time reached → server:
1. Calls `VideoAdapter.deleteRoom()` — disconnects all participants
2. Sets `status: 'ended'`, `actual_end: now()`
3. Finalizes `left_at` for all participants still connected
4. Publishes `meeting:ended` Nostr event
5. If recording was active, triggers post-processing (Spec 3)

### 7. Post-Meeting

- Attendance data available via API
- Recording available for playback (Spec 3)
- Audit events logged for all lifecycle transitions

## Access Control

### Access Levels

| Level | Who Can Join | Token Issuance |
|-------|-------------|----------------|
| `members_only` | Authenticated hub members listed as participants | On join request, verified against member list |
| `registered_contacts` | Members + contacts who registered AND were approved by host | Token issued only after host approves registration |
| `open_invite` | Members + any contact with a valid guest token | Token issued on valid invite token presentation |

### Permissions

New permissions added to the existing role-permission system:

| Permission | Description |
|-----------|-------------|
| `meeting:create` | Create and schedule meetings |
| `meeting:manage` | Start/end/modify any meeting in the hub (admin) |
| `meeting:record` | Start/stop recordings |
| `meeting:join` | Join meetings you're invited to (default for all members) |

Host always has full control over their own meetings regardless of role permissions.

### Guest Permissions (LiveKit Token Grants)

| Grant | Default for Guests | Configurable |
|-------|--------------------|-------------|
| Subscribe audio/video | Yes | No |
| Publish audio | No (muted in webinar) | Yes, per meeting |
| Publish video | No | Yes, per meeting |
| Screen share | No | No |
| Data channels (chat) | Yes | No |
| Recording controls | No | No |

## Recurring Meetings

Simple recurrence using RFC 5545 `RRULE` subset:

- `FREQ=WEEKLY;BYDAY=MO` — every Monday
- `FREQ=WEEKLY;INTERVAL=2;BYDAY=WE` — every other Wednesday
- `FREQ=MONTHLY;BYMONTHDAY=1` — first of every month

No full iCal engine. The template meeting stores the rule; individual instances are generated with `parent_meeting_id` pointing back to the template. Each instance is a standalone meeting that can be independently modified or cancelled.

Generation horizon: 4 weeks ahead by default. A periodic server task extends the horizon as time passes.

## API Routes

All routes hub-scoped, require authentication (except guest join with token — see Spec 4).

```
POST   /api/meetings                        — create meeting
GET    /api/meetings                        — list meetings (filterable by status, type, date range)
GET    /api/meetings/:id                    — get meeting detail
PATCH  /api/meetings/:id                    — update meeting (title, schedule, participants, etc.)
DELETE /api/meetings/:id                    — cancel meeting (soft delete → status: cancelled)

POST   /api/meetings/:id/start             — open LiveKit room, transition to live
POST   /api/meetings/:id/end               — close room, transition to ended
POST   /api/meetings/:id/join              — get participant token (authenticated members)
POST   /api/meetings/:id/join/guest        — get guest token (token-based, see Spec 4)

GET    /api/meetings/:id/participants       — list participants with attendance data
PATCH  /api/meetings/:id/participants/:identity — update participant role/permissions
DELETE /api/meetings/:id/participants/:identity — remove participant

POST   /api/meetings/:id/recording/start   — start recording (Spec 3)
POST   /api/meetings/:id/recording/stop    — stop recording (Spec 3)
```

All request/response schemas defined in `src/shared/schemas/meetings.ts` using zod + OpenAPIHono `createRoute()`.

## Nostr Events

New event types added to `src/client/lib/nostr/types.ts`:

```typescript
export type MeetingEventType =
  | 'meeting:created'
  | 'meeting:updated'
  | 'meeting:cancelled'
  | 'meeting:started'
  | 'meeting:ended'
  | 'meeting:participant:joined'
  | 'meeting:participant:left'
  | 'meeting:recording:started'
  | 'meeting:recording:stopped';
```

All encrypted with hub key, tagged `["t", "llamenos:event"]`. Relay cannot distinguish from other event types.

## Audit Events

All logged to the existing audit system with hub scope:

```
meeting:created    — meeting scheduled (actor: host, metadata: meetingId, type)
meeting:updated    — meeting modified (actor: editor, metadata: changed fields)
meeting:cancelled  — meeting cancelled (actor: canceller)
meeting:started    — room opened (actor: host)
meeting:ended      — room closed (actor: host or system)
meeting:joined     — participant joined (actor: participant)
meeting:left       — participant left (actor: participant)
```
