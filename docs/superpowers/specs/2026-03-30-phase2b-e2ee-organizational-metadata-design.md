# Field-Level Encryption Phase 2B: Upgrade Org Metadata from Server-Key to Hub-Key E2EE

**Date:** 2026-03-30 (revised from 2026-03-28 original)
**Status:** Draft
**Scope:** Upgrade organizational metadata fields from server-key encryption to hub-key E2EE. The server currently encrypts/decrypts these fields — after this phase, only hub members with the hub key can decrypt them.
**Prerequisite:** Phase 2A complete (it is — all fields already server-key encrypted)
**Threat model:** A compromised running server can currently decrypt all org metadata via `SERVER_NOSTR_SECRET`. After this phase, the server stores opaque ciphertext for org metadata. Decryption requires BOTH the server secret (to unwrap hub key envelope) AND the hub key envelope from the database — two-secret requirement.

---

## Current State

All target fields are **already server-key encrypted** (Phase 1 / Phase 2A). The schema already has `ciphertext()` columns. The server currently encrypts on write and decrypts on read.

| Table | Field | Current | Target |
|-------|-------|---------|--------|
| `hubs` | `encryptedName` | Server-key | Hub-key E2EE |
| `hubs` | `encryptedDescription` | Server-key | Hub-key E2EE |
| `roles` | `encryptedName` | Server-key | Hub-key E2EE |
| `roles` | `encryptedDescription` | Server-key | Hub-key E2EE |
| `custom_field_definitions` | `encryptedFieldName` | Server-key | Hub-key E2EE |
| `custom_field_definitions` | `encryptedLabel` | Server-key | Hub-key E2EE |
| `custom_field_definitions` | `encryptedOptions` | Server-key | Hub-key E2EE |
| `report_types` | `encryptedName` | Server-key | Hub-key E2EE |
| `report_types` | `encryptedDescription` | Server-key | Hub-key E2EE |
| `report_categories` | `encryptedCategories` | Server-key | Hub-key E2EE |
| `shift_schedules` | `encryptedName` | Server-key | Hub-key E2EE |
| `ring_groups` | `encryptedName` | Server-key | Hub-key E2EE |
| `blasts` | `encryptedName` | Server-key | Hub-key E2EE |

---

## Why Hub-Key, Not Keep Server-Key

1. **Two-secret requirement** — decryption requires BOTH `SERVER_NOSTR_SECRET` AND the hub key envelope. Server-key needs only one secret.
2. **Hub isolation** — each hub has its own key. Compromising hub A reveals nothing about hub B.
3. **Client-native** — hub key is already distributed to all members via ECIES envelopes. `hubEncrypt()`/`hubDecrypt()` already exist. No new crypto infrastructure needed.

---

## Design

### Service layer: server-encrypts → pass-through

**Before (server-key — current):**
```typescript
// Write: server encrypts
async createHub(data: { name: string }) {
  const encrypted = this.crypto.serverEncrypt(data.name, LABEL)
  await db.insert(hubs).values({ encryptedName: encrypted })
}

// Read: server decrypts
async getHubs() {
  const rows = await db.select().from(hubs)
  return rows.map(r => ({
    ...r,
    name: this.crypto.serverDecrypt(r.encryptedName, LABEL),
  }))
}
```

**After (hub-key E2EE — target):**
```typescript
// Write: client already encrypted, server stores ciphertext
async createHub(data: { encryptedName: Ciphertext }) {
  await db.insert(hubs).values({ encryptedName: data.encryptedName })
}

// Read: server returns ciphertext, client decrypts
async getHubs() {
  const rows = await db.select().from(hubs)
  return rows.map(r => ({
    id: r.id,
    encryptedName: r.encryptedName,  // opaque to server
    status: r.status,
  }))
}
```

### API changes

Routes accept ciphertext instead of plaintext:

```typescript
// Before: server receives plaintext
app.post('/api/hubs', async (c) => {
  const { name, description } = await c.req.json()
  // ...
})

// After: server receives ciphertext
app.post('/api/hubs', async (c) => {
  const { encryptedName, encryptedDescription } = await c.req.json()
  // ...
})
```

### Client changes

Each component that displays org metadata uses hub-key decryption:

```typescript
function useDecryptedHubField(encryptedValue: Ciphertext | null, hubId: string): string | null {
  const hubKey = useHubKey(hubId)
  if (!encryptedValue || !hubKey) return null
  return hubDecrypt(encryptedValue, hubKey)
}
```

Admin write forms encrypt before sending:

```typescript
const hubKey = useHubKey(hubId)
const encryptedName = hubEncrypt(name, hubKey)
await createHub({ encryptedName })
```

### UI flow changes

1. **Hub switcher** — shows placeholders until PIN unlock + hub key decryption
2. **Admin settings pages** (roles, custom fields, report types, shifts, ring groups, blasts) — skeleton loaders until hub key available
3. **Call ring screen** — hub name decrypts after unlock; pre-unlock shows "Incoming call"

### Fields that STAY server-key

These fields need server-side processing at runtime and cannot be hub-key encrypted:

| Table | Field | Reason |
|-------|-------|--------|
| `blast_settings` | welcome/bye/double-opt-in messages | Server sends via SMS |
| `audit_log` | event, details | Server writes audit entries |
| `ivr_audio` | audio_data | Server serves to telephony bridge |

These remain server-key encrypted. The server must be able to decrypt them to function.

---

## Migration

**Pre-production — no data to migrate.** The transition is a code change:

1. Update service layer: remove `serverEncrypt()`/`serverDecrypt()` calls for the 13 target fields
2. Update API routes: accept ciphertext from client instead of plaintext
3. Update client components: encrypt on write with `hubEncrypt()`, decrypt on read with `hubDecrypt()`
4. Update React Query hooks: integrate hub-key decryption in query functions

No SQL migration needed — the columns are already `ciphertext()` typed. The content just changes from server-encrypted to hub-key-encrypted.

---

## Testing

### Unit tests
- Hub-key encrypt/decrypt round-trip for all 13 fields
- Hub isolation: hub A's key cannot decrypt hub B's metadata

### API tests
- API returns ciphertext (not plaintext) for all target fields
- API accepts ciphertext on write
- Server cannot decrypt hub-key encrypted fields (E2EE verification)

### UI E2E tests
- Components show placeholders before PIN unlock
- Components show decrypted values after unlock
- Admin forms send ciphertext for all encrypted fields
- Hub switcher works with encrypted hub names

---

## Scope — Not Covered

- Encrypting fields the server must process at runtime (blast settings messages, audit log, IVR audio) — these stay server-key
- Plaintext structural metadata (IDs, timestamps, booleans, foreign keys) — not encrypted
- Drop plaintext columns — Phase 2C (but there are no plaintext columns to drop for these fields — they're already encrypted)
