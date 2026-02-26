# Epic 85: Mobile Admin Screens & Messaging

## Problem Statement

Admin users need to manage volunteers, bans, and view audit logs from their mobile device. Additionally, all users with messaging permissions need access to threaded E2EE conversations (SMS/WhatsApp/Signal). These features exist in the web app but are not yet available on mobile.

## Requirements

### Functional Requirements

#### Admin Screens
1. **Volunteer management** — List, invite, activate, deactivate volunteers
2. **Ban management** — Add, remove, search banned callers
3. **Audit log** — View hash-chained audit log entries (encrypted)
4. **Hub settings** — Telephony provider, messaging, custom fields, spam settings

#### Messaging
5. **Conversation list** — Grouped by channel (SMS, WhatsApp, Signal)
6. **Thread view** — Real-time encrypted message display
7. **Message composer** — Send E2EE messages with ECIES envelopes
8. **Unread indicators** — Badge counts on tab and conversation list

### Non-Functional Requirements

- Role-based access guard (admin screens hidden from non-admins)
- All message content E2EE (per-message envelope encryption)
- Real-time message updates via Nostr relay

## Technical Design

### Admin Section

```
app/admin/
  _layout.tsx        — Admin layout with role guard
  volunteers.tsx     — Volunteer list + management
  bans.tsx           — Ban list management
  audit.tsx          — Audit log viewer
  settings.tsx       — Hub settings
```

**RoleGuard component** — Checks `useAuthStore().isAdmin` and redirects non-admins. Wraps all admin routes.

### Messaging Section

```
app/(tabs)/conversations.tsx  — Conversation list (new tab)
app/conversation/[id].tsx     — Thread view
```

**Message encryption** — Each message encrypted with random symmetric key, ECIES-wrapped for assigned volunteer + each admin (same as web app's Epic 74).

### Components

- `src/components/RoleGuard.tsx` — Permission-based UI gating
- `src/components/MessageBubble.tsx` — Incoming/outgoing message display
- `src/components/MessageComposer.tsx` — Text input + send with E2EE
- `src/components/VolunteerCard.tsx` — Volunteer list item
- `src/components/BanCard.tsx` — Ban list item
- `src/components/AuditEntry.tsx` — Audit log entry with decryption

## Acceptance Criteria

- [ ] Admin screens only accessible to admin role users
- [ ] Can view, invite, activate, deactivate volunteers
- [ ] Can add, remove, search bans
- [ ] Audit log displays with decrypted entries
- [ ] Conversation list shows threads grouped by channel
- [ ] Can view and send E2EE messages in threads
- [ ] Real-time message updates via Nostr relay
- [ ] Unread message indicators work

## Dependencies

- **Epic 83** (Mobile Foundation) — auth, crypto, API client
- **Epic 84** (Mobile Core Screens) — tab navigator, Nostr relay
- **Epic 74** (E2EE Messaging Storage) — envelope encryption format
- **Epic 60** (Permission-Based Access Control) — role checking
