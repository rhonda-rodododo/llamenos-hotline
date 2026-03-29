# React Query Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all manual `useState`/`useEffect` data fetching with `@tanstack/react-query`, integrating decryption into query functions and eliminating `DecryptCache`, `useDecryptedArray`, and `useDecryptedObject`.

**Architecture:** Resource-level query hooks (`useVolunteers()`, `useContacts()`, etc.) wrap `useQuery` with decrypt-in-queryFn. Mutations use `useMutation` with `invalidateQueries` for cache propagation. `QueryClientProvider` wraps the app root. Nostr real-time hooks push updates via `queryClient.setQueryData()` for calls/conversations, `invalidateQueries()` for low-frequency events. Key lock clears encrypted query caches; unlock triggers refetch.

**Tech Stack:** `@tanstack/react-query`, `@tanstack/react-query-devtools`, existing `cryptoWorker` singleton, existing `api.ts` functions, existing Nostr subscription hooks.

**Spec:** `docs/superpowers/specs/2026-03-29-react-query-refactor-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/client/lib/queries/keys.ts` | Query key factories for all resources |
| `src/client/lib/queries/volunteers.ts` | `useVolunteers`, `useVolunteer`, volunteer mutations |
| `src/client/lib/queries/invites.ts` | `useInvites`, `useInviteChannels`, invite mutations |
| `src/client/lib/queries/contacts.ts` | `useContacts`, `useContact`, contact mutations |
| `src/client/lib/queries/notes.ts` | `useNotes`, note mutations with encryption |
| `src/client/lib/queries/calls.ts` | `useCallHistory`, `useActiveCalls` (Nostr+REST), call actions |
| `src/client/lib/queries/shifts.ts` | `useShifts`, `useFallbackGroup`, `useShiftStatus`, shift mutations |
| `src/client/lib/queries/bans.ts` | `useBans`, ban mutations |
| `src/client/lib/queries/audit.ts` | `useAuditLog` |
| `src/client/lib/queries/reports.ts` | `useReports`, `useReportMessages`, report mutations |
| `src/client/lib/queries/blasts.ts` | `useBlasts`, blast mutations with decryption |
| `src/client/lib/queries/settings.ts` | `useSpamSettings`, `useCallSettings`, etc. + mutations |
| `src/client/lib/queries/hubs.ts` | `useHubs`, hub mutations |
| `src/client/lib/queries/conversations.ts` | `useConversations` (Nostr+REST), `useConversationMessages`, message mutations |
| `src/client/lib/queries/preferences.ts` | `usePreferences`, preference mutations |
| `src/client/lib/queries/analytics.ts` | `useCallAnalytics`, `useCallHours`, `useVolunteerStats` |
| `src/client/lib/queries/provider.ts` | `useProviderHealth`, provider-related queries |
| `src/client/lib/queries/roles.ts` | `useRoles`, `usePermissionsCatalog`, role mutations |
| `src/client/lib/query-client.ts` | QueryClient singleton, lock/unlock integration, provider setup |

### Modified Files

| File | Changes |
|------|---------|
| `src/client/routes/__root.tsx` | Add `QueryClientProvider` wrapper |
| `src/client/routes/volunteers.tsx` | Replace useState/useEffect with query hooks |
| `src/client/routes/contacts.tsx` | Same |
| `src/client/routes/notes.tsx` | Same |
| `src/client/routes/calls.tsx` | Same |
| `src/client/routes/audit.tsx` | Same |
| `src/client/routes/reports.tsx` | Same |
| `src/client/routes/bans.tsx` | Same |
| `src/client/routes/shifts.tsx` | Same |
| `src/client/routes/blasts.tsx` | Same |
| `src/client/routes/preferences.tsx` | Same |
| `src/client/routes/index.tsx` | Same (dashboard) |
| `src/client/routes/conversations.tsx` | Same |
| `src/client/routes/admin/settings.tsx` | Same |
| `src/client/routes/admin/hubs.tsx` | Same |
| `src/client/components/contacts/contact-select.tsx` | Replace useState/useEffect with `useContacts` |
| `src/client/components/ReassignDialog.tsx` | Replace useState/useEffect with query hooks |
| `src/client/components/volunteer-multi-select.tsx` | Replace `useDecryptedArray` with `useVolunteers` |
| `src/client/components/BlastSettingsPanel.tsx` | Replace with query hook |
| `src/client/components/admin-settings/provider-health-badge.tsx` | Replace polling with `useProviderHealth` |
| `src/client/components/admin-settings/roles-section.tsx` | Replace with `useRoles` |
| `src/client/components/SubscriberManager.tsx` | Replace with query hooks |
| `src/client/components/note-sheet.tsx` | Replace with query hooks |
| `src/client/components/ReportForm.tsx` | Replace with query hooks |
| `src/client/lib/hooks.ts` | Refactor `useCalls`/`useConversations` to use React Query + Nostr |

### Deleted Files

| File | Reason |
|------|--------|
| `src/client/lib/use-decrypted.ts` | Replaced by decrypt-in-queryFn pattern |

### Modified (partial deletion)

| File | Changes |
|------|---------|
| `src/client/lib/decrypt-fields.ts` | Remove `DecryptCache` class and `decryptCache` singleton. Keep `resolveEncryptedFields`, `decryptObjectFields`, `decryptArrayFields` (used by queryFns). |

---

## Task 1: Install Dependencies & Create QueryClient

**Files:**
- Modify: `package.json`
- Create: `src/client/lib/query-client.ts`
- Modify: `src/client/routes/__root.tsx`

- [ ] **Step 1: Install @tanstack/react-query**

```bash
cd ~/projects/llamenos-hotline-react-query && bun add @tanstack/react-query @tanstack/react-query-devtools
```

- [ ] **Step 2: Create query-client.ts**

```ts
// src/client/lib/query-client.ts
import { QueryClient } from '@tanstack/react-query'
import * as keyManager from './key-manager'

/**
 * Query keys for resources containing encrypted fields.
 * On key lock these caches are cleared; on unlock they're refetched.
 */
const ENCRYPTED_QUERY_KEYS = [
  'volunteers',
  'contacts',
  'notes',
  'calls',
  'audit',
  'blasts',
  'reports',
  'conversations',
  'invites',
] as const

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min default
      gcTime: 30 * 60 * 1000, // 30 min garbage collection
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

// --- Key lock/unlock cache management ---

keyManager.onLock(() => {
  for (const key of ENCRYPTED_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: [key] })
  }
})

keyManager.onUnlock(() => {
  for (const key of ENCRYPTED_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [key] })
  }
})
```

- [ ] **Step 3: Add QueryClientProvider to root layout**

In `src/client/routes/__root.tsx`, add the provider. Add these imports at the top:

```ts
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from '@/lib/query-client'
```

Then wrap the root content. Find the return statement in `RootLayout` and wrap it:

```ts
return (
  <QueryClientProvider client={queryClient}>
    <>
      <PanicWipeIndicator />
      <OfflineBanner />
      <ErrorBoundary scope="root">{content}</ErrorBoundary>
    </>
    {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
  </QueryClientProvider>
)
```

- [ ] **Step 4: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

Expected: Both pass — no existing code changed, just provider added.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add package.json bun.lockb src/client/lib/query-client.ts src/client/routes/__root.tsx && git commit -m "feat: add React Query infrastructure — QueryClient, provider, lock/unlock integration"
```

---

## Task 2: Create Query Key Factories

**Files:**
- Create: `src/client/lib/queries/keys.ts`

- [ ] **Step 1: Create the keys file**

```ts
// src/client/lib/queries/keys.ts

/**
 * Centralized query key factories for all API resources.
 *
 * Structured keys enable targeted cache invalidation:
 *   invalidateQueries({ queryKey: queryKeys.volunteers.all })  → all volunteer queries
 *   invalidateQueries({ queryKey: queryKeys.volunteers.list() }) → just the list
 */

export const queryKeys = {
  volunteers: {
    all: ['volunteers'] as const,
    list: () => ['volunteers', 'list'] as const,
    detail: (pubkey: string) => ['volunteers', 'detail', pubkey] as const,
  },
  invites: {
    all: ['invites'] as const,
    list: () => ['invites', 'list'] as const,
    channels: () => ['invites', 'channels'] as const,
  },
  contacts: {
    all: ['contacts'] as const,
    list: (filters?: { contactType?: string; riskLevel?: string }) =>
      ['contacts', 'list', filters] as const,
    detail: (id: string) => ['contacts', 'detail', id] as const,
  },
  notes: {
    all: ['notes'] as const,
    list: (filters?: { callId?: string; page?: number; limit?: number }) =>
      ['notes', 'list', filters] as const,
    detail: (id: string) => ['notes', 'detail', id] as const,
  },
  calls: {
    all: ['calls'] as const,
    active: () => ['calls', 'active'] as const,
    history: (filters?: {
      page?: number
      limit?: number
      search?: string
      dateFrom?: string
      dateTo?: string
      voicemailOnly?: boolean
    }) => ['calls', 'history', filters] as const,
    detail: (id: string) => ['calls', 'detail', id] as const,
    todayCount: () => ['calls', 'todayCount'] as const,
  },
  shifts: {
    all: ['shifts'] as const,
    list: () => ['shifts', 'list'] as const,
    fallback: () => ['shifts', 'fallback'] as const,
    myStatus: () => ['shifts', 'myStatus'] as const,
  },
  bans: {
    all: ['bans'] as const,
    list: () => ['bans', 'list'] as const,
  },
  audit: {
    all: ['audit'] as const,
    list: (filters?: {
      page?: number
      limit?: number
      actorPubkey?: string
      eventType?: string
      dateFrom?: string
      dateTo?: string
      search?: string
    }) => ['audit', 'list', filters] as const,
  },
  reports: {
    all: ['reports'] as const,
    list: (filters?: { status?: string; category?: string }) =>
      ['reports', 'list', filters] as const,
    messages: (reportId: string) => ['reports', 'messages', reportId] as const,
  },
  blasts: {
    all: ['blasts'] as const,
    list: () => ['blasts', 'list'] as const,
    settings: () => ['blasts', 'settings'] as const,
    subscribers: () => ['blasts', 'subscribers'] as const,
    subscriberStats: () => ['blasts', 'subscriberStats'] as const,
  },
  conversations: {
    all: ['conversations'] as const,
    list: () => ['conversations', 'list'] as const,
    messages: (conversationId: string) =>
      ['conversations', 'messages', conversationId] as const,
  },
  settings: {
    spam: () => ['settings', 'spam'] as const,
    call: () => ['settings', 'call'] as const,
    transcription: () => ['settings', 'transcription'] as const,
    ivrLanguages: () => ['settings', 'ivrLanguages'] as const,
    ivrAudio: () => ['settings', 'ivrAudio'] as const,
    webauthn: () => ['settings', 'webauthn'] as const,
    customFields: () => ['settings', 'customFields'] as const,
    provider: () => ['settings', 'provider'] as const,
    messaging: () => ['settings', 'messaging'] as const,
    geocoding: () => ['settings', 'geocoding'] as const,
    reportTypes: () => ['settings', 'reportTypes'] as const,
    retention: () => ['settings', 'retention'] as const,
  },
  hubs: {
    all: ['hubs'] as const,
    list: () => ['hubs', 'list'] as const,
  },
  preferences: {
    mine: () => ['preferences', 'mine'] as const,
  },
  analytics: {
    callVolume: (days: number) => ['analytics', 'callVolume', days] as const,
    callHours: () => ['analytics', 'callHours'] as const,
    volunteerStats: () => ['analytics', 'volunteerStats'] as const,
  },
  presence: {
    list: () => ['presence', 'list'] as const,
  },
  roles: {
    all: ['roles'] as const,
    list: () => ['roles', 'list'] as const,
    permissions: () => ['roles', 'permissions'] as const,
  },
  provider: {
    health: () => ['provider', 'health'] as const,
  },
} as const
```

- [ ] **Step 2: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck
```

Expected: Pass — new file, no consumers yet.

- [ ] **Step 3: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add src/client/lib/queries/keys.ts && git commit -m "feat: add query key factories for all API resources"
```

---

## Task 3: Volunteer Query Hooks + Migrate Volunteers Route

**Files:**
- Create: `src/client/lib/queries/volunteers.ts`
- Modify: `src/client/routes/volunteers.tsx`
- Modify: `src/client/components/volunteer-multi-select.tsx`

This is the template task — the pattern established here is repeated for all subsequent resources.

- [ ] **Step 1: Create volunteers query hooks**

```ts
// src/client/lib/queries/volunteers.ts
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type Volunteer,
  createVolunteer as apiCreateVolunteer,
  deleteVolunteer as apiDeleteVolunteer,
  getVolunteerUnmasked,
  listVolunteers,
  updateVolunteer as apiUpdateVolunteer,
} from '../api'
import { decryptArrayFields, decryptObjectFields } from '../decrypt-fields'
import * as keyManager from '../key-manager'
import { queryKeys } from './keys'

export function useVolunteers() {
  return useQuery({
    queryKey: queryKeys.volunteers.list(),
    queryFn: async () => {
      const { volunteers } = await listVolunteers()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          volunteers as Record<string, unknown>[],
          pubkey,
          LABEL_VOLUNTEER_PII
        )
      }
      return volunteers
    },
  })
}

export function useVolunteer(pubkey: string) {
  return useQuery({
    queryKey: queryKeys.volunteers.detail(pubkey),
    queryFn: async () => {
      const { volunteer } = await getVolunteerUnmasked(pubkey)
      const myPubkey = await keyManager.getPublicKeyHex()
      if (myPubkey && (await keyManager.isUnlocked())) {
        await decryptObjectFields(
          volunteer as Record<string, unknown>,
          myPubkey,
          LABEL_VOLUNTEER_PII
        )
      }
      return volunteer
    },
  })
}

export function useCreateVolunteer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      phone: string
      roleIds: string[]
      pubkey: string
    }) => apiCreateVolunteer(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.volunteers.all })
    },
  })
}

export function useUpdateVolunteer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      pubkey,
      data,
    }: {
      pubkey: string
      data: Partial<{ name: string; phone: string; roles: string[]; active: boolean }>
    }) => apiUpdateVolunteer(pubkey, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.volunteers.all })
    },
  })
}

export function useDeleteVolunteer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pubkey: string) => apiDeleteVolunteer(pubkey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.volunteers.all })
    },
  })
}
```

- [ ] **Step 2: Migrate volunteers.tsx**

Read the current file, then replace:
- Remove `useState` for `volunteers`, `loading`, `invites`, `roles` (keep UI-only state like `showAddForm`, `generatedNsec`, etc.)
- Remove `loadData` callback and its `useEffect`
- Remove `useDecryptedArray` import and calls
- Replace with query hook imports and calls

The route should import from `@/lib/queries/volunteers` and change the data fetching section to:

```ts
const { data: volunteers = [], isLoading: volsLoading } = useVolunteers()
const { data: invites = [], isLoading: invitesLoading } = useInvites()
const { data: roles = [] } = useRoles()
const isLoading = volsLoading || invitesLoading
```

Update mutation handlers to use `useMutation` hooks:
```ts
const createVolunteer = useCreateVolunteer()
const updateVolunteer = useUpdateVolunteer()
const deleteVolunteer = useDeleteVolunteer()
```

Replace inline `setVolunteers(prev => ...)` patterns with mutation calls — React Query handles the cache update via `invalidateQueries`.

- [ ] **Step 3: Migrate volunteer-multi-select.tsx**

This component receives volunteers as props and uses `useDecryptedArray`. Since the parent now passes decrypted volunteers (from `useVolunteers()`), remove the `useDecryptedArray` call — the data is already decrypted.

If the component fetches its own volunteer list, replace with `useVolunteers()`.

- [ ] **Step 4: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 5: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "feat: migrate volunteers route to React Query"
```

---

## Task 4: Invites Query Hooks

**Files:**
- Create: `src/client/lib/queries/invites.ts`

- [ ] **Step 1: Create invites query hooks**

```ts
// src/client/lib/queries/invites.ts
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type InviteCode,
  createInvite as apiCreateInvite,
  getAvailableInviteChannels,
  listInvites,
  revokeInvite as apiRevokeInvite,
  sendInvite as apiSendInvite,
} from '../api'
import { decryptArrayFields } from '../decrypt-fields'
import * as keyManager from '../key-manager'
import { queryKeys } from './keys'

export function useInvites() {
  return useQuery({
    queryKey: queryKeys.invites.list(),
    queryFn: async () => {
      const { invites } = await listInvites()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          invites as Record<string, unknown>[],
          pubkey,
          LABEL_VOLUNTEER_PII
        )
      }
      return invites
    },
  })
}

export function useInviteChannels() {
  return useQuery({
    queryKey: queryKeys.invites.channels(),
    queryFn: () => getAvailableInviteChannels(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useCreateInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; phone: string; roleIds: string[] }) =>
      apiCreateInvite(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invites.all })
    },
  })
}

export function useRevokeInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => apiRevokeInvite(code),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invites.all })
    },
  })
}

export function useSendInvite() {
  return useMutation({
    mutationFn: ({
      code,
      data,
    }: {
      code: string
      data: { recipientPhone: string; channel: string; acknowledgedInsecure?: boolean }
    }) => apiSendInvite(code, data),
  })
}
```

- [ ] **Step 2: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add src/client/lib/queries/invites.ts && git commit -m "feat: add invites query hooks"
```

---

## Task 5: Contacts Query Hooks + Migrate Contacts Route

**Files:**
- Create: `src/client/lib/queries/contacts.ts`
- Modify: `src/client/routes/contacts.tsx`
- Modify: `src/client/components/contacts/contact-select.tsx`
- Modify: `src/client/components/contacts/contact-relationship-section.tsx`

- [ ] **Step 1: Create contacts query hooks**

```ts
// src/client/lib/queries/contacts.ts
import { LABEL_CONTACT_SUMMARY } from '@shared/crypto-labels'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ContactRecord,
  createContact as apiCreateContact,
  listContacts,
  updateContact as apiUpdateContact,
} from '../api'
import { decryptArrayFields, decryptObjectFields } from '../decrypt-fields'
import * as keyManager from '../key-manager'
import { queryKeys } from './keys'

export function useContacts(filters?: { contactType?: string; riskLevel?: string }) {
  return useQuery({
    queryKey: queryKeys.contacts.list(filters),
    queryFn: async () => {
      const { contacts } = await listContacts(filters)
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          contacts as Record<string, unknown>[],
          pubkey,
          LABEL_CONTACT_SUMMARY
        )
      }
      return contacts
    },
  })
}

export function useCreateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiCreateContact>[0]) => apiCreateContact(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}

export function useUpdateContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Parameters<typeof apiUpdateContact>[1]
    }) => apiUpdateContact(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    },
  })
}
```

- [ ] **Step 2: Migrate contacts.tsx**

Replace:
- `useState` for `contacts`, `loading` → `useContacts()`
- Remove `useDecryptedArray(contacts, LABEL_CONTACT_SUMMARY)`
- Remove `fetchContacts` callback and `useEffect`
- Keep UI-only state (`searchInput`, `createOpen`)

- [ ] **Step 3: Migrate contact-select.tsx**

Replace its internal `useState` + `useEffect` + `listContacts` + `useDecryptedArray` pattern with `useContacts()`.

- [ ] **Step 4: Migrate contact-relationship-section.tsx**

Remove `useDecryptedArray` call — relationships come pre-decrypted from the parent's query hook.

- [ ] **Step 5: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 6: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "feat: migrate contacts route + components to React Query"
```

---

## Task 6: Notes Query Hooks + Migrate Notes Route

**Files:**
- Create: `src/client/lib/queries/notes.ts`
- Modify: `src/client/routes/notes.tsx`
- Modify: `src/client/components/note-sheet.tsx`

Notes have special decryption — they use `decryptNoteV2` / `decryptTranscription` / `decryptCallRecord` rather than the generic `decryptArrayFields`. The queryFn must replicate the existing decrypt logic from `loadNotes`.

- [ ] **Step 1: Create notes query hooks**

```ts
// src/client/lib/queries/notes.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type EncryptedNote,
  createNote as apiCreateNote,
  getCustomFields,
  listNotes,
  updateNote as apiUpdateNote,
} from '../api'
import type { CustomFieldDefinition } from '@shared/types'
import { decryptNoteV2, decryptTranscription } from '../crypto'
import * as keyManager from '../key-manager'
import { queryKeys } from './keys'

export interface DecryptedNote extends EncryptedNote {
  decrypted: string
  payload: { text: string; fields?: Record<string, unknown> }
  isTranscription: boolean
}

export function useNotes(filters?: {
  callId?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: queryKeys.notes.list(filters),
    queryFn: async () => {
      const res = await listNotes(filters)
      const isUnlocked = await keyManager.isUnlocked()
      const pubkey = await keyManager.getPublicKeyHex()
      const hasNsec = !!pubkey

      const decryptedNotes: DecryptedNote[] = []
      for (const note of res.notes) {
        const isTranscription = note.authorPubkey.startsWith('system:transcription')
        let payload: { text: string; fields?: Record<string, unknown> }

        if (isTranscription && note.ephemeralPubkey && hasNsec && isUnlocked) {
          const text =
            (await decryptTranscription(note.encryptedContent, note.ephemeralPubkey)) ||
            '[Decryption failed]'
          payload = { text }
        } else if (isTranscription && !note.ephemeralPubkey) {
          payload = { text: note.encryptedContent }
        } else if (hasNsec && isUnlocked && pubkey) {
          // Check admin envelopes first, then author envelope
          const envelope = note.adminEnvelopes?.find((e) => e.pubkey === pubkey) ??
            note.adminEnvelopes?.[0] ??
            note.authorEnvelope
          if (envelope) {
            payload = (await decryptNoteV2(note.encryptedContent, envelope)) || {
              text: '[Decryption failed]',
            }
          } else {
            payload = { text: '[Decryption failed]' }
          }
        } else {
          payload = { text: '[No key]' }
        }
        decryptedNotes.push({ ...note, decrypted: payload.text, payload, isTranscription })
      }
      return { notes: decryptedNotes, total: res.total }
    },
    staleTime: 2 * 60 * 1000,
  })
}

export function useCustomFields() {
  return useQuery({
    queryKey: queryKeys.settings.customFields(),
    queryFn: async () => {
      const { fields } = await getCustomFields()
      return fields as CustomFieldDefinition[]
    },
    staleTime: 10 * 60 * 1000,
  })
}

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiCreateNote>[0]) => apiCreateNote(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all })
    },
  })
}

export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Parameters<typeof apiUpdateNote>[1]
    }) => apiUpdateNote(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes.all })
    },
  })
}
```

- [ ] **Step 2: Migrate notes.tsx**

Replace:
- `useState` for `notes`, `total`, `loading`, `recentCalls`, `customFields`, `volunteers` → query hooks
- Remove `loadNotes` callback and its `useEffect`
- Remove `useDecryptedArray` calls for volunteers and recentCalls
- Remove manual decryption `useEffect` for call records
- Keep UI-only state (`editingId`, `showNewNote`, `saving`, `searchInput`)
- The `handleCreateNote` and `handleSaveEdit` functions now call `createNote.mutateAsync()` / `updateNote.mutateAsync()` instead of manual API calls + `setNotes` updates

- [ ] **Step 3: Migrate note-sheet.tsx**

Replace its internal `useEffect` + `Promise.all([getCustomFields, getCallHistory])` with `useCustomFields()` and `useCallHistory()`.

- [ ] **Step 4: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 5: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "feat: migrate notes route + note-sheet to React Query"
```

---

## Task 7: Calls Query Hooks + Migrate Calls Route

**Files:**
- Create: `src/client/lib/queries/calls.ts`
- Modify: `src/client/routes/calls.tsx`
- Modify: `src/client/lib/hooks.ts` — refactor `useCalls` to use React Query

- [ ] **Step 1: Create calls query hooks**

```ts
// src/client/lib/queries/calls.ts
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ActiveCall,
  type CallRecord,
  getCallHistory,
  getCallsTodayCount,
  getVolunteerPresence,
  listActiveCalls,
  listVolunteers,
} from '../api'
import { decryptArrayFields } from '../decrypt-fields'
import { decryptCallRecord } from '../crypto'
import * as keyManager from '../key-manager'
import { queryKeys } from './keys'

export function useCallHistory(filters?: {
  page?: number
  limit?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  voicemailOnly?: boolean
}) {
  return useQuery({
    queryKey: queryKeys.calls.history(filters),
    queryFn: async () => {
      const res = await getCallHistory(filters)
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        // Decrypt call metadata (answeredBy, callerNumber)
        for (const call of res.calls) {
          if (call.answeredBy !== undefined) continue
          if (!call.encryptedContent || !call.adminEnvelopes?.length) continue
          const meta = await decryptCallRecord(call.encryptedContent, call.adminEnvelopes, pubkey)
          if (meta) {
            Object.assign(call, { answeredBy: meta.answeredBy, callerNumber: meta.callerNumber })
          }
        }
        // Decrypt envelope fields (generic pattern)
        await decryptArrayFields(
          res.calls as Record<string, unknown>[],
          pubkey,
          LABEL_VOLUNTEER_PII
        )
      }
      return res
    },
    staleTime: 2 * 60 * 1000,
  })
}

export function useActiveCalls() {
  return useQuery({
    queryKey: queryKeys.calls.active(),
    queryFn: async () => {
      const { calls } = await listActiveCalls()
      return calls
    },
    staleTime: 0,
    refetchInterval: 30_000, // 30s fallback polling (Nostr is primary)
  })
}

export function useCallsTodayCount() {
  return useQuery({
    queryKey: queryKeys.calls.todayCount(),
    queryFn: async () => {
      const { count } = await getCallsTodayCount()
      return count
    },
    staleTime: 60 * 1000,
  })
}

export function usePresence() {
  return useQuery({
    queryKey: queryKeys.presence.list(),
    queryFn: async () => {
      const { volunteers } = await getVolunteerPresence()
      return volunteers
    },
    staleTime: 15 * 1000,
    refetchInterval: 15_000,
  })
}
```

- [ ] **Step 2: Refactor useCalls in hooks.ts**

Refactor `useCalls()` in `src/client/lib/hooks.ts` to use `useActiveCalls()` from React Query as the data store, with Nostr events pushing updates via `queryClient.setQueryData()`:

```ts
export function useCalls() {
  const queryClient = useQueryClient()
  const { data: calls = [] } = useActiveCalls()
  const [currentCall, setCurrentCall] = useState<ActiveCall | null>(null)
  const { currentHubId } = useConfig()
  const currentCallRef = useRef(currentCall)
  currentCallRef.current = currentCall

  // Nostr subscription pushes updates directly into React Query cache
  useNostrSubscription(currentHubId, CALL_KINDS, (_event, content: LlamenosEvent) => {
    if (content.type === 'call:ring') {
      queryClient.setQueryData<ActiveCall[]>(
        queryKeys.calls.active(),
        (prev = []) => {
          if (prev.some((c) => c.id === content.callId)) return prev
          return [...prev, content.call as ActiveCall]
        }
      )
      startRinging()
    } else if (content.type === 'call:update') {
      queryClient.setQueryData<ActiveCall[]>(
        queryKeys.calls.active(),
        (prev = []) => {
          const call = content.call as ActiveCall
          if (call.status === 'completed') {
            return prev.filter((c) => c.id !== call.id)
          }
          return prev.map((c) => (c.id === call.id ? call : c))
        }
      )
    }
    // ... rest of Nostr event handling unchanged
  })

  // ... answerCall, hangupCall, reportSpam callbacks unchanged
  // ... return unchanged
}
```

- [ ] **Step 3: Migrate calls.tsx**

Replace:
- `useState` for `calls`, `total`, `loading`, `volunteers` → `useCallHistory(filters)`, `useVolunteers()`
- Remove `fetchCalls` callback and `useEffect`
- Remove `useDecryptedArray` calls
- Remove manual call decryption `useEffect`
- Keep UI-only state (`searchInput`, date inputs)

- [ ] **Step 4: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 5: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "feat: migrate calls route + useCalls hook to React Query"
```

---

## Task 8: Shifts, Bans, Audit, Hubs Query Hooks + Migrate Routes

**Files:**
- Create: `src/client/lib/queries/shifts.ts`
- Create: `src/client/lib/queries/bans.ts`
- Create: `src/client/lib/queries/audit.ts`
- Create: `src/client/lib/queries/hubs.ts`
- Create: `src/client/lib/queries/roles.ts`
- Modify: `src/client/routes/shifts.tsx`
- Modify: `src/client/routes/bans.tsx`
- Modify: `src/client/routes/audit.tsx`
- Modify: `src/client/routes/admin/hubs.tsx`
- Modify: `src/client/components/admin-settings/roles-section.tsx`

These are straightforward CRUD resources without complex decryption (shifts/bans/hubs are not encrypted, audit has volunteer name decryption).

- [ ] **Step 1: Create shifts query hooks**

```ts
// src/client/lib/queries/shifts.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type Shift,
  type ShiftStatus,
  createShift as apiCreateShift,
  deleteShift as apiDeleteShift,
  getFallbackGroup,
  getMyShiftStatus,
  listShifts,
  setFallbackGroup as apiSetFallbackGroup,
  updateShift as apiUpdateShift,
} from '../api'
import { queryKeys } from './keys'

export function useShifts() {
  return useQuery({
    queryKey: queryKeys.shifts.list(),
    queryFn: async () => {
      const { shifts } = await listShifts()
      return shifts
    },
  })
}

export function useFallbackGroup() {
  return useQuery({
    queryKey: queryKeys.shifts.fallback(),
    queryFn: async () => {
      const { volunteers } = await getFallbackGroup()
      return volunteers
    },
  })
}

export function useShiftStatus() {
  return useQuery({
    queryKey: queryKeys.shifts.myStatus(),
    queryFn: () => getMyShiftStatus(),
    staleTime: 60 * 1000,
    refetchInterval: 60_000,
  })
}

export function useCreateShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<Shift, 'id'>) => apiCreateShift(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
    },
  })
}

export function useUpdateShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Shift> }) =>
      apiUpdateShift(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
    },
  })
}

export function useDeleteShift() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteShift(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all })
    },
  })
}

export function useSetFallbackGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (volunteers: string[]) => apiSetFallbackGroup(volunteers),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shifts.fallback() })
    },
  })
}
```

- [ ] **Step 2: Create bans query hooks**

```ts
// src/client/lib/queries/bans.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type BanEntry,
  addBan as apiAddBan,
  bulkAddBans as apiBulkAddBans,
  listBans,
  removeBan as apiRemoveBan,
} from '../api'
import { queryKeys } from './keys'

export function useBans() {
  return useQuery({
    queryKey: queryKeys.bans.list(),
    queryFn: async () => {
      const { bans } = await listBans()
      return bans
    },
  })
}

export function useAddBan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { phone: string; reason: string }) => apiAddBan(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.all })
    },
  })
}

export function useBulkAddBans() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { phones: string[]; reason: string }) => apiBulkAddBans(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.all })
    },
  })
}

export function useRemoveBan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (phone: string) => apiRemoveBan(phone),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bans.all })
    },
  })
}
```

- [ ] **Step 3: Create audit query hooks**

```ts
// src/client/lib/queries/audit.ts
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import { useQuery } from '@tanstack/react-query'
import { listAuditLog } from '../api'
import { decryptArrayFields } from '../decrypt-fields'
import * as keyManager from '../key-manager'
import { queryKeys } from './keys'

export function useAuditLog(filters?: {
  page?: number
  limit?: number
  actorPubkey?: string
  eventType?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}) {
  return useQuery({
    queryKey: queryKeys.audit.list(filters),
    queryFn: async () => {
      const res = await listAuditLog(filters)
      // Audit entries may have encrypted actor names
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          res.entries as Record<string, unknown>[],
          pubkey,
          LABEL_VOLUNTEER_PII
        )
      }
      return res
    },
    staleTime: 60 * 1000,
  })
}
```

- [ ] **Step 4: Create hubs query hooks**

```ts
// src/client/lib/queries/hubs.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveHub as apiArchiveHub,
  createHub as apiCreateHub,
  deleteHub as apiDeleteHub,
  listHubs,
  updateHub as apiUpdateHub,
} from '../api'
import { queryKeys } from './keys'

export function useHubs() {
  return useQuery({
    queryKey: queryKeys.hubs.list(),
    queryFn: async () => {
      const { hubs } = await listHubs()
      return hubs
    },
    staleTime: 10 * 60 * 1000,
  })
}

export function useCreateHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; description?: string; phoneNumber?: string }) =>
      apiCreateHub(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })
    },
  })
}

export function useUpdateHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiUpdateHub(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })
    },
  })
}

export function useDeleteHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteHub(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })
    },
  })
}

export function useArchiveHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiArchiveHub(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubs.all })
    },
  })
}
```

- [ ] **Step 5: Create roles query hooks**

```ts
// src/client/lib/queries/roles.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createRole as apiCreateRole,
  deleteRole as apiDeleteRole,
  getPermissionsCatalog,
  listRoles,
  updateRole as apiUpdateRole,
} from '../api'
import { queryKeys } from './keys'

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles.list(),
    queryFn: async () => {
      const { roles } = await listRoles()
      return roles
    },
  })
}

export function usePermissionsCatalog() {
  return useQuery({
    queryKey: queryKeys.roles.permissions(),
    queryFn: () => getPermissionsCatalog(),
    staleTime: Infinity,
  })
}

export function useCreateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiCreateRole>[0]) => apiCreateRole(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

export function useUpdateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof apiUpdateRole>[1] }) =>
      apiUpdateRole(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}

export function useDeleteRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRole(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
    },
  })
}
```

- [ ] **Step 6: Migrate shifts.tsx, bans.tsx, audit.tsx, admin/hubs.tsx, roles-section.tsx**

For each route:
- Remove `useState` for data + loading
- Remove `useEffect` fetch callbacks
- Remove `useDecryptedArray`/`useDecryptedObject` calls
- Replace with the corresponding query hooks
- Keep UI-only state (dialogs, forms, editing state)
- Replace mutation handlers with `useMutation` hook calls

- [ ] **Step 7: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 8: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "feat: migrate shifts, bans, audit, hubs, roles to React Query"
```

---

## Task 9: Reports & Conversations Query Hooks + Migrate Routes

**Files:**
- Create: `src/client/lib/queries/reports.ts`
- Create: `src/client/lib/queries/conversations.ts`
- Modify: `src/client/routes/reports.tsx`
- Modify: `src/client/routes/conversations.tsx`
- Modify: `src/client/components/ReassignDialog.tsx`
- Modify: `src/client/components/ReportForm.tsx`
- Modify: `src/client/components/ConversationThread.tsx`

Reports and conversations both involve encrypted message decryption and real-time updates.

- [ ] **Step 1: Create reports query hooks**

```ts
// src/client/lib/queries/reports.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type Report,
  type ConversationMessage,
  assignReport as apiAssignReport,
  getReportMessages,
  listReports,
  sendReportMessage as apiSendReportMessage,
  updateReport as apiUpdateReport,
} from '../api'
import { decryptMessage } from '../crypto'
import * as keyManager from '../key-manager'
import { queryKeys } from './keys'

export function useReports(filters?: { status?: string; category?: string }) {
  return useQuery({
    queryKey: queryKeys.reports.list(filters),
    queryFn: async () => {
      const { conversations } = await listReports(filters)
      return conversations
    },
    staleTime: 30 * 1000,
    refetchInterval: 30_000,
  })
}

export function useReportMessages(reportId: string | null) {
  return useQuery({
    queryKey: queryKeys.reports.messages(reportId ?? ''),
    queryFn: async () => {
      if (!reportId) return { messages: [], decryptedContent: new Map<string, string>() }
      const { messages } = await getReportMessages(reportId, { limit: 100 })

      // Decrypt message content
      const pubkey = await keyManager.getPublicKeyHex()
      const decryptedContent = new Map<string, string>()
      if (pubkey && (await keyManager.isUnlocked())) {
        for (const msg of messages) {
          if (msg.encryptedContent && msg.readerEnvelopes?.length) {
            const plaintext = await decryptMessage(
              msg.encryptedContent,
              msg.readerEnvelopes,
              pubkey
            )
            if (plaintext !== null) {
              decryptedContent.set(msg.id, plaintext)
            }
          }
        }
      }
      return { messages, decryptedContent }
    },
    enabled: !!reportId,
    staleTime: 10 * 1000,
    refetchInterval: 10_000,
  })
}

export function useSendReportMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      reportId,
      data,
    }: {
      reportId: string
      data: Parameters<typeof apiSendReportMessage>[1]
    }) => apiSendReportMessage(reportId, data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reports.messages(variables.reportId),
      })
    },
  })
}

export function useUpdateReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      reportId,
      data,
    }: {
      reportId: string
      data: { status?: string }
    }) => apiUpdateReport(reportId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
    },
  })
}

export function useAssignReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reportId, pubkey }: { reportId: string; pubkey: string }) =>
      apiAssignReport(reportId, pubkey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
    },
  })
}
```

- [ ] **Step 2: Create conversations query hooks**

```ts
// src/client/lib/queries/conversations.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type Conversation,
  type ConversationMessage,
  claimConversation as apiClaimConversation,
  getConversationMessages,
  listConversations,
  sendConversationMessage as apiSendMessage,
  updateConversation as apiUpdateConversation,
} from '../api'
import { decryptMessage } from '../crypto'
import { decryptArrayFields } from '../decrypt-fields'
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import * as keyManager from '../key-manager'
import { queryKeys } from './keys'

export function useConversationsList() {
  return useQuery({
    queryKey: queryKeys.conversations.list(),
    queryFn: async () => {
      const { conversations } = await listConversations()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(
          conversations as Record<string, unknown>[],
          pubkey,
          LABEL_VOLUNTEER_PII
        )
      }
      return conversations
    },
    staleTime: 0,
    refetchInterval: 30_000,
  })
}

export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.conversations.messages(conversationId ?? ''),
    queryFn: async () => {
      if (!conversationId) return { messages: [], decryptedContent: new Map<string, string>() }
      const { messages } = await getConversationMessages(conversationId, { limit: 100 })

      const pubkey = await keyManager.getPublicKeyHex()
      const decryptedContent = new Map<string, string>()
      if (pubkey && (await keyManager.isUnlocked())) {
        for (const msg of messages) {
          if (msg.encryptedContent && msg.readerEnvelopes?.length) {
            const plaintext = await decryptMessage(
              msg.encryptedContent,
              msg.readerEnvelopes,
              pubkey
            )
            if (plaintext !== null) {
              decryptedContent.set(msg.id, plaintext)
            }
          }
        }
      }
      return { messages, decryptedContent }
    },
    enabled: !!conversationId,
    staleTime: 0,
  })
}

export function useSendConversationMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      conversationId,
      data,
    }: {
      conversationId: string
      data: Parameters<typeof apiSendMessage>[1]
    }) => apiSendMessage(conversationId, data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(variables.conversationId),
      })
    },
  })
}

export function useClaimConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (conversationId: string) => apiClaimConversation(conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
  })
}

export function useUpdateConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      conversationId,
      data,
    }: {
      conversationId: string
      data: { status?: string; assignedTo?: string }
    }) => apiUpdateConversation(conversationId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
  })
}
```

- [ ] **Step 3: Refactor useConversations in hooks.ts**

Similar to `useCalls`, refactor to use React Query as data store with Nostr events pushing via `setQueryData`:

```ts
export function useConversations() {
  const queryClient = useQueryClient()
  const { data: conversations = [] } = useConversationsList()
  const { currentHubId } = useConfig()

  useNostrSubscription(currentHubId, CONVERSATION_KINDS, (_event, content: LlamenosEvent) => {
    if (content.type === 'conversation:new' || content.type === 'conversation:assigned') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.list() })
    } else if (content.type === 'message:new') {
      // Invalidate messages for the specific conversation
      if (content.conversationId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.messages(content.conversationId),
        })
      }
    }
  })

  return { conversations }
}
```

- [ ] **Step 4: Migrate reports.tsx, conversations.tsx, ReassignDialog.tsx, ReportForm.tsx**

For each:
- Replace `useState` + `useEffect` fetch patterns with query hooks
- Replace manual polling intervals with `refetchInterval`
- Replace `setMessages(prev => [...])` with mutation + invalidation
- Remove `useDecryptedArray` calls

- [ ] **Step 5: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 6: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "feat: migrate reports, conversations to React Query"
```

---

## Task 10: Blasts, Settings, Preferences, Analytics Query Hooks + Migrate Routes

**Files:**
- Create: `src/client/lib/queries/blasts.ts`
- Create: `src/client/lib/queries/settings.ts`
- Create: `src/client/lib/queries/preferences.ts`
- Create: `src/client/lib/queries/analytics.ts`
- Create: `src/client/lib/queries/provider.ts`
- Modify: `src/client/routes/blasts.tsx`
- Modify: `src/client/routes/preferences.tsx`
- Modify: `src/client/routes/admin/settings.tsx`
- Modify: `src/client/routes/index.tsx` (dashboard)
- Modify: `src/client/components/BlastSettingsPanel.tsx`
- Modify: `src/client/components/SubscriberManager.tsx`
- Modify: `src/client/components/admin-settings/provider-health-badge.tsx`

- [ ] **Step 1: Create blasts query hooks**

```ts
// src/client/lib/queries/blasts.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type Blast,
  cancelBlast as apiCancelBlast,
  deleteBlast as apiDeleteBlast,
  getBlastSettings,
  getSubscriberStats,
  listBlasts,
  listSubscribers,
  sendBlast as apiSendBlast,
  updateBlastSettings as apiUpdateBlastSettings,
} from '../api'
import { decryptBlastContent } from '../crypto'
import type { BlastContent } from '@shared/types'
import * as keyManager from '../key-manager'
import { queryKeys } from './keys'

export function useBlasts() {
  return useQuery({
    queryKey: queryKeys.blasts.list(),
    queryFn: async () => {
      const { blasts } = await listBlasts()

      // Decrypt blast content
      const isUnlocked = await keyManager.isUnlocked()
      if (!isUnlocked) return { blasts, decryptedContent: {} as Record<string, BlastContent | null> }

      const pk = await keyManager.getPublicKeyHex()
      if (!pk) return { blasts, decryptedContent: {} as Record<string, BlastContent | null> }

      const decryptedContent: Record<string, BlastContent | null> = {}
      for (const blast of blasts) {
        if (blast.encryptedContent && blast.contentEnvelopes?.length) {
          decryptedContent[blast.id] = await decryptBlastContent(
            blast.encryptedContent,
            blast.contentEnvelopes,
            pk
          )
        }
      }
      return { blasts, decryptedContent }
    },
  })
}

export function useBlastSettings() {
  return useQuery({
    queryKey: queryKeys.blasts.settings(),
    queryFn: () => getBlastSettings(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useSubscribers() {
  return useQuery({
    queryKey: queryKeys.blasts.subscribers(),
    queryFn: async () => {
      const { subscribers } = await listSubscribers()
      return subscribers
    },
  })
}

export function useSubscriberStats() {
  return useQuery({
    queryKey: queryKeys.blasts.subscriberStats(),
    queryFn: () => getSubscriberStats(),
  })
}

export function useSendBlast() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiSendBlast(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.all })
    },
  })
}

export function useDeleteBlast() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteBlast(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.all })
    },
  })
}

export function useCancelBlast() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiCancelBlast(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.all })
    },
  })
}

export function useUpdateBlastSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiUpdateBlastSettings>[0]) =>
      apiUpdateBlastSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blasts.settings() })
    },
  })
}
```

- [ ] **Step 2: Create settings query hooks**

```ts
// src/client/lib/queries/settings.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getCallSettings,
  getCustomFields,
  getGeocodingConfig,
  getIvrAudioRecordings,
  getIvrLanguages,
  getMessagingConfig,
  getProviderConfig,
  getRetentionSettings,
  getSpamSettings,
  getTranscriptionSettings,
  getWebAuthnSettings,
  listReportTypes,
  updateCallSettings as apiUpdateCallSettings,
  updateCustomFields as apiUpdateCustomFields,
  updateGeocodingConfig as apiUpdateGeocodingConfig,
  updateIvrLanguages as apiUpdateIvrLanguages,
  updateMessagingConfig as apiUpdateMessagingConfig,
  updateRetentionSettings as apiUpdateRetentionSettings,
  updateSpamSettings as apiUpdateSpamSettings,
  updateTranscriptionSettings as apiUpdateTranscriptionSettings,
  updateWebAuthnSettings as apiUpdateWebAuthnSettings,
} from '../api'
import { queryKeys } from './keys'

export function useSpamSettings() {
  return useQuery({
    queryKey: queryKeys.settings.spam(),
    queryFn: () => getSpamSettings(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useCallSettings() {
  return useQuery({
    queryKey: queryKeys.settings.call(),
    queryFn: () => getCallSettings(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useTranscriptionSettings() {
  return useQuery({
    queryKey: queryKeys.settings.transcription(),
    queryFn: () => getTranscriptionSettings(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useIvrLanguages() {
  return useQuery({
    queryKey: queryKeys.settings.ivrLanguages(),
    queryFn: async () => {
      const { enabledLanguages } = await getIvrLanguages()
      return enabledLanguages
    },
    staleTime: 10 * 60 * 1000,
  })
}

export function useWebAuthnSettings() {
  return useQuery({
    queryKey: queryKeys.settings.webauthn(),
    queryFn: () => getWebAuthnSettings(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useProviderConfig() {
  return useQuery({
    queryKey: queryKeys.settings.provider(),
    queryFn: () => getProviderConfig(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useMessagingConfig() {
  return useQuery({
    queryKey: queryKeys.settings.messaging(),
    queryFn: () => getMessagingConfig(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useGeocodingConfig() {
  return useQuery({
    queryKey: queryKeys.settings.geocoding(),
    queryFn: () => getGeocodingConfig(),
    staleTime: 10 * 60 * 1000,
  })
}

export function useReportTypes() {
  return useQuery({
    queryKey: queryKeys.settings.reportTypes(),
    queryFn: async () => {
      const { reportTypes } = await listReportTypes()
      return reportTypes
    },
    staleTime: 10 * 60 * 1000,
  })
}

// --- Mutations ---

export function useUpdateSpamSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiUpdateSpamSettings>[0]) =>
      apiUpdateSpamSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.spam() })
    },
  })
}

export function useUpdateCallSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiUpdateCallSettings>[0]) =>
      apiUpdateCallSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.call() })
    },
  })
}

export function useUpdateTranscriptionSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiUpdateTranscriptionSettings>[0]) =>
      apiUpdateTranscriptionSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.transcription() })
    },
  })
}

export function useUpdateIvrLanguages() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { enabledLanguages: string[] }) => apiUpdateIvrLanguages(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.ivrLanguages() })
    },
  })
}

export function useUpdateWebAuthnSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiUpdateWebAuthnSettings>[0]) =>
      apiUpdateWebAuthnSettings(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.webauthn() })
    },
  })
}
```

- [ ] **Step 3: Create preferences query hooks**

```ts
// src/client/lib/queries/preferences.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getSubscriberPreferences,
  updateSubscriberPreferences as apiUpdatePreferences,
} from '../api'
import { queryKeys } from './keys'

export function usePreferences() {
  return useQuery({
    queryKey: queryKeys.preferences.mine(),
    queryFn: () => getSubscriberPreferences(),
    staleTime: Infinity,
  })
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiUpdatePreferences>[0]) =>
      apiUpdatePreferences(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.preferences.mine() })
    },
  })
}
```

- [ ] **Step 4: Create analytics query hooks**

```ts
// src/client/lib/queries/analytics.ts
import { useQuery } from '@tanstack/react-query'
import {
  getCallAnalytics,
  getCallHoursAnalytics,
  getVolunteerStats,
} from '../api'
import { queryKeys } from './keys'

export function useCallAnalytics(days: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics.callVolume(days),
    queryFn: async () => {
      const { data } = await getCallAnalytics(days)
      return data
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCallHoursAnalytics(enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics.callHours(),
    queryFn: async () => {
      const { data } = await getCallHoursAnalytics()
      return data
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useVolunteerStatsAnalytics(enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics.volunteerStats(),
    queryFn: async () => {
      const { data } = await getVolunteerStats()
      return data
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}
```

- [ ] **Step 5: Create provider query hooks**

```ts
// src/client/lib/queries/provider.ts
import { useQuery } from '@tanstack/react-query'
import { getProviderHealth } from '../api'
import { queryKeys } from './keys'

export function useProviderHealth() {
  return useQuery({
    queryKey: queryKeys.provider.health(),
    queryFn: () => getProviderHealth(),
    staleTime: 30 * 1000,
    refetchInterval: 30_000,
  })
}
```

- [ ] **Step 6: Migrate blasts.tsx, preferences.tsx, admin/settings.tsx, dashboard (index.tsx), BlastSettingsPanel.tsx, SubscriberManager.tsx, provider-health-badge.tsx**

For each route/component:
- Replace `useState` + `useEffect` + manual fetch with query hooks
- Replace manual polling with `refetchInterval`
- Replace mutation handlers with `useMutation` hooks
- Remove `useDecryptedArray`/`useDecryptedObject` calls
- Keep UI-only state

Dashboard (`index.tsx`) specifics:
- `callsToday` → `useCallsTodayCount()`
- `presence` → `usePresence()`
- `volunteers` → `useVolunteers()`
- Analytics data → `useCallAnalytics(days, enabled)`, `useCallHoursAnalytics(enabled)`, `useVolunteerStatsAnalytics(enabled)` with `enabled` gated by `analyticsOpen`
- `useCalls()` and `useShiftStatus()` stay but now use React Query internally

- [ ] **Step 7: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 8: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "feat: migrate blasts, settings, preferences, analytics, dashboard to React Query"
```

---

## Task 11: Remove Dead Code — DecryptCache + useDecrypted Hooks

**Files:**
- Delete: `src/client/lib/use-decrypted.ts`
- Modify: `src/client/lib/decrypt-fields.ts` — remove `DecryptCache` class and `decryptCache` export

- [ ] **Step 1: Verify no remaining imports of useDecryptedArray/useDecryptedObject**

```bash
cd ~/projects/llamenos-hotline-react-query && grep -r "useDecryptedArray\|useDecryptedObject\|use-decrypted" src/client/ --include="*.ts" --include="*.tsx"
```

Expected: Only the definition file itself. If any consumers remain, migrate them first.

- [ ] **Step 2: Verify no remaining imports of decryptCache**

```bash
cd ~/projects/llamenos-hotline-react-query && grep -r "decryptCache" src/client/ --include="*.ts" --include="*.tsx"
```

Expected: Only `decrypt-fields.ts` itself. The `query-client.ts` lock callback no longer needs `decryptCache.clear()` — React Query's `removeQueries` handles it.

- [ ] **Step 3: Delete use-decrypted.ts**

```bash
cd ~/projects/llamenos-hotline-react-query && rm src/client/lib/use-decrypted.ts
```

- [ ] **Step 4: Remove DecryptCache from decrypt-fields.ts**

Remove the `DecryptCache` class definition, the `decryptCache` singleton export, and the cache reads/writes inside `decryptObjectFields`. The function should call the worker directly without caching (the worker has its own internal cache):

```ts
export async function decryptObjectFields<T extends Record<string, unknown>>(
  obj: T,
  readerPubkey: string,
  label: string = LABEL_VOLUNTEER_PII
): Promise<T> {
  const refs = resolveEncryptedFields(obj, readerPubkey)
  if (refs.length === 0) return obj

  const worker = getCryptoWorker()

  await Promise.all(
    refs.map(async ({ plaintextKey, ciphertext, envelope }) => {
      try {
        const plaintext = await worker.decryptEnvelopeField(
          ciphertext,
          envelope.ephemeralPubkey,
          envelope.wrappedKey,
          label
        )
        ;(obj as Record<string, unknown>)[plaintextKey] = plaintext
      } catch {
        // Leave field as-is (placeholder value from server)
      }
    })
  )

  return obj
}
```

- [ ] **Step 5: Remove decryptCache.clear() from query-client.ts lock callback if present**

The lock callback should only call `queryClient.removeQueries()` — no `decryptCache.clear()`.

- [ ] **Step 6: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 7: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "refactor: remove DecryptCache, useDecryptedArray, useDecryptedObject — replaced by React Query"
```

---

## Task 12: Migrate Remaining Components

**Files:**
- Modify: `src/client/components/admin-settings/` — all settings section components that import from `../api`
- Modify: `src/client/components/FilePreview.tsx` (if applicable — file downloads may stay as direct fetches)
- Modify: `src/client/components/voicemail-player.tsx`
- Modify: `src/client/components/setup/StepInvite.tsx`

- [ ] **Step 1: Audit remaining direct api imports in components**

```bash
cd ~/projects/llamenos-hotline-react-query && grep -rn "from.*['\"]@/lib/api['\"]" src/client/components/ --include="*.tsx" | grep -v "type "
```

For each result, determine:
- If the component only does mutations (settings sections) → replace with `useMutation` from the relevant query hook file
- If it fetches on mount → replace with a query hook
- If it's a one-off download (FilePreview) → leave as direct fetch (not a cache concern)

- [ ] **Step 2: Migrate settings section components**

Components like `spam-section.tsx`, `call-settings-section.tsx`, `passkey-policy-section.tsx` etc. — these receive settings data via props from `admin/settings.tsx` (which now uses query hooks) and only do mutations. Replace their inline `updateSpamSettings()` calls with `useUpdateSpamSettings().mutateAsync()`.

- [ ] **Step 3: Migrate StepInvite.tsx**

Replace its local invite state with `useInvites()` and `useCreateInvite()`.

- [ ] **Step 4: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 5: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "feat: migrate remaining components to React Query mutations"
```

---

## Task 13: Update useShiftStatus in hooks.ts

**Files:**
- Modify: `src/client/lib/hooks.ts`

The `useShiftStatus` hook in `hooks.ts` uses manual polling. Replace with the React Query version.

- [ ] **Step 1: Replace useShiftStatus in hooks.ts**

Remove the manual `useState` + `useEffect` + `setInterval` implementation of `useShiftStatus()` from `hooks.ts`. Re-export from the query hooks:

```ts
// In hooks.ts, replace the useShiftStatus function with:
export { useShiftStatus } from './queries/shifts'
```

Or if the existing `useShiftStatus` in hooks.ts has additional derived state (like `onShift`, `currentShift`, `nextShift`), create a wrapper:

```ts
export function useShiftStatus() {
  const { data: status } = useShiftStatusQuery()
  return {
    onShift: status?.onShift ?? false,
    currentShift: status?.currentShift ?? null,
    nextShift: status?.nextShift ?? null,
  }
}
```

Where `useShiftStatusQuery` is the React Query hook from `queries/shifts.ts`.

- [ ] **Step 2: Verify build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "refactor: replace useShiftStatus polling with React Query"
```

---

## Task 14: Run E2E Tests

**Files:** None modified — verification only.

- [ ] **Step 1: Start backing services**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run dev:docker
```

- [ ] **Step 2: Run unit tests**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run test:unit
```

Expected: All pass. Query hooks aren't unit-tested yet but existing unit tests should still pass.

- [ ] **Step 3: Run API integration tests**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run test:api
```

Expected: All pass — server endpoints unchanged.

- [ ] **Step 4: Run UI E2E tests**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run test:e2e
```

Expected: All pass — user-visible behavior unchanged. This is the critical validation that the migration didn't break anything.

- [ ] **Step 5: Fix any failures**

If E2E tests fail, investigate and fix. Common causes:
- Loading state timing changes (React Query's loading is slightly different from manual useState)
- Missing `data-testid` attributes in refactored JSX
- Query hooks not firing because `enabled` condition is wrong

- [ ] **Step 6: Commit fixes if any**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "fix: resolve E2E test issues from React Query migration"
```

---

## Task 15: Add Query Hook Unit Tests

**Files:**
- Create: `src/client/lib/queries/keys.test.ts`
- Create: `src/client/lib/queries/volunteers.test.ts`

- [ ] **Step 1: Test query key factories**

```ts
// src/client/lib/queries/keys.test.ts
import { describe, expect, test } from 'bun:test'
import { queryKeys } from './keys'

describe('queryKeys', () => {
  test('volunteers.all is stable', () => {
    expect(queryKeys.volunteers.all).toEqual(['volunteers'])
  })

  test('volunteers.list returns consistent key', () => {
    expect(queryKeys.volunteers.list()).toEqual(['volunteers', 'list'])
  })

  test('volunteers.detail includes pubkey', () => {
    expect(queryKeys.volunteers.detail('abc123')).toEqual(['volunteers', 'detail', 'abc123'])
  })

  test('notes.list includes filters in key', () => {
    const filters = { callId: 'call-1', page: 2, limit: 10 }
    const key = queryKeys.notes.list(filters)
    expect(key).toEqual(['notes', 'list', filters])
  })

  test('calls.history with different filters produces different keys', () => {
    const key1 = queryKeys.calls.history({ page: 1 })
    const key2 = queryKeys.calls.history({ page: 2 })
    expect(key1).not.toEqual(key2)
  })

  test('settings keys are stable', () => {
    expect(queryKeys.settings.spam()).toEqual(['settings', 'spam'])
    expect(queryKeys.settings.call()).toEqual(['settings', 'call'])
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd ~/projects/llamenos-hotline-react-query && bun test src/client/lib/queries/keys.test.ts
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "test: add query key factory unit tests"
```

---

## Task 16: Final Cleanup & Documentation

**Files:**
- Modify: `docs/NEXT_BACKLOG.md` — mark React Query refactor as complete
- Modify: `docs/COMPLETED_BACKLOG.md` — add entry

- [ ] **Step 1: Final grep for dead imports**

```bash
cd ~/projects/llamenos-hotline-react-query && grep -rn "use-decrypted\|DecryptCache\|decryptCache" src/client/ --include="*.ts" --include="*.tsx"
```

Expected: No results (all removed).

```bash
cd ~/projects/llamenos-hotline-react-query && grep -rn "useDecryptedArray\|useDecryptedObject" src/client/ --include="*.ts" --include="*.tsx"
```

Expected: No results.

- [ ] **Step 2: Final typecheck + build**

```bash
cd ~/projects/llamenos-hotline-react-query && bun run typecheck && bun run build
```

Expected: Both pass.

- [ ] **Step 3: Update backlog**

Add to `docs/COMPLETED_BACKLOG.md`:
```markdown
## React Query Refactor (2026-03-29)
- [x] Replace all useState/useEffect fetch patterns with @tanstack/react-query
- [x] Integrate decryption into queryFn — single async pipeline
- [x] Eliminate DecryptCache, useDecryptedArray, useDecryptedObject
- [x] Resource-level hooks: useVolunteers, useContacts, useNotes, etc.
- [x] Mutation hooks with automatic cache invalidation
- [x] Nostr real-time events push into React Query cache
- [x] Key lock/unlock clears/refetches encrypted caches
- [x] Query key factories for targeted invalidation
```

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llamenos-hotline-react-query && git add -A && git commit -m "chore: finalize React Query refactor — cleanup dead code, update backlog"
```
