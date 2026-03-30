# React Query Refactor — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Branch:** `feat/react-query-refactor` (based on `feat/idp-auth-hardening`)

## Problem

The client-side data fetching layer uses manual `useState` + `useEffect` + `fetch` across ~15 routes, each independently managing loading states, error handling, caching, and refetching. This creates three concrete problems:

### 1. Decrypt-on-Fetch Incoherence

The decrypt-on-fetch architecture (`useDecryptedArray`/`useDecryptedObject`) layers async Web Worker decryption on top of async data fetching as two independent async systems. The fetch lands in `useState`, then the decrypt hook runs a separate async effect. This causes:

- Data renders with `[encrypted]` placeholders, then re-renders with decrypted values (visible flash)
- Race conditions when the crypto worker isn't ready when data arrives
- `DecryptCache` is a separate global `Map` that doesn't coordinate with component lifecycle

### 2. Boilerplate and Subtle Bugs

Every route repeats:
```ts
const [data, setData] = useState<Type[]>([])
const [loading, setLoading] = useState(true)
useEffect(() => {
  fetchData().then(setData).catch(...).finally(() => setLoading(false))
}, [deps])
```

This is repeated ~20 times with subtle variations. Some forget error handling, some don't handle unmount races, some refetch on navigation but others don't.

### 3. No Cache Invalidation After Mutations

When an admin creates a volunteer, updates a shift, or saves settings, the current code manually calls `setVolunteers(prev => [...prev, newVol])`. But other components showing the same data (sidebar volunteer count, shift assignment dropdown) don't update until a page reload.

## Goals

1. Replace all `useState` + `useEffect` fetch patterns with `@tanstack/react-query`.
2. Integrate decryption into the query function — single async pipeline, single loading state.
3. Automatic cache invalidation after mutations propagates to all consumers.
4. Eliminate `DecryptCache`, `useDecryptedArray`, and `useDecryptedObject`.
5. Stale-while-revalidate and background refetching for responsive UX.
6. Request deduplication — multiple components requesting the same resource share one fetch.

## Non-Goals

- Changing the server API or response shapes.
- Modifying the crypto worker architecture (keys stay in worker closure).
- Adding React Suspense boundaries (can be done later on top of this).
- Changing the Nostr relay architecture.

## Architecture Decisions

### Decrypt-in-queryFn

Decryption happens inside the `queryFn`. The query function fetches encrypted data from the API, calls `cryptoWorker.decryptEnvelopeField()` (async postMessage to the worker), and returns decrypted data. React Query caches the decrypted result.

**Why not dual-layer (encrypted cache + select transform)?** `select` is synchronous — it can't call the async crypto worker. A wrapper hook approach would work but adds triple render cycles (loading → encrypted → decrypted), worker serialization bottleneck concerns, and blocks Suspense compatibility. Since the main thread already receives plaintext for rendering regardless of approach, the marginal security difference of keeping React Query's cache encrypted doesn't justify the complexity.

**Secret keys never leave the worker.** The `queryFn` calls `cryptoWorker.decryptEnvelopeField()` which is an async postMessage to the worker. The worker holds the nsec in closure, decrypts, and returns plaintext. Only the plaintext result crosses the boundary — same as today.

### Lock/Unlock Cache Management

On **key lock**: `queryClient.removeQueries()` for all resources with encrypted fields. Non-sensitive queries (settings, shifts, bans, hubs) stay cached.

On **key unlock**: `queryClient.invalidateQueries()` for the cleared resources, triggering refetch + re-decrypt.

```ts
const ENCRYPTED_QUERY_KEYS = [
  "volunteers", "contacts", "notes", "calls",
  "audit", "blasts", "reports", "conversations"
]

keyManager.onLock(() => {
  ENCRYPTED_QUERY_KEYS.forEach(key =>
    queryClient.removeQueries({ queryKey: [key] })
  )
})

keyManager.onUnlock(() => {
  ENCRYPTED_QUERY_KEYS.forEach(key =>
    queryClient.invalidateQueries({ queryKey: [key] })
  )
})
```

### Nostr + React Query Integration

**Calls and conversations** (high-frequency real-time):
- Nostr events update the cache directly via `queryClient.setQueryData()`.
- REST polling remains as fallback at a longer interval (30s instead of 8s).
- Hooks combine `useQuery` (initial REST load) with `useNostrSubscription` (live updates pushed into cache).

**Low-frequency mutations** (volunteer added, settings changed, shift updated):
- Nostr events call `queryClient.invalidateQueries()` to trigger a refetch.
- No direct cache manipulation needed — rare enough that a round trip is fine.

### Migration Strategy

**Big bang** — all ~15 routes migrated in one branch. No coexistence of old and new patterns. Pre-production with no users, no reason to carry transitional state.

## Infrastructure

### Dependencies

- `@tanstack/react-query` — core library
- `@tanstack/react-query-devtools` — dev-only inspector

### QueryClient Configuration

New file: `src/client/lib/query-client.ts`

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,     // 5 min default
      gcTime: 30 * 60 * 1000,       // 30 min garbage collection
      retry: 2,                      // exponential backoff
      refetchOnWindowFocus: true,
    },
  },
})
```

`QueryClientProvider` wraps the app in the root layout alongside existing `AuthProvider` and `HubProvider`.

DevTools included in dev mode only behind `import.meta.env.DEV`.

## Query Hook Architecture

### Directory Structure

```
src/client/lib/queries/
├── keys.ts          # All query key factories
├── volunteers.ts    # useVolunteers, useVolunteer(pubkey), mutations
├── contacts.ts      # useContacts, useContact(id), mutations
├── notes.ts         # useNotes(filters), useNote(id), mutations
├── calls.ts         # useCalls(filters), useCall(id) — REST history
├── shifts.ts        # useShifts, mutations
├── bans.ts          # useBans, mutations
├── audit.ts         # useAuditLog(filters)
├── reports.ts       # useReports(filters), useReportMessages(id), mutations
├── blasts.ts        # useBlasts, mutations
├── settings.ts      # useSpamSettings, useCallSettings, etc. + mutations
├── hubs.ts          # useHubs, mutations
├── conversations.ts # useConversations — Nostr primary, REST fallback
└── preferences.ts   # usePreferences, mutations
```

### Query Key Factory

Structured keys enable targeted invalidation:

```ts
export const queryKeys = {
  volunteers: {
    all: ["volunteers"] as const,
    list: (filters?: VolunteerFilters) => ["volunteers", "list", filters] as const,
    detail: (pubkey: string) => ["volunteers", "detail", pubkey] as const,
  },
  notes: {
    all: ["notes"] as const,
    list: (filters?: NoteFilters) => ["notes", "list", filters] as const,
    detail: (id: string) => ["notes", "detail", id] as const,
  },
  contacts: {
    all: ["contacts"] as const,
    list: (filters?: ContactFilters) => ["contacts", "list", filters] as const,
    detail: (id: string) => ["contacts", "detail", id] as const,
  },
  // ... same pattern per resource
}
```

### Hook Pattern — `queryOptions()` Helper

Each resource uses the `queryOptions()` helper from React Query v5 for type-safe, reusable query configurations. The options object can be shared across `useQuery`, `queryClient.prefetchQuery`, `queryClient.setQueryData`, and `useQueries` with full type inference:

```ts
import { queryOptions, useQuery } from '@tanstack/react-query'

export const volunteersListOptions = () =>
  queryOptions({
    queryKey: queryKeys.volunteers.list(),
    queryFn: async () => {
      const { volunteers } = await listVolunteers()
      const pubkey = await keyManager.getPublicKeyHex()
      if (pubkey && (await keyManager.isUnlocked())) {
        await decryptArrayFields(volunteers as Record<string, unknown>[], pubkey, LABEL_VOLUNTEER_PII)
      }
      return volunteers
    },
  })

export function useVolunteers() {
  return useQuery(volunteersListOptions())
}

// Reusable with full type safety:
// queryClient.prefetchQuery(volunteersListOptions())
// queryClient.setQueryData(volunteersListOptions().queryKey, newData)
```

### Mutation Pattern

Co-located with query hooks:

```ts
export function useCreateVolunteer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateVolunteerInput) => api.createVolunteer(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.volunteers.all })
    },
  })
}
```

## Stale Times Per Resource

| Resource | staleTime | Rationale |
|----------|-----------|-----------|
| Volunteers | 5 min | Admin-managed, changes rarely |
| Contacts | 5 min | Same |
| Shifts | 5 min | Same |
| Bans | 5 min | Same |
| Settings | 10 min | Very rarely changed |
| Hubs | 10 min | Very rarely changed |
| Notes | 2 min | More actively created during shifts |
| Calls (history) | 2 min | Actively grows during shifts |
| Audit log | 1 min | Admins expect near-real-time |
| Reports | 30 sec | Active moderation queue |
| Calls (active) | 0 | Real-time via Nostr, always fresh |
| Conversations | 0 | Real-time via Nostr, always fresh |
| Preferences | Infinity | Only changes on explicit save |

## Deletions

The following code is removed entirely:

- `DecryptCache` class and `decryptCache` singleton in `src/client/lib/decrypt-fields.ts` — replaced by React Query cache + worker internal cache
- `useDecryptedArray` hook in `src/client/lib/use-decrypted.ts` — replaced by decrypt-in-queryFn
- `useDecryptedObject` hook in `src/client/lib/use-decrypted.ts` — same
- All `useState` + `useEffect` fetch patterns in route files — replaced by query hooks
- Manual polling intervals in routes (reports 30s, calls 8s) — replaced by `refetchInterval` option on queries

The following are retained but modified:

- `decryptArrayFields` / `decryptObjectFields` in `decrypt-fields.ts` — still used inside queryFn, but no longer called from React hooks
- `resolveEncryptedFields` in `decrypt-fields.ts` — still used by the decrypt functions
- `cryptoWorker` singleton — unchanged, still the decryption backend

## Route Transformation Example

### Before (volunteers.tsx)

```ts
const [volunteers, setVolunteers] = useState<Volunteer[]>([])
const [invites, setInvites] = useState<Invite[]>([])
const [roles, setRoles] = useState<Role[]>([])
const [loading, setLoading] = useState(true)
const [showAddForm, setShowAddForm] = useState(false)
const [generatedNsec, setGeneratedNsec] = useState("")
const [inviteLink, setInviteLink] = useState("")

const loadData = async () => {
  setLoading(true)
  const [vols, invs, rls] = await Promise.all([
    api.listVolunteers(),
    api.listInvites(),
    api.listRoles(),
  ])
  setVolunteers(vols)
  setInvites(invs)
  setRoles(rls)
  setLoading(false)
}

useEffect(() => { loadData() }, [])

const decryptedVolunteers = useDecryptedArray(volunteers, LABEL_VOLUNTEER_PII)
```

### After

```ts
const { data: volunteers = [], isLoading: volsLoading } = useVolunteers()
const { data: invites = [], isLoading: invitesLoading } = useInvites()
const { data: roles = [] } = useRoles()
const createVolunteer = useCreateVolunteer()
const deleteVolunteer = useDeleteVolunteer()

const isLoading = volsLoading || invitesLoading

// ... just the JSX, no fetch orchestration
```

## Testing Strategy

- Unit tests for query key factories (pure functions).
- Unit tests for query hooks using `@tanstack/react-query`'s `renderHook` + `QueryClient` wrapper with mocked `api` module.
- Existing API integration tests (Playwright, no browser) unchanged — they test server endpoints, not client hooks.
- Existing UI E2E tests (Playwright, Chromium) should pass unchanged — they test user-visible behavior, not internal state management.
