# Epic 85: Mobile Admin Screens & E2EE Messaging

## Problem Statement

Admin users need to manage volunteers, bans, and view audit logs from their mobile device. Additionally, all users with messaging permissions need access to threaded E2EE conversations (SMS/WhatsApp/Signal/RCS/web). These features exist in the web app across 5 route files and 10+ components but are not yet available on mobile. The primary challenges are: (1) porting the permission-gated UI with 70 permissions across 13 domains, (2) implementing ECIES envelope encryption for messages on React Native, and (3) adapting the two-panel conversation layout to single-panel mobile navigation.

## Current State

### Permission System (`src/shared/permissions.ts` — 385 lines)

**70 permissions across 13 domains:**

| Domain | Count | Key Permissions |
|--------|-------|-----------------|
| calls | 7 | `answer`, `read-active`, `read-active-full`, `read-history`, `read-presence`, `read-recording`, `debug` |
| notes | 5 | `create`, `read-own`, `read-all`, `read-assigned`, `update-own` |
| reports | 8 | `create`, `read-own`, `read-all`, `read-assigned`, `assign`, `update`, `send-message-own`, `send-message` |
| conversations | 11 | `read-assigned`, `read-all`, `claim`, `claim-sms`, `claim-whatsapp`, `claim-signal`, `claim-rcs`, `claim-web`, `claim-any`, `send`, `send-any`, `update` |
| volunteers | 5 | `read`, `create`, `update`, `delete`, `manage-roles` |
| shifts | 6 | `read-own`, `read`, `create`, `update`, `delete`, `manage-fallback` |
| bans | 5 | `report`, `read`, `create`, `bulk-create`, `delete` |
| invites | 3 | `read`, `create`, `revoke` |
| settings | 8 | `read`, `manage`, `manage-telephony`, `manage-messaging`, `manage-spam`, `manage-ivr`, `manage-fields`, `manage-transcription` |
| audit | 1 | `read` |
| blasts | 4 | `read`, `send`, `manage`, `schedule` |
| files | 4 | `upload`, `download-own`, `download-all`, `share` |
| system | 3 | `manage-roles`, `manage-hubs`, `manage-instance` |

**Wildcard support:**
- `"*"` — global wildcard, grants everything (super-admin only)
- `"domain:*"` — grants all permissions in a domain (e.g., `calls:*`)
- Exact match as fallback

**Key functions to port:**
```typescript
// Check single permission against a flat list (supports wildcards)
function permissionGranted(grantedPermissions: string[], required: string): boolean

// Resolve permissions from role IDs
function resolvePermissions(roleIds: string[], roles: Role[]): string[]

// Combined check: resolve + grant
function hasPermission(roleIds: string[], roles: Role[], permission: string): boolean

// Hub-scoped check (super-admin bypasses hub filtering)
function hasHubPermission(globalRoles, hubRoles, allRoleDefs, hubId, permission): boolean

// Resolve effective permissions for a user in a specific hub
function resolveHubPermissions(globalRoles, hubRoles, allRoleDefs, hubId): string[]

// Channel-specific claim check
function canClaimChannel(permissions: string[], channelType: string): boolean
function getClaimableChannels(permissions: string[]): string[]
```

**5 default roles:**

| Role | Slug | Key Permissions |
|------|------|-----------------|
| Super Admin | `super-admin` | `["*"]` (system role) |
| Hub Admin | `hub-admin` | `volunteers:*`, `shifts:*`, `settings:*`, `audit:read`, `bans:*`, `invites:*`, `notes:read-all`, `reports:*`, `conversations:*`, `calls:*`, `blasts:*`, `files:*` |
| Reviewer | `reviewer` | `notes:read-assigned`, `reports:read-assigned`, `reports:assign`, `reports:update`, `conversations:read-assigned`, `conversations:send` |
| Volunteer | `volunteer` | `calls:answer`, `calls:read-active`, `notes:create/read-own/update-own`, all `conversations:claim-*`, `conversations:send`, `bans:report`, `files:upload/download-own` |
| Reporter | `reporter` | `reports:create/read-own/send-message-own`, `files:upload/download-own` |

### Admin Screens in Web App

#### Volunteers Page (`src/client/routes/volunteers.tsx` — 567 lines)

**State:**
```typescript
const [volunteers, setVolunteers] = useState<Volunteer[]>([])
const [invites, setInvites] = useState<InviteCode[]>([])
const [roles, setRoles] = useState<RoleDefinition[]>([])
const [showAddForm, setShowAddForm] = useState(false)
const [showInviteForm, setShowInviteForm] = useState(false)
const [generatedNsec, setGeneratedNsec] = useState<string | null>(null)
const [inviteLink, setInviteLink] = useState<string | null>(null)
```

**API calls on load:** `Promise.all([listVolunteers(), listInvites(), listRoles()])`

**Key interactions:**
- "Add Volunteer" → generates keypair client-side (`generateKeyPair()`), POSTs `createVolunteer()`. On success, shows nsec in a dismissable yellow warning card. nsec shown once, auto-cleared from clipboard after 30s.
- "Invite Volunteer" → calls `createInvite()`, shows invite link (`?code=...`).
- Pending invites section: `revokeInvite(code)` per row.
- `VolunteerRow`: role change via inline `<Select>`, active/inactive toggle, delete via `ConfirmDialog`.
- Phone reveal: masked by default (`***XX`), Eye/EyeOff button requires `usePinChallenge()` PIN dialog before showing.
- Session revocation: handled server-side on deactivation or role change.

**`Volunteer` type:**
```typescript
interface Volunteer {
  pubkey: string; name: string; phone: string; roles: string[]
  active: boolean; createdAt: string; transcriptionEnabled: boolean
  onBreak: boolean; callPreference: 'phone' | 'browser' | 'both'
  supportedMessagingChannels?: string[]
  messagingEnabled?: boolean
}
```

#### Bans Page (`src/client/routes/bans.tsx` — 304 lines)

**State:**
```typescript
const [bans, setBans] = useState<BanEntry[]>([])
const [showAdd, setShowAdd] = useState(false)
const [showBulk, setShowBulk] = useState(false)
```

**API call on load:** `listBans()`

**Key interactions:**
- "Ban Number" → E.164 phone + reason, calls `addBan({ phone, reason })`.
- "Import Ban List" → textarea (one E.164 per line) + shared reason, calls `bulkAddBans({ phones, reason })`.
- `BanRow`: shows phone (monospace), reason, bannedAt date. Delete via `ConfirmDialog` → `removeBan(phone)`.

**`BanEntry` type:**
```typescript
interface BanEntry { phone: string; reason: string; bannedBy: string; bannedAt: string }
```

#### Audit Log Page (`src/client/routes/audit.tsx` — 289 lines)

**State:**
```typescript
const [entries, setEntries] = useState<AuditLogEntry[]>([])
const [total, setTotal] = useState(0)
const [page, setPage] = useState(1)
const [searchText, setSearchText] = useState('')
const [eventType, setEventType] = useState('all')
const [dateFrom, setDateFrom] = useState('')
const [dateTo, setDateTo] = useState('')
const limit = 50
```

**API call:** `listAuditLog({ page, limit, eventType, dateFrom, dateTo, search })` — re-fired on filter/page change.

**Filter categories:** `all`, `authentication`, `volunteers`, `calls`, `settings`, `shifts`, `notes`

**Event category colors:**
- auth events: `bg-blue-100/text-blue-800` (dark: `bg-blue-900/30/text-blue-300`)
- volunteer events: purple
- call events: green
- settings events: amber
- shift events: cyan

**`AuditLogEntry` type:**
```typescript
interface AuditLogEntry {
  id: string; event: string; actorPubkey: string
  details: Record<string, unknown>; createdAt: string
  previousEntryHash?: string; entryHash?: string  // hash-chain integrity
}
```

**Actor display:** maps pubkey to volunteer name via `Map<string, string>`. Falls back to first 12 chars. `system` shown as-is. Named actors link to `/volunteers/$pubkey`.

#### Admin Settings Page (`src/client/routes/admin/settings.tsx` — 287 lines)

Shell page loading 9 settings API calls in parallel, rendering 10 collapsible section components:

**API calls (all parallel):**
```
getSpamSettings(), getCallSettings(), getTranscriptionSettings(),
getIvrLanguages(), listIvrAudio(), getWebAuthnSettings(),
getCustomFields(), getTelephonyProvider(), getMessagingConfig()
```

**10 section components** (from `src/client/components/admin-settings/`):
1. `PasskeyPolicySection` — WebAuthn admin/volunteer toggles
2. `RolesSection` — PBAC custom role editor
3. `TelephonyProviderSection` — provider type, credentials, WebRTC config
4. `TranscriptionSection` — global toggle (confirm dialog), opt-out policy
5. `IvrLanguagesSection` — phone menu language options
6. `CallSettingsSection` — queue timeout, voicemail max seconds
7. `VoicePromptsSection` — per-language audio recording uploads
8. `CustomFieldsSection` — note/report custom field definitions
9. `SpamSection` — voice CAPTCHA, rate limiting (confirm dialogs)
10. `RCSChannelSection` — RCS Business Messaging config (conditional)

**Section prop pattern (shared by all):**
```typescript
{ expanded: boolean; onToggle: (open: boolean) => void; statusSummary?: string }
```

**Dangerous toggle pattern:** `handleConfirmToggle(key, newValue)` → `confirmToggle` state → `ConfirmDialog` → `applyConfirmToggle()`.

### Messaging Components in Web App

#### Conversations Page (`src/client/routes/conversations.tsx` — 244 lines)

**Layout:** Two-panel: 320px fixed sidebar (conversation list) + flex-1 detail panel. Height: `h-[calc(100vh-12rem)]`.

**Data source:** `useConversations()` hook provides `{ conversations, waitingConversations }` via Nostr + polling.

**Message loading:** `getConversationMessages(id, { limit: 100 })` on selection; re-polls every 10 seconds.

**Empty state:** If no channels configured, shows setup prompt linking to admin settings.

**Send flow (encryption):**
```typescript
// Build reader list: current user + admin decryption pubkey
const readerPubkeys = [currentUserPubkey, adminDecryptionPubkey?]
// Encrypt with per-message random key, ECIES-wrapped for each reader
const encrypted = encryptMessage(plaintext, readerPubkeys)
// Send encrypted payload + plaintext (server forwards to external channel)
sendConversationMessage(id, {
  encryptedContent: encrypted.encryptedContent,
  readerEnvelopes: encrypted.readerEnvelopes,
  plaintextForSending: plaintext  // for SMS/WhatsApp delivery
})
```

#### ConversationList Component (`src/client/components/ConversationList.tsx` — 189 lines)

**Props:** `{ conversations: Conversation[], onSelect: (id: string) => void, selectedId?: string }`

Groups into **Waiting** (yellow dot) and **Active** (green dot). Sorted by `lastMessageAt` descending within each group. Each card: status dot, `ChannelBadge`, `...last4` contact, relative time (`just now / Xm ago / Xh ago / Xd ago`), message count, assignee (8-char pubkey prefix or italic "Waiting").

#### ConversationThread Component (`src/client/components/ConversationThread.tsx` — 197 lines)

**Props:** `{ conversationId: string, messages: ConversationMessage[], isLoading: boolean }`

**Decryption:** For each message, calls `decryptMessage(msg.encryptedContent, msg.readerEnvelopes, secretKey, publicKey)`. Undecryptable messages show `[Encrypted]` italic.

**Layout:**
- Inbound: left-aligned, `bg-muted`, `rounded-2xl rounded-bl-md`
- Outbound: right-aligned, `bg-primary text-primary-foreground`, `rounded-2xl rounded-br-md`

**Status icons (outbound):** Clock (pending), Check (sent), CheckCheck (delivered), CheckCheck blue (read), AlertCircle red (failed).

Lock icon + timestamp on every message. Auto-scroll to bottom on new messages with "scroll down" float button.

#### MessageComposer Component (`src/client/components/MessageComposer.tsx` — 101 lines)

**Props:** `{ onSend: (plaintext: string) => void, disabled?: boolean, channelType: string }`

Auto-expanding textarea (max 200px). Cmd/Ctrl+Enter to send. Lock icon + encryption note + channel type label. Paperclip button (disabled — future file attachment).

### Message Encryption (`src/client/lib/crypto.ts`)

```typescript
// Encrypt: random 32-byte key → XChaCha20-Poly1305 → ECIES-wrap key for each reader
function encryptMessage(plaintext: string, readerPubkeys: string[]): EncryptedMessagePayload

// Decrypt: find matching envelope → ECIES unwrap key → XChaCha20-Poly1305 decrypt
function decryptMessage(
  encryptedContent: string,
  readerEnvelopes: RecipientKeyEnvelope[],
  secretKey: Uint8Array,
  readerPubkey: string
): string | null
```

**Crypto chain:** Per-message random key → `xchacha20poly1305` (24-byte nonce) → content encrypted. Key ECIES-wrapped with `LABEL_MESSAGE` domain separation for each `readerPubkey`. Output: `hex(nonce || ciphertext)` + array of `{ pubkey, wrappedKey, ephemeralPubkey }`.

### API Endpoints Used

#### Volunteer CRUD
| Method | Path | Permission |
|--------|------|-----------|
| GET | `/volunteers` | `volunteers:read` |
| POST | `/volunteers` | `volunteers:create` |
| PATCH | `/volunteers/:pubkey` | `volunteers:update` |
| DELETE | `/volunteers/:pubkey` | `volunteers:delete` |

#### Ban Management
| Method | Path | Permission |
|--------|------|-----------|
| GET | `[hub]/bans` | `bans:read` |
| POST | `[hub]/bans` | `bans:report` |
| POST | `[hub]/bans/bulk` | `bans:bulk-create` |
| DELETE | `[hub]/bans/:phone` | `bans:delete` |

#### Audit Log
| Method | Path | Permission |
|--------|------|-----------|
| GET | `[hub]/audit` | `audit:read` |

Query params: `page`, `limit`, `actorPubkey`, `eventType`, `dateFrom`, `dateTo`, `search`

#### Conversations
| Method | Path | Notes |
|--------|------|-------|
| GET | `[hub]/conversations` | Permission-filtered |
| GET | `[hub]/conversations/stats` | `{ waiting, active, closed, today, total }` |
| GET | `[hub]/conversations/:id/messages` | `?page&limit` |
| POST | `[hub]/conversations/:id/messages` | `{ encryptedContent, readerEnvelopes, plaintextForSending? }` |
| PATCH | `[hub]/conversations/:id` | `{ status?, assignedTo? }` |
| POST | `[hub]/conversations/:id/claim` | Channel permission check |

#### Settings (admin-only)
| Method | Path | Purpose |
|--------|------|---------|
| GET/PATCH | `/settings/spam` | Spam settings |
| GET/PATCH | `/settings/call` | Call settings |
| GET/PATCH | `/settings/transcription` | Transcription settings |
| GET/PATCH | `/settings/telephony-provider` | Provider config |
| GET/PATCH | `/settings/messaging` | Messaging config |
| POST | `/settings/telephony-provider/test` | Connection test |
| GET/PUT | `/settings/custom-fields` | Custom field definitions |
| GET/POST/PATCH/DELETE | `/settings/roles[/:id]` | PBAC role CRUD |

#### Invites
| Method | Path |
|--------|------|
| GET | `/invites` |
| POST | `/invites` |
| DELETE | `/invites/:code` |

## Requirements

### Functional Requirements

#### Admin Screens
1. **Volunteer management** — List, add (with client-side keypair gen), invite (with shareable link), activate/deactivate, role change, delete, phone reveal with PIN challenge
2. **Ban management** — Add single ban, bulk import (one E.164 per line), delete, search
3. **Audit log** — Paginated entries with filtering (event type, date range, search), event category color coding, actor name resolution, hash-chain integrity display
4. **Hub settings** — All 10 settings sections as collapsible cards: passkey policy, roles, telephony, transcription, IVR languages, call settings, voice prompts, custom fields, spam, RCS

#### Messaging
5. **Conversation list** — Grouped by status (waiting/active), channel badge, relative time, unread indicators
6. **Thread view** — Real-time encrypted message display with status icons, auto-scroll, lock indicators
7. **Message composer** — Send E2EE messages with ECIES envelope encryption for assigned volunteer + admin(s)
8. **Claim/close/reassign** — Conversation lifecycle management with channel-specific claim permissions

### Non-Functional Requirements

- Permission-gated UI: screens and actions hidden when user lacks required permission
- All message content E2EE (per-message envelope encryption via `LABEL_MESSAGE`)
- Real-time updates via Nostr relay (from Epic 84's relay port)
- Single-panel navigation (no side-by-side split on mobile)

## Technical Design

### Permission Hook for React Native

Port `src/shared/permissions.ts` (385 lines) as-is — it's pure TypeScript with zero DOM dependencies. Create a React Native hook:

```typescript
// src/lib/permissions.ts — copy from shared/permissions.ts (pure logic)

// src/hooks/usePermission.ts — RN-specific hook
import { useAuthStore } from '@/lib/store'
import { hasHubPermission, resolveHubPermissions } from '@/lib/permissions'

export function usePermission(permission: string): boolean {
  const { globalRoles, hubRoles, activeHubId } = useAuthStore()
  const { roles } = useRolesQuery()  // React Query cached
  return hasHubPermission(globalRoles, hubRoles, roles, activeHubId, permission)
}

export function usePermissions(): string[] {
  const { globalRoles, hubRoles, activeHubId } = useAuthStore()
  const { roles } = useRolesQuery()
  return resolveHubPermissions(globalRoles, hubRoles, roles, activeHubId)
}
```

### PermissionGuard Component

```typescript
// src/components/PermissionGuard.tsx
export function PermissionGuard({
  permission, children, fallback = null
}: {
  permission: string
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const allowed = usePermission(permission)
  return allowed ? <>{children}</> : <>{fallback}</>
}
```

### Admin Section — File Structure

```
app/admin/
  _layout.tsx           — Stack navigator with PermissionGuard (any admin permission)
  volunteers.tsx        — Volunteer list + management
  volunteers/[pubkey].tsx — Volunteer detail (linked from audit actor names)
  bans.tsx              — Ban list management
  audit.tsx             — Audit log viewer with filters
  settings.tsx          — Hub settings (10 collapsible sections)
  settings/roles.tsx    — Role editor (full screen on mobile)
```

### Volunteer Management Screen

**Adaptation from web (567 LOC → ~400 LOC mobile):**

- Replace inline `AddVolunteerForm` card with bottom sheet modal (expo's `@gorhom/bottom-sheet`)
- Replace inline `InviteForm` with bottom sheet modal
- Replace `<Select>` role picker with `react-native` Picker or action sheet
- nsec display card: `expo-clipboard` for copy, auto-clear after 30s
- Phone reveal: reuse `usePinChallenge()` pattern from Epic 83's PIN implementation
- Delete confirmation: `Alert.alert()` native dialog instead of custom `ConfirmDialog`
- Invite link sharing: `react-native` `Share.share()` API for OS share sheet

**Permission gates:**
- Screen access: `volunteers:read`
- Add button: `volunteers:create`
- Invite button: `invites:create`
- Role change: `volunteers:manage-roles`
- Delete button: `volunteers:delete`

### Ban Management Screen

**Adaptation from web (304 LOC → ~200 LOC mobile):**

- Single ban form: bottom sheet with E.164 input + reason
- Bulk import: full-screen modal with multiline TextInput
- Delete: swipe-to-delete gesture (react-native-gesture-handler) + confirmation alert
- Search: sticky search bar at top

**Permission gates:**
- Screen access: `bans:read`
- Add: `bans:create`
- Bulk import: `bans:bulk-create`
- Delete: `bans:delete`

### Audit Log Screen

**Adaptation from web (289 LOC → ~250 LOC mobile):**

- Filter controls: horizontal scroll chips for event type, date picker modals for date range
- Paginated FlatList with `onEndReached` for infinite scroll (replace button pagination)
- Event category colored badges (same color scheme as web)
- Actor name resolution via `listVolunteers()` cached in React Query

**Permission gate:** `audit:read`

### Settings Screen

**Adaptation from web (287 LOC shell + ~1500 LOC section components):**

On mobile, the settings page is a ScrollView of Accordion items. Each section expands in-place. Dangerous toggles use `Alert.alert()` for confirmation instead of custom dialogs.

**Priority sections for mobile:**
1. Telephony Provider (most critical for ops)
2. Spam Settings (real-time toggle during incidents)
3. Call Settings (queue timeout, voicemail)
4. Roles (permission management)
5. Custom Fields

**Deferred to later (rarely changed from mobile):**
- IVR Languages, Voice Prompts (audio upload needs file picker)
- Passkey Policy, Transcription
- RCS Channel config

**Permission gate:** `settings:read` for viewing; section-specific `settings:manage-*` for editing

### Conversation Navigation — Mobile Adaptation

The web app uses a two-panel layout (320px sidebar + detail). On mobile, this becomes stack navigation:

```
app/(tabs)/conversations.tsx    — Conversation list (full screen)
app/conversation/[id].tsx       — Thread view (pushed onto stack)
```

**Conversation list features:**
- Pull-to-refresh (`RefreshControl`)
- Waiting section (yellow dot) at top, Active section (green dot) below
- Each row: channel badge, `...last4` contact, relative time, message count, assignee
- Unread badge on conversations with new messages since last view
- Tap → push to thread view

**Thread view features:**
- FlatList with `inverted` prop (newest messages at bottom)
- Message bubbles: inbound left (muted bg), outbound right (primary bg)
- Status icons on outbound: clock/check/checkcheck/blue-checkcheck/alert
- Lock icon on every message
- KeyboardAvoidingView wrapping MessageComposer at bottom
- Header: channel badge, contact last4, "End-to-end encrypted", action buttons (Claim/Close/Reassign)

### Message Encryption on React Native

The encryption flow uses `@noble/ciphers` and `@noble/curves` which work on Hermes (Expo SDK 55 with BigInt). The key operations:

```typescript
// src/lib/messaging.ts — port from web's crypto.ts message functions

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { randomBytes } from '@noble/ciphers/crypto.js'
import { LABEL_MESSAGE } from '@/shared/crypto-labels'

// encryptMessage: random 32-byte key → xchacha20poly1305 → ECIES wrap for each reader
// decryptMessage: find envelope matching our pubkey → ECIES unwrap → xchacha20poly1305 decrypt
```

Eventually migrated to native Rust via UniFFI (Epic 90), but JS crypto works for initial release.

### Real-Time Updates

Conversations subscribe to these Nostr event kinds (from Epic 84's relay port):
- `KIND_MESSAGE_NEW` (1010) — new inbound/outbound message
- `KIND_CONVERSATION_ASSIGNED` (1011) — assignment changed
- `KIND_CONVERSATION_NEW` — new conversation created
- `KIND_CONVERSATION_CLOSED` — conversation closed

Use `useNostrSubscription()` hook (ported in Epic 84) to receive events and update React Query cache:

```typescript
useNostrSubscription([1010, 1011], (event) => {
  const parsed = parseLlamenosContent(event)
  if (parsed.type === 'message:new') {
    queryClient.invalidateQueries(['conversations', parsed.conversationId, 'messages'])
  }
  if (parsed.type === 'conversation:assigned' || parsed.type === 'conversation:new') {
    queryClient.invalidateQueries(['conversations'])
  }
})
```

## Files to Create

### Screens
- `app/admin/_layout.tsx` — Admin stack navigator with PermissionGuard
- `app/admin/volunteers.tsx` — Volunteer list + add/invite modals
- `app/admin/volunteers/[pubkey].tsx` — Volunteer detail
- `app/admin/bans.tsx` — Ban management with swipe-to-delete
- `app/admin/audit.tsx` — Paginated audit log with filters
- `app/admin/settings.tsx` — Collapsible settings sections
- `app/(tabs)/conversations.tsx` — Conversation list (tab)
- `app/conversation/[id].tsx` — Thread view with encrypted messages

### Components
- `src/components/PermissionGuard.tsx` — Permission-based UI gating
- `src/components/MessageBubble.tsx` — Inbound/outbound message display
- `src/components/MessageComposer.tsx` — Encrypted message input with send
- `src/components/VolunteerCard.tsx` — Volunteer list item with role badge
- `src/components/BanCard.tsx` — Swipeable ban list item
- `src/components/AuditEntry.tsx` — Audit log entry with category color
- `src/components/ChannelBadge.tsx` — Channel type indicator (SMS/WhatsApp/Signal/RCS)
- `src/components/ConversationCard.tsx` — Conversation list item with unread badge

### Shared Logic (ported from web)
- `src/lib/permissions.ts` — Copy from `src/shared/permissions.ts` (pure TypeScript)
- `src/hooks/usePermission.ts` — React Native permission hook
- `src/lib/messaging.ts` — Message encrypt/decrypt (port from crypto.ts)

### Dependencies to Install

```bash
npx expo install @gorhom/bottom-sheet react-native-gesture-handler react-native-reanimated
# (gesture-handler and reanimated likely already from Epic 83)
```

## Acceptance Criteria

- [ ] Admin screens only accessible to users with appropriate permissions (per domain)
- [ ] Can view, add (with keypair gen), invite, activate/deactivate, delete volunteers
- [ ] Phone reveal requires PIN challenge
- [ ] Invite link shareable via OS share sheet
- [ ] Can add single ban, bulk import bans, swipe-to-delete bans
- [ ] Audit log displays with paginated infinite scroll
- [ ] Audit log filters work (event type chips, date range, text search)
- [ ] Actor names resolved from volunteer list
- [ ] Settings sections expand/collapse with section-specific permission gates
- [ ] Conversation list shows waiting/active groups with channel badges
- [ ] Thread view decrypts messages and shows status icons
- [ ] Can send E2EE messages (ECIES envelope encryption works on RN)
- [ ] Claim/close/reassign conversation lifecycle works
- [ ] Real-time updates via Nostr relay (new messages, assignments)
- [ ] Unread message indicators on conversation list

## Dependencies

- **Epic 83** (Mobile Foundation) — auth, crypto (`@noble/*`), API client, key management
- **Epic 84** (Mobile Core Screens) — tab navigator, Nostr relay port, `useNostrSubscription()`
- **Epic 74** (E2EE Messaging Storage) — envelope encryption format (complete)
- **Epic 60** (Permission-Based Access Control) — permission catalog and role system (complete)
