# Llamenos E2EE Architecture Overview

## Vision

Transform Llamenos from a "server-side encrypted" model to a **true zero-knowledge architecture** where:

1. **The server stores data it cannot read** - All content E2EE
2. **The server sees minimal metadata** - Real-time events via Nostr relay
3. **The server cannot correlate activity** - Encrypted metadata, ephemeral presence
4. **Users can verify code integrity** - Reproducible builds
5. **Audio never leaves the device** - Client-side transcription

## Three Encryption Tiers

All persistent data in Llamenos is encrypted using one of three tiers, chosen by sensitivity and access pattern:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 1: Envelope-Encrypted PII (per-user ECIES)                        │
│                                                                          │
│  Who decrypts: Individual user (their nsec)                              │
│  Symmetric key: Per-record random key, ECIES-wrapped per reader          │
│  Crypto: XChaCha20-Poly1305 (content) + ECIES secp256k1 (key wrap)     │
│  Domain label: LABEL_USER_PII, LABEL_CONTACT_PII, LABEL_CONTACT_SUMMARY│
│                                                                          │
│  Data: user names, phone numbers, contact records, invite details,       │
│        ban details, credential fields, intake payloads                   │
│                                                                          │
│  Pattern:                                                                │
│    encryptedFoo (ciphertext) + fooEnvelopes[] (per-reader ECIES wraps)  │
│    Each envelope: { pubkey, ephemeralPubkey, wrappedKey }                │
│    Server stores ciphertext + envelopes; cannot decrypt either           │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 2: Hub-Key Encrypted Org Metadata (shared XChaCha20)              │
│                                                                          │
│  Who decrypts: All hub members (shared hub key)                          │
│  Key: Random 32 bytes, ECIES-distributed per member                      │
│  Crypto: XChaCha20-Poly1305 (nonce || ciphertext, hex-encoded)          │
│  No domain label in ciphertext — hub key is the domain                   │
│                                                                          │
│  Data: role names/descriptions, shift names, report type names,          │
│        custom field labels, team names, tag names, hub names             │
│                                                                          │
│  Pattern:                                                                │
│    encryptedName column in DB (ciphertext column type)                   │
│    Client: encryptHubField(value, hubId) / decryptHubField(ct, hubId)   │
│    Server fallback: stores plaintext if client sends no encrypted value  │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  TIER 3: Per-Record Forward Secrecy (ephemeral keys)                    │
│                                                                          │
│  Who decrypts: Author + each admin (individual envelopes)                │
│  Symmetric key: Random 32 bytes per note/message/report                  │
│  Crypto: XChaCha20-Poly1305 (content) + ECIES (key wrap per reader)    │
│  Domain labels: LABEL_NOTE_KEY, LABEL_MESSAGE, LABEL_BLAST_CONTENT      │
│                                                                          │
│  Data: call notes, transcripts, reports, SMS/WhatsApp/Signal messages,   │
│        voicemail transcripts, blast content                              │
│                                                                          │
│  Properties:                                                             │
│    - Compromising one record key reveals only that record                │
│    - Each reader gets their own ECIES-wrapped copy of the record key     │
│    - No single secret decrypts all records                               │
└──────────────────────────────────────────────────────────────────────────┘
```

### Tier Summary Table

| Tier | Key Scope | Key Type | Access Pattern | Example Data |
|------|-----------|----------|----------------|--------------|
| 1 | Per-record, per-reader | ECIES envelope | Individual user | User names, phones, contacts |
| 2 | Per-hub, all members | Shared symmetric | All hub members | Role names, shift names, tags |
| 3 | Per-record, author+admins | Ephemeral symmetric + ECIES | Author + admins | Notes, messages, transcripts |

## Multi-Factor KEK Derivation

The user's secret key (nsec) is encrypted at rest in localStorage using a Key Encryption Key (KEK) derived from multiple independent factors. Compromising any single factor is insufficient to recover the nsec.

```
Factor 1: PIN (6-8 digits)        Factor 2: IdP Value (32 bytes)     Factor 3: WebAuthn PRF (optional)
     │                                  │                                    │
     │  PBKDF2-SHA256                   │  From Authentik                    │  From hardware key
     │  600k iterations                 │  nsecSecret field                  │  via prf extension
     │  32-byte salt                    │  (or synthetic for                 │
     │                                  │   device-link flows)               │
     ▼                                  ▼                                    ▼
  pinDerived (32 bytes)           idpValue (32 bytes)               prfOutput (32 bytes)
     │                                  │                                    │
     └──────────┬───────────────────────┘                                    │
                │                       ┌────────────────────────────────────┘
                │                       │
                ▼                       ▼
         ┌──────────────────────────────────────┐
         │  Concatenation:                       │
         │  2F: pinDerived || idpValue           │
         │  3F: pinDerived || prfOutput || idpValue │
         └──────────────────┬───────────────────┘
                            │
                            ▼
         ┌──────────────────────────────────────┐
         │  HKDF-SHA256                          │
         │  salt: same 32-byte salt              │
         │  info: "llamenos:nsec-kek:2f"         │
         │    or  "llamenos:nsec-kek:3f"         │
         │  dkLen: 32 bytes                      │
         └──────────────────┬───────────────────┘
                            │
                            ▼
                       KEK (32 bytes)
                            │
                            ▼
         ┌──────────────────────────────────────┐
         │  XChaCha20-Poly1305                   │
         │  Encrypts nsec hex string             │
         │  Stored in localStorage as JSON:      │
         │  { version: 2, salt, nonce,           │
         │    ciphertext, pubkeyHash,            │
         │    prfUsed, idpIssuer }               │
         └──────────────────────────────────────┘
```

### Security Properties

| Property | Mechanism |
|----------|-----------|
| PIN brute-force resistance | PBKDF2 with 600k iterations makes each guess ~0.5s |
| IdP binding | KEK changes if IdP rotates the nsecSecret; server-side factor |
| WebAuthn hardware binding | PRF output from FIDO2 authenticator; device-bound |
| Factor independence | HKDF over concatenation — all factors required to derive same KEK |
| Domain separation | Separate HKDF info labels for 2F vs 3F modes |
| No plaintext pubkey stored | Only truncated SHA-256 hash of pubkey stored for identification |
| Synthetic fallback | Device-link flows use deterministic synthetic IdP value; auto-rotated to real value on next unlock with valid IdP session |
| KEK rotation | Re-encryption happens inside crypto worker; nsec never touches main thread |

## Web Worker Isolation

The user's secret key (nsec) **never exists on the main thread**. All private-key operations are delegated to a dedicated Web Worker via structured `postMessage` communication.

```
┌─────────────────────────────────────┐     ┌─────────────────────────────────┐
│          MAIN THREAD                 │     │        CRYPTO WORKER             │
│                                      │     │                                  │
│  CryptoWorkerClient (singleton)      │     │  Closure-scoped state:           │
│    │                                 │     │    secretKey: Uint8Array | null   │
│    │  .unlock(kek, nonce, ct)  ──────┼──▶  │    publicKeyHex: string | null   │
│    │  .sign(messageHex)        ──────┼──▶  │                                  │
│    │  .decrypt(eph, wrapped, label)──┼──▶  │  Operations:                     │
│    │  .encrypt(pt, pub, label) ──────┼──▶  │    unlock    — decrypt nsec blob │
│    │  .decryptEnvelopeField()  ──────┼──▶  │    lock      — zero + null key   │
│    │  .reEncrypt(newKek)       ──────┼──▶  │    sign      — Schnorr signature │
│    │  .provisionNsec(eph)      ──────┼──▶  │    decrypt   — ECIES unwrap      │
│    │  .lock()                  ──────┼──▶  │    encrypt   — ECIES wrap        │
│    │  .getPublicKey()          ──────┼──▶  │    reEncrypt — KEK rotation      │
│    │  .isUnlocked()            ──────┼──▶  │    provision — device linking    │
│    │                                 │     │    decryptEnvelopeField          │
│    │  ◀── Promise<result> ───────────┼──◀  │      — ECIES unwrap + symmetric  │
│    │                                 │     │        decrypt in one round trip  │
│                                      │     │                                  │
│  Request/Response Protocol:          │     │  Rate Limiting:                  │
│    { type, id, ...params }     ──▶   │     │    sign:    10/sec, 100/min      │
│    { type: 'success'|'error',        │     │    decrypt: 100/sec, 1000/min    │
│      id, result|error }       ◀──    │     │    encrypt: 10/sec, 100/min      │
│                                      │     │                                  │
│  Singleton: one worker per tab       │     │  Auto-lock on rate limit breach  │
│  All pending requests tracked        │     │  Key zeroed with .fill(0)        │
│  by request ID in a Map              │     │                                  │
└──────────────────────────────────────┘     └─────────────────────────────────┘
```

### Worker Security Properties

| Property | Implementation |
|----------|---------------|
| Key isolation | `secretKey` in worker closure; never serialized back to main thread |
| Zero on lock | `secretKey.fill(0)` then `null` assignment |
| Rate limiting | Per-operation buckets; exceeding triggers immediate auto-lock |
| No key export | No message type returns the raw nsec; only derived values (signatures, public key) |
| Singleton per tab | Module-level `cryptoWorker` instance; `typeof Worker !== 'undefined'` guard for SSR |
| Combined operations | `decryptEnvelopeField` does ECIES unwrap + symmetric decrypt in one worker round-trip |

## Decrypt-on-Fetch Pattern

Encrypted data is decrypted inside React Query `queryFn` callbacks, not in components. Components receive plaintext and never handle ciphertext directly.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  React Query queryFn (e.g., rolesListOptions)                           │
│                                                                         │
│  1. Fetch from API:                                                     │
│     const { roles } = await listRoles()                                 │
│                                                                         │
│  2. Decrypt in queryFn:                                                 │
│     Tier 1 (envelope PII):                                              │
│       await decryptObjectFields(user, readerPubkey, LABEL_USER_PII)     │
│       await decryptArrayFields(users, readerPubkey, LABEL_USER_PII)     │
│                                                                         │
│     Tier 2 (hub-key org metadata):                                      │
│       name: decryptHubField(role.encryptedName, hubId, role.name)       │
│                                                                         │
│  3. Return plaintext to React Query cache                               │
│     Components use data as-is — no crypto awareness needed              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  ENCRYPTED_QUERY_KEYS — exhaustive classification                       │
│                                                                         │
│  Every query key domain in queryKeys MUST be classified as either       │
│  ENCRYPTED or PLAINTEXT. A compile-time MissingDomains type check       │
│  enforces exhaustiveness — adding a new domain without classifying it   │
│  produces a type error.                                                 │
│                                                                         │
│  Encrypted domains (cleared on lock, invalidated on unlock):            │
│    users, contacts, notes, calls, audit, blasts, reports,               │
│    conversations, invites, bans, credentials, intakes,                  │
│    shifts, roles, settings, hubs, tags, teams                           │
│                                                                         │
│  Plaintext domains (never cleared):                                     │
│    analytics, preferences, presence, provider                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Lock / Unlock Lifecycle                                                │
│                                                                         │
│  ON LOCK (key-manager → onLock callback):                               │
│    1. Crypto worker zeros nsec                                          │
│    2. queryClient.removeQueries() for all ENCRYPTED_QUERY_KEYS          │
│       → stale ciphertext never served to unauthenticated session        │
│    3. Hub key cache cleared (clearHubKeyCache)                          │
│    4. Decrypt cache cleared (decryptCache.clear)                        │
│                                                                         │
│  ON UNLOCK (auth.tsx, AFTER hub keys loaded):                           │
│    1. PIN entered → KEK derived → crypto worker unlocks                 │
│    2. loadHubKeysForUser(hubIds) — fetch + ECIES-unwrap hub keys        │
│    3. invalidateEncryptedQueries() — mark all encrypted domains stale   │
│    4. React Query refetches → queryFns decrypt with fresh keys          │
│                                                                         │
│  IMPORTANT: invalidation happens AFTER loadHubKeysForUser completes.    │
│  Doing it before caused a race: queries refetched while hub key cache   │
│  was still empty, caching raw ciphertext instead of plaintext.          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Decrypt Cache

Tier 1 decryption (envelope ECIES) involves a crypto worker round-trip per field. A `DecryptCache` (keyed by `label:ciphertext`) avoids redundant worker calls across re-renders and refetches. The cache is a module-level singleton cleared on lock.

## Envelope Encryption for Messaging

Inbound SMS, WhatsApp, and Signal messages are envelope-encrypted on the server immediately upon webhook receipt. The server discards plaintext after encryption — only ciphertext is stored.

```
INBOUND MESSAGE FLOW:

  Provider (Twilio/Vonage/etc)
       │
       │  POST /api/messaging/webhook
       ▼
  ┌──────────────────────────────────────────┐
  │  Server: messaging/router.ts              │
  │                                            │
  │  1. Parse webhook payload                  │
  │  2. Find or create conversation            │
  │  3. Determine reader pubkeys:              │
  │     - All admin pubkeys                    │
  │     - Assigned volunteer pubkey (if any)   │
  │  4. Envelope encrypt:                      │
  │     services.crypto.envelopeEncrypt(       │
  │       messageText,                         │
  │       readerPubkeys,                       │
  │       LABEL_MESSAGE                        │
  │     )                                      │
  │  5. Store ONLY ciphertext + envelopes      │
  │  6. Discard plaintext immediately          │
  │  7. Publish Nostr event (hub-key encrypted)│
  └──────────────────────────────────────────┘

OUTBOUND MESSAGE FLOW:

  Volunteer client
       │
       │  1. Generate per-message random key (32 bytes)
       │  2. XChaCha20(messageKey, messageText) → encryptedContent
       │  3. ECIES(messageKey, volunteerPubkey) → volunteerEnvelope
       │  4. ECIES(messageKey, adminPubkey) × N → adminEnvelopes[]
       │  5. POST /api/conversations/{id}/messages
       │     Body: { plaintextForSending, encryptedContent,
       │             nonce, volunteerEnvelope, adminEnvelopes }
       ▼
  ┌──────────────────────────────────────────┐
  │  Server:                                   │
  │  1. Forward plaintext to SMS/WhatsApp      │
  │     provider (inherent transport limitation)│
  │  2. Store ONLY encrypted fields            │
  │  3. Discard plaintextForSending            │
  └──────────────────────────────────────────┘
```

**Trust boundary**: The server momentarily sees outbound message plaintext because SMS/WhatsApp/Signal providers require it. This is an inherent limitation of non-E2EE transport protocols. The server discards plaintext immediately after forwarding.

## Hub Key Distribution

Each hub has a random 32-byte symmetric key used for Tier 2 encryption (org metadata) and Nostr event content encryption.

```
GENERATION:
  hubKey = crypto.getRandomValues(32)     ← NOT derived from any identity key

DISTRIBUTION:
  For each hub member (volunteer or admin):
    wrapHubKeyForMember(hubKey, memberPubkeyHex)
      → ECIES(hubKey, memberPubkey, LABEL_HUB_KEY_WRAP)
      → { pubkey, ephemeralPubkey, wrappedKey }

  Stored server-side: array of RecipientKeyEnvelopes
  Fetched client-side: GET /api/hub/key → member's envelope

LOADING (client-side, after PIN unlock):
  loadHubKeysForUser(hubIds):
    For each hub:
      1. getMyHubKeyEnvelope(hubId) → fetch my envelope from server
      2. unwrapHubKey(envelope)     → ECIES decrypt in crypto worker
      3. hubKeyCache.set(hubId, hubKey)

  Cache: module-level Map<hubId, Uint8Array>
  Generation counter prevents stale concurrent loads from writing

ROTATION (on member departure):
  rotateHubKey(currentMemberPubkeys):
    1. Generate new random 32-byte key
    2. Wrap for all CURRENT members (departed member excluded)
    3. Store new envelopes server-side
    4. Re-encrypt hub-scoped data with new key (caller responsibility)

  The departed member's old hub key is useless for new data.
  Old data encrypted with the old key remains readable to anyone
  who had the old key — this is by design (forward secrecy, not
  backward secrecy, for organizational metadata).
```

### Hub Key Properties

| Property | Mechanism |
|----------|-----------|
| Pure random | `crypto.getRandomValues(32)` — no derivation from identity keys |
| Individual wrapping | ECIES per member with `LABEL_HUB_KEY_WRAP` domain separation |
| No shared admin secret | Each member gets their own ECIES-wrapped copy |
| Rotation breaks access | New key = new random bytes, no mathematical link to old key |
| Server cannot decrypt | Server stores ECIES envelopes; needs member's nsec to unwrap |

## Implemented Architecture

### Data at Rest

| Data Type | Tier | Encryption | Notes |
| --------- | ---- | ---------- | ----- |
| Call notes | 3 | XChaCha20-Poly1305 + ECIES per-note key, dual envelopes (author + admin) | Forward secrecy per note |
| Transcripts | 3 | Client-generated via WASM Whisper; encrypted with note key | Audio never leaves browser |
| Reports | 3 | XChaCha20-Poly1305 + ECIES per-report key | Forward secrecy per report |
| File attachments | 3 | XChaCha20-Poly1305 + ECIES per-file key | Stored in RustFS |
| SMS messages | 3 | Envelope encryption: per-message random key, ECIES for volunteer + each admin | Server encrypts inbound on receipt |
| WhatsApp messages | 3 | Envelope encryption: per-message random key, ECIES for volunteer + each admin | Server encrypts inbound on receipt |
| Signal messages | 3 | Envelope encryption: per-message random key, ECIES for volunteer + each admin | Server encrypts inbound on receipt |
| Blast content | 3 | Envelope encryption with LABEL_BLAST_CONTENT | Per-blast key |
| Voicemail transcripts | 3 | Envelope encryption with LABEL_VOICEMAIL_TRANSCRIPT | |
| User names | 1 | ECIES envelope with LABEL_USER_PII | Per-user envelopes |
| User phones | 1 | ECIES envelope with LABEL_USER_PII | Per-user envelopes |
| Contact records | 1 | Two-tier: LABEL_CONTACT_SUMMARY (display) + LABEL_CONTACT_PII (full PII) | PBAC-controlled access |
| Contact relationships | 1 | ECIES envelope with LABEL_CONTACT_RELATIONSHIP | Fully E2EE |
| Contact intake payloads | 1 | ECIES envelope with LABEL_CONTACT_INTAKE | Enveloped for submitter + triage |
| Invite details | 1 | ECIES envelope with LABEL_USER_PII | Per-inviter envelopes |
| Ban details | 1 | ECIES envelope with LABEL_USER_PII | Per-admin envelopes |
| Credential fields | 1 | ECIES envelope with LABEL_USER_PII | Per-user envelopes |
| Role names/descriptions | 2 | Hub-key XChaCha20-Poly1305 | All hub members can decrypt |
| Shift names | 2 | Hub-key XChaCha20-Poly1305 | All hub members can decrypt |
| Report type names | 2 | Hub-key XChaCha20-Poly1305 | All hub members can decrypt |
| Custom field labels | 2 | Hub-key XChaCha20-Poly1305 | All hub members can decrypt |
| Team names | 2 | Hub-key XChaCha20-Poly1305 | All hub members can decrypt |
| Tag names | 2 | Hub-key XChaCha20-Poly1305 | All hub members can decrypt |
| Hub names | 2 | Hub-key XChaCha20-Poly1305 | All hub members can decrypt |
| Volunteer assignments | 1 | Multi-admin envelopes via LABEL_CALL_META | |
| Shift schedules | 2+plaintext | Encrypted details via LABEL_SHIFT_SCHEDULE; routing pubkeys/times plaintext | |
| Audit logs | — | Plaintext + SHA-256 hash chain (previousEntryHash + entryHash) for tamper detection | Server-readable, integrity-protected |
| Caller phone hashes | — | HMAC-SHA256 with operator secret; last 4 digits stored plaintext | For ban list matching |
| JWT tokens | — | Signed (HS256) with HMAC_SECRET; stored server-side only | Session authentication |
| Authentik credentials | — | Stored in Authentik; IdP-bound nsecSecret encrypted at rest via LABEL_IDP_VALUE_WRAP | Server never holds nsecSecret plaintext |
| Provider credentials | 1 | ECIES envelope with LABEL_PROVIDER_CREDENTIAL_WRAP | OAuth/API keys for telephony providers |
| Storage credentials | 2 | Hub-key with LABEL_STORAGE_CREDENTIAL_WRAP | RustFS IAM secret keys |

### Data in Transit (Real-Time)

| Event Type | Implementation |
| ---------- | -------------- |
| Call notifications | Nostr relay ephemeral kind 20001 events, hub-key encrypted, generic tags |
| Presence updates | Nostr relay ephemeral events, hub-key encrypted (volunteer: boolean; admin: ECIES with full counts) |
| Message notifications | Nostr relay ephemeral events, hub-key encrypted |
| Typing indicators | Nostr relay ephemeral events, hub-key encrypted |
| Call state changes | REST API (server-authoritative) + Nostr relay propagation |

### External Data Flows

| Flow | Implementation |
| ---- | -------------- |
| Transcription audio | Local mic only — WASM Whisper in-browser via `@huggingface/transformers`, single-threaded AudioWorklet |
| Volunteer phone numbers | Exposed to telephony provider (Twilio SDK) — inherent limitation of PSTN |
| Push notifications | Not yet implemented — planned: two-tier encryption (wake key + pubkey) |

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │  Web Client       │  │  Desktop Client   │  │  Mobile Client    │       │
│  │  (React SPA)      │  │  (Tauri)          │  │  (React Native)   │       │
│  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘       │
│            │                      │                      │                  │
│            └──────────────────────┼──────────────────────┘                  │
│                                   │                                         │
│  ┌────────────────────────────────┴────────────────────────────────────┐   │
│  │                        SHARED CLIENT CORE                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ Key Manager  │  │ Crypto Worker│  │ Nostr Client │              │   │
│  │  │ (multi-factor│  │ (nsec in     │  │ (Relay Conn) │              │   │
│  │  │  KEK unlock) │  │  Web Worker) │  │              │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ Hub Key Cache│  │ Decrypt-on-  │  │ Transcription│              │   │
│  │  │ (per-hub     │  │ Fetch (React │  │ (WASM Whisper│              │   │
│  │  │  symmetric)  │  │  Query + RQ) │  │  AudioWorklet│              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │  ┌──────────────┐  ┌──────────────┐                                │   │
│  │  │ Twilio Voice │  │ State Sync   │                                │   │
│  │  │ SDK Handler  │  │ (REST+Nostr) │                                │   │
│  │  └──────────────┘  └──────────────┘                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
                    │ REST API                     │ Nostr Events (ephemeral)
                    │ (state mutations,            │ (encrypted content,
                    │  E2EE blob storage)          │  generic tags only)
                    ▼                              ▼
┌─────────────────────────────────────┐  ┌─────────────────────────────────────┐
│           SERVER LAYER              │  │           NOSTR RELAY               │
│  ┌─────────────────────────────┐   │  │  ┌─────────────────────────────┐   │
│  │ Bun + Hono (VPS / Docker)   │   │  │  │ strfry (self-hosted)       │   │
│  │                             │   │  │  │                             │   │
│  │ • Auth (WebAuthn/session)   │   │  │  │ • NIP-01 Events             │   │
│  │ • Authentik IdP (OIDC)      │   │  │  │ • NIP-42 Auth               │   │
│  │ • Telephony webhooks        │   │  │  │ • Hub-scoped subscriptions  │   │
│  │ • Messaging webhooks        │   │  │  │ • Ephemeral event forwarding│   │
│  │ • E2EE blob storage         │   │  │  │ • E2EE event content        │   │
│  │ • Minimal routing metadata  │   │  │  │                             │   │
│  │ • Server nsec (signing only)│   │  │  └─────────────────────────────┘   │
│  └─────────────────────────────┘   │  │                                     │
│                                     │  │  Relay sees:                        │
│  Server has:                        │  │  • Encrypted event content          │
│  • Server nsec (its own identity)   │  │  • Pubkeys (pseudonymous)           │
│  • Admin/volunteer npubs (pub only) │  │  • Timestamps                       │
│  • Encrypted blobs it can't read    │  │  • Generic tags only (no event type)│
│  • Authentik as identity provider   │  │                                     │
│  • NEVER has admin/volunteer nsec   │  │                                     │
│                                     │  │                                     │
│  Server NEVER:                      │  │                                     │
│  • Decrypts content                 │  │                                     │
│  • Holds user private keys          │  │                                     │
│  • Reads message/note plaintext     │  │                                     │
│  (except outbound SMS/WhatsApp      │  │                                     │
│   momentarily — inherent limit)     │  │                                     │
└─────────────────────────────────────┘  └─────────────────────────────────────┘
                    │
                    │ Telephony/Messaging Webhooks
                    ▼
┌─────────────────────────────────────┐
│      EXTERNAL PROVIDERS             │
│  ┌─────────────┐  ┌──────────────┐ │
│  │ Twilio/etc  │  │ SMS/WhatsApp │ │
│  │ (calls)     │  │ (messages)   │ │
│  └─────────────┘  └──────────────┘ │
│                                     │
│  Providers see:                     │
│  • Call audio (if PSTN)             │
│  • Outbound message content         │
│    (inherent, server discards       │
│     after forwarding)               │
│  • Phone numbers                    │
│                                     │
│  NEW trusted parties:               │
│  • Authentik (IdP, nsecSecret)      │
│  • Apple APNs (push delivery meta)  │
│  • Google FCM (push delivery meta)  │
└─────────────────────────────────────┘
```

## Encryption Key Hierarchy

```
User nsec (secp256k1) — IDENTITY AND SIGNING ONLY
    │
    ├─→ Protected by multi-factor KEK:
    │       PIN (PBKDF2) + IdP value (Authentik) + optional WebAuthn PRF
    │       → HKDF → KEK → XChaCha20-Poly1305 encrypts nsec in localStorage
    │
    ├─→ Auth: WebAuthn session tokens (multi-device)
    │       + Schnorr signatures for Nostr events
    │
    ├─→ Tier 1 decryption: ECIES unwrap of per-field envelope keys
    │       ├─→ User PII envelopes (LABEL_USER_PII)
    │       ├─→ Contact summary envelopes (LABEL_CONTACT_SUMMARY)
    │       ├─→ Contact PII envelopes (LABEL_CONTACT_PII)
    │       ├─→ Contact relationship envelopes (LABEL_CONTACT_RELATIONSHIP)
    │       └─→ Provider credential envelopes (LABEL_PROVIDER_CREDENTIAL_WRAP)
    │
    ├─→ Tier 3 decryption: ECIES unwrap of per-record keys
    │       ├─→ Note keys (LABEL_NOTE_KEY)
    │       ├─→ Message keys (LABEL_MESSAGE)
    │       ├─→ Blast keys (LABEL_BLAST_CONTENT)
    │       ├─→ Call metadata keys (LABEL_CALL_META)
    │       └─→ File keys (LABEL_FILE_KEY)
    │
    └─→ Hub key unwrap (LABEL_HUB_KEY_WRAP)
            → enables Tier 2 decryption

Hub Key (random 32 bytes, NOT derived from any identity key)
    │
    ├─→ Tier 2: Org metadata encryption (XChaCha20-Poly1305)
    │       ├─→ Role names, shift names, report type names
    │       ├─→ Custom field labels, team names, tag names
    │       └─→ Hub names
    │
    ├─→ Nostr event content encryption (XChaCha20-Poly1305 + HKDF per-event)
    ├─→ Presence encryption (volunteer-tier: boolean only)
    ├─→ Storage credential wrapping (LABEL_STORAGE_CREDENTIAL_WRAP)
    │
    └─→ Distribution: ECIES-wrapped individually for each member
        ├─→ Volunteer A envelope
        ├─→ Volunteer B envelope
        └─→ Each admin envelope

Per-Note Key (random 32 bytes) — Tier 3
    ├─→ Wrapped for author (ECIES, LABEL_NOTE_KEY)
    └─→ Wrapped for each admin (ECIES, LABEL_NOTE_KEY)

Per-Message Key (random 32 bytes) — Tier 3
    ├─→ Wrapped for assigned volunteer (ECIES, LABEL_MESSAGE)
    └─→ Wrapped for each admin (ECIES, LABEL_MESSAGE)

Server nsec (secp256k1) — SERVER IDENTITY ONLY
    ├─→ Derived via HKDF from SERVER_NOSTR_SECRET (LABEL_SERVER_NOSTR_KEY)
    ├─→ Signs Nostr events published by server (call:ring, call:answered)
    ├─→ Clients verify server pubkey for authoritative events
    └─→ CANNOT decrypt any user content
```

## Domain Separation Labels (Authoritative Table)

From `src/shared/crypto-labels.ts`:

| Label | Purpose | Used By | Tier |
| ----- | ------- | ------- | ---- |
| `llamenos:note-key` | ECIES wrapping of per-note symmetric key | Client crypto | 3 |
| `llamenos:message` | ECIES wrapping of per-message symmetric key | Client + server crypto | 3 |
| `llamenos:blast-content` | Blast content envelope encryption | Client + server crypto | 3 |
| `llamenos:transcription` | Transcription key wrapping | Server-side transcription | 3 |
| `llamenos:file-key` | Per-file attachment key wrapping | Client crypto | 3 |
| `llamenos:file-metadata` | File metadata ECIES wrapping | Client crypto | 3 |
| `llamenos:voicemail-audio` | Voicemail audio symmetric key wrapping | Server crypto | 3 |
| `llamenos:voicemail-transcript` | Voicemail transcript encryption | Server crypto | 3 |
| `llamenos:hub-key-wrap` | ECIES wrapping of hub key for member distribution | Admin client | — |
| `llamenos:hub-event` | Hub key encryption of Nostr event content | Client Nostr encryption | 2 |
| `llamenos:call-meta` | Encrypted call record metadata (assignments) | Client + server crypto | 1 |
| `llamenos:shift-schedule` | Encrypted shift schedule details | Client + server crypto | 2 |
| `llamenos:volunteer-pii:v1` | User/invite PII envelope encryption | Server crypto | 1 |
| `llamenos:contact-summary` | Contact display info (Tier 1 contact) | Client crypto | 1 |
| `llamenos:contact-pii` | Contact full PII (Tier 2 contact) | Client crypto | 1 |
| `llamenos:contact-relationship` | Contact relationship payload | Client crypto | 1 |
| `llamenos:contact-intake:v1` | Contact intake payload | Client crypto | 1 |
| `llamenos:provider-credential-wrap:v1` | Provider OAuth/API credentials | Client crypto | 1 |
| `llamenos:storage-credential` | Hub storage IAM secret key | Client crypto | 2 |
| `llamenos:device-provision` | Device provisioning ECDH shared key | Client crypto | — |
| `llamenos:nsec-kek:2f` | HKDF info for 2-factor KEK derivation | Key store | — |
| `llamenos:nsec-kek:3f` | HKDF info for 3-factor KEK derivation | Key store | — |
| `llamenos:kek-prf` | WebAuthn PRF evaluation salt | Key store | — |
| `llamenos:idp-value-wrap` | Envelope encryption of idp_value in IdP | Server crypto | — |
| `llamenos:server-nostr-key` | HKDF derivation of server Nostr keypair | Server startup | — |
| `llamenos:server-nostr-key:v1` | Versioned HKDF info for server Nostr key | Server startup | — |
| `llamenos:push-wake` | Wake-tier push payload (minimal metadata) | Future | — |
| `llamenos:push-full` | Full-tier push payload (nsec-decryptable) | Future | — |
| `llamenos:backup` | Generic backup encryption | Client crypto | — |
| `llamenos:audit-event:v1` | Audit log event encryption | Server crypto | — |
| `llamenos:ivr-audio:v1` | IVR audio prompt encryption | Server crypto | — |
| `llamenos:blast-settings:v1` | Blast settings message encryption | Server crypto | — |
| `llamenos:ephemeral-call:v1` | Ephemeral call data (caller numbers) | Server crypto | — |
| `llamenos:push-credential:v1` | Push notification credential encryption | Server crypto | — |
| `llamenos:contact-identifier` | Contact identifier encryption at rest | Client crypto | — |

## Database Column Types for Encrypted Data

From `src/server/db/crypto-columns.ts`:

```typescript
/** Text column storing XChaCha20-Poly1305 ciphertext (hex-encoded nonce || ciphertext) */
export const ciphertext = (name: string) => text(name).$type<Ciphertext>()

/** Text column storing an HMAC-SHA256 hash (hex-encoded) */
export const hmacHashed = (name: string) => text(name).$type<HmacHash>()
```

The branded `Ciphertext` and `HmacHash` types provide compile-time safety — you cannot accidentally pass a plaintext string where ciphertext is expected, or vice versa.

## Data Flow Diagrams

### Incoming Call (Target Architecture)

```
1. Telephony webhook arrives at server
   │
   ▼
2. Server extracts minimal info:
   • callId (generated)
   • callerLast4 (masked)
   • timestamp
   │
   ▼
3. Server publishes to Nostr relay (via HTTP):
   Event {
     kind: 20001,  // Ephemeral — relay forwards, never stores
     tags: [["d", hubId], ["t", "llamenos:event"]],  // Generic tag
     content: XChaCha20(hubKey, {type: "call:ring", callId, callerLast4}),
     pubkey: serverPubkey  // Server signs with its own nsec
   }
   │
   ▼
4. All on-shift volunteer clients subscribed to relay:
   • Receive event, verify server signature
   • Decrypt with hub key
   • Route by type field ("call:ring")
   • Show incoming call UI
   │
   ▼
5. Volunteer answers:
   • POST /api/calls/{callId}/answer (REST — server is authority)
   • Server atomically sets answeredBy
   • First request: 200 OK
   • Subsequent requests: 409 Conflict
   │
   ▼
6. Server publishes authoritative call:answered event to relay
   • Other clients stop ringing
```

### Message Send (Target Architecture)

```
1. Volunteer types message in conversation view
   │
   ▼
2. Client generates per-message key and encrypts:
   • messageKey = random 32 bytes
   • encryptedContent = XChaCha20(messageKey, messageText)
   • volunteerEnvelope = ECIES(messageKey, volunteerPubkey)
   • adminEnvelopes[] = ECIES(messageKey, adminPubkey) for each admin
   • plaintextForSending = raw text (for SMS/WhatsApp provider)
   │
   ▼
3. POST /api/conversations/{id}/messages
   Body: { plaintextForSending, encryptedContent, nonce, volunteerEnvelope, adminEnvelopes }
   │
   ▼
4. Server:
   • Forwards plaintext to SMS/WhatsApp provider (inherent limitation)
   • Stores ONLY encrypted fields (discards plaintext immediately)
   │
   ▼
5. Server publishes to Nostr relay:
   Event {
     kind: 20001,
     tags: [["d", hubId], ["t", "llamenos:event"]],
     content: XChaCha20(hubKey, {type: "message:new", threadId}),
   }

Server NEVER stores: plaintext message
Server DOES see: outbound plaintext momentarily (inherent SMS/WhatsApp limitation)
```

## Security Analysis

### Trust Boundaries

| Party | Has | Does NOT Have |
| ----- | --- | ------------- |
| Volunteer | Own nsec (in Worker), hub key, own note keys | Other volunteers' nsec, admin nsec |
| Admin | Admin nsec (in Worker), admin decryption key, hub key | Volunteer nsec |
| Server | Server nsec, all npubs (public only) | Any user nsec, hub key, note keys |
| Relay | NIP-42 auth tokens | Event content (encrypted), user nsec |
| Authentik (IdP) | nsecSecret (IdP-bound factor), session tokens | User nsec, PIN, WebAuthn PRF |
| Apple/Google | Push delivery metadata | Push content (encrypted), identity |

### Attack Scenarios

| Attack | Before | After |
| ------ | ------ | ----- |
| Server DB dump | Messages readable, metadata exposed | Only ciphertext (Tier 1-3) + encrypted metadata (Tier 2) |
| Server code compromise | Real-time events visible | Real-time via relay, server has no hub key |
| Relay compromise | N/A | Only encrypted events + generic tags |
| Subpoena of hosting | Metadata + activity patterns | Encrypted blobs, relay connection metadata |
| Subpoena of DB only | Full plaintext access | Ciphertext only (relay provides additional protection) |
| Admin nsec compelled | ALL data decryptable | Only auth compromised (decryption key is separate) |
| Hub key compromised | N/A | Tier 2 metadata decryptable; Tier 1/3 still safe (per-record keys) |
| Device seizure | PIN brute-force → all keys | Multi-factor KEK: need PIN + IdP value + optional PRF |
| Volunteer departure | Historical access retained | Hub key rotated, departed volunteer locked out of new data |
| IdP compromise | N/A | IdP has nsecSecret but not PIN; cannot derive KEK alone |
| PIN-only compromise | N/A | Attacker also needs IdP value; PBKDF2 slows brute force |
| WebAuthn key theft | N/A | Still need PIN + IdP value; PRF is additional factor, not sole factor |

### Remaining Trust Requirements

1. **Telephony providers**: See call audio (PSTN) and outbound message content (SMS/WhatsApp)
   - Mitigation: Twilio SDK for calls (no personal phone numbers), document SMS/WhatsApp limitation

2. **Admin decryption key compromise**: Can decrypt all notes and messages
   - Mitigation: Separate from identity key, hardware key storage, rotation procedures, multi-admin threshold

3. **Client code integrity**: Malicious client could exfiltrate data
   - Mitigation: Reproducible builds, code signing, SLSA provenance

4. **Relay availability**: If relay is down, real-time is degraded
   - Mitigation: Self-hosted relay, REST polling fallback for state

5. **Authentik (IdP)**: Holds nsecSecret factor; compromise provides one of the KEK factors
   - Mitigation: IdP value alone is insufficient (need PIN + optionally PRF); nsecSecret encrypted at rest via LABEL_IDP_VALUE_WRAP

6. **Apple/Google (mobile)**: See push delivery timing and device identifiers
   - Mitigation: Encrypted push payloads, two-tier wake key separation

## Implementation Approach

### Clean Rewrite (No Migration)

Since Llamenos is **pre-production with no deployed users**, we do a clean rewrite:

- **Delete legacy code entirely** - No WebSocket, no plaintext message storage
- **Build E2EE-first** - All features designed for zero-knowledge from the start
- **No backwards compatibility** - No feature flags, no parallel systems
- **Simpler codebase** - Less code to maintain, fewer edge cases

### What the Server Has vs What It Doesn't

**CRITICAL PRINCIPLE: The server NEVER holds user private keys.**

| The server HAS | The server NEVER HAS |
| --------------- | -------------------- |
| Its own server nsec (for signing Nostr events) | Admin nsec (admin's private key) |
| Admin npub (public key, for ECIES encryption) | Volunteer nsec (any volunteer's private key) |
| Volunteer npubs (for ECIES encryption) | Hub key (symmetric, only clients have it) |
| Encrypted blobs it cannot read | Ability to decrypt any user content |
| Auth tokens (proves identity) | Note/message plaintext (except outbound SMS/WhatsApp momentarily) |
| Authentik as identity provider (OIDC) | User PINs or WebAuthn PRF output |

ECIES encryption only needs the **public key** to encrypt. The private key is only needed to **decrypt**, and that happens client-side (in the crypto worker).

### What We Still Need a Server API For

Even with Nostr relay handling all real-time events, we still need a thin REST API for:

| Function | Why Server Required | What Server Sees |
| -------- | ------------------- | ---------------- |
| **Telephony webhooks** | Twilio/Vonage POST to our server | Call metadata (unavoidable) |
| **Messaging webhooks** | SMS/WhatsApp providers POST to our server | Inbound message content (unavoidable, encrypt immediately, store only ciphertext) |
| **Outbound message relay** | Client sends plaintext + encrypted; server forwards to provider, stores only encrypted | Outbound plaintext **momentarily** (discarded after send — inherent SMS/WhatsApp limitation) |
| **E2EE blob storage** | Persistent storage for encrypted notes/messages | Ciphertext only |
| **Auth (WebAuthn/session)** | Validate identity, manage sessions | Auth tokens |
| **Call state mutations** | Atomic answer/hangup | Call ID, volunteer pubkey |
| **File uploads** | Encrypted attachments need RustFS | Ciphertext only |
| **Push notification trigger** | Wake sleeping mobile clients | Encrypted payload via APNs/FCM |
| **IdP integration** | Authentik OIDC for multi-factor auth | Session tokens, nsecSecret (KEK factor) |

### Implementation History

1. **Epic 76.0: Security Foundations** (Completed)
   - Domain separation label audit → `src/shared/crypto-labels.ts` with 25+ constants
   - Provisioning channel SAS fix
   - Emergency key revocation procedures documented
   - Threat model updates (6 new sections)
   - Backup file privacy fix (generic format)

2. **Epic 76.1 + 76.2: Architecture Redesign** (Completed)
   - Worker-to-relay communication: `NostrPublisher` with persistent WebSocket
   - Hub key = `crypto.getRandomValues(32)`, ECIES-wrapped per member
   - Multi-admin envelopes: `adminPubkeys[]` → `adminEnvelopes[]`
   - Identity + decryption key separation

3. **Epic 76: Nostr Relay Sync** (Completed)
   - Complete WebSocket removal — deleted `ws.ts`, `websocket.ts`, `websocket-pair.ts`
   - Nostr-only real-time via ephemeral kind 20001 events with generic tags
   - Server-authoritative call state (REST, relay for notification)

4. **Epic 74: E2EE Messaging Storage** (Completed)
   - Envelope encryption: per-message random key, ECIES-wrapped per reader
   - Server encrypts inbound on webhook receipt (plaintext discarded immediately)
   - Client-side decryption in ConversationThread component

5. **Epic 77: Metadata Encryption** (Completed)
   - Per-record storage keys
   - Encrypted call assignments (`LABEL_CALL_META`) and shift schedules (`LABEL_SHIFT_SCHEDULE`)
   - Hash-chained audit log (SHA-256 with `previousEntryHash` + `entryHash`)

6. **Epic 78: Client-Side Transcription** (Completed)
   - WASM Whisper via `@huggingface/transformers` ONNX runtime
   - AudioWorklet ring buffer → Web Worker isolation
   - Local microphone only (Twilio SDK limitation), auto-save encrypted transcript on hangup

7. **Epic 79: Reproducible Builds** (Completed)
   - Deterministic output via `SOURCE_DATE_EPOCH`, content-hashed filenames
   - `Dockerfile.build` for isolated verification
   - `CHECKSUMS.txt` in GitHub Releases, SLSA provenance attestation
   - `scripts/verify-build.sh [version]` for operator verification

8. **Field-Level Encryption (Phases 1-2D)** (Completed)
   - Phase 1: User PII — names, phones envelope-encrypted (LABEL_USER_PII)
   - Phase 2A: Org metadata — role names, shift names hub-key encrypted
   - Phase 2B: Report types, custom field labels hub-key encrypted
   - Phase 2C: Team names, tag names hub-key encrypted
   - Phase 2D: Contact directory — two-tier contact encryption (PBAC-controlled)
   - Zero plaintext PII in database

9. **IdP Auth Hardening (Epic 99)** (Completed)
   - Multi-factor KEK: PIN + IdP value + optional WebAuthn PRF
   - Authentik integration for IdP-bound nsecSecret
   - Synthetic fallback for device-link flows, auto-rotation to real IdP
   - KEK rotation inside crypto worker (nsec never on main thread)

10. **Epic 75: Native Clients** (Future)
    - Tauri desktop (macOS + Windows)
    - React Native mobile (Twilio RN SDK)
    - Two-tier push encryption (wake key + nsec)

## Key Architecture Principles

### 1. Hub Key is Random (Not Derived)

**Old (BROKEN):** `hubKey = HKDF(adminNsec, hubId)` — compromise of admin nsec reveals all hub keys past and future.

**New:** `hubKey = crypto.getRandomValues(32)` — random, ECIES-wrapped for each member individually. Rotation generates a genuinely new key with no mathematical link to the old one.

### 2. Server is Authoritative for State, Relay for Events

- **REST for state mutations**: answer call, create note, reassign conversation
- **Nostr for event propagation**: call:ring, call:answered, presence (broadcast to subscribers)
- **REST for state recovery**: on reconnect, poll `/api/calls/active`, `/api/conversations`

### 3. Ephemeral Nostr Events (Not Replaceable)

Kind 20001 (ephemeral) — relay forwards to subscribers but never stores. Kind 1 (regular) for persistent events like shift updates.

### 4. Generic Event Tags (No Operational Tempo Leak)

All events use `["t", "llamenos:event"]`. Actual event type is INSIDE the encrypted content. Relay cannot distinguish `call:ring` from `typing`.

### 5. Presence RBAC Preserved

Two separate presence events:
- Hub-key encrypted: `{ hasAvailable: boolean }` for all members
- Per-admin ECIES: `{ available: N, onCall: N, total: N }` for admins only

### 6. Multi-Admin from Day One

Every admin envelope is per-admin ECIES. Adding/removing admins wraps/revokes keys individually. No shared admin secret.

### 7. nsec Never on Main Thread

The crypto worker holds the nsec in a closure. The main thread communicates via `postMessage` with request/response IDs. Rate limiting in the worker auto-locks on abuse. This prevents XSS from trivially exfiltrating the key — an attacker would need to use the worker API, which is rate-limited and auto-locks.

### 8. Honest Trust Boundaries

| Claim | Reality |
| ----- | ------- |
| "Server can't read content" | TRUE for stored data. Server sees outbound SMS/WhatsApp plaintext momentarily (inherent provider limitation). |
| "Multi-factor protects the nsec" | TRUE. Need PIN + IdP value + optionally WebAuthn PRF. Single factor compromise is insufficient. |
| "E2EE for all messages" | TRUE for storage. FALSE for the SMS/WhatsApp transport layer (provider sees plaintext — inherent). |
| "Audio never leaves device" | TRUE for transcription. Audio is captured locally only (volunteer mic). |
| "Hub key protects org metadata" | TRUE. Server stores ciphertext. But hub key is shared — any hub member can decrypt Tier 2 data. |

## Implementation Checklist

### Before Starting (Epic 76.0) — Complete

- [x] Domain separation labels audited and fixed (`src/shared/crypto-labels.ts`, 30+ constants)
- [x] Provisioning SAS verification implemented
- [x] Emergency key revocation procedures documented
- [x] Threat model updated with all new trust parties
- [x] Backup file privacy fixed

### Architecture Proven (Epics 76.1 + 76.2) — Complete

- [x] Worker-to-relay publishing PoC passing latency budget (<1s)
- [x] Hub key as random secret with ECIES distribution working
- [x] Multi-admin envelope pattern working
- [x] Correct NIP-44 usage verified

### Per-Feature Implementation — Complete

All features verified:

1. [x] Data flow designed (E2EE from the start)
2. [x] Correct domain separation label used (all labels in `crypto-labels.ts`)
3. [x] Key distribution planned (multi-admin compatible)
4. [x] E2E tests written
5. [x] Performance impact assessed
6. [x] Documentation updated

### Field-Level Encryption — Complete

- [x] Tier 1 envelope encryption for all PII fields
- [x] Tier 2 hub-key encryption for all org metadata
- [x] Tier 3 forward secrecy for notes, messages, reports
- [x] Decrypt-on-fetch pattern across all React Query domains
- [x] ENCRYPTED_QUERY_KEYS exhaustiveness enforced at compile time
- [x] Zero plaintext PII in database verified

### Multi-Factor KEK — Complete

- [x] PBKDF2 + HKDF KEK derivation (2F and 3F modes)
- [x] Authentik IdP integration for nsecSecret factor
- [x] Synthetic fallback for device-link flows
- [x] Auto-rotation from synthetic to real IdP value
- [x] KEK re-encryption inside crypto worker

### Implementation Verification — In Progress

- [x] Server code audit: no private keys held, no plaintext access paths
- [x] Database schema audit: only ciphertext stored for sensitive data
- [x] Network audit: real-time via relay only (WebSocket code deleted)
- [ ] External penetration test of architecture
- [x] Documentation complete and honest about limitations
- [x] Security page updated

## Resolved Design Decisions

1. **Multi-hub key management**: Each hub has an independent random key. Clients store multiple hub keys indexed by hub ID and key version. Hub switcher UI selects the active hub context.

2. **Relay architecture**: Single self-hosted relay (strfry for Docker/K8s). Federation deferred — single relay is sufficient for the target scale. REST polling fallback for state recovery on reconnect.

3. **Offline support**: Notes support full offline operation (local encrypted drafts). Calls require connectivity (telephony is inherently online). Messages queue locally and send when connected.

4. **Transcription scope**: Local microphone only via WASM Whisper (Epic 78). Remote party audio requires replacing Twilio SDK with raw WebRTC — deferred to post-MVP. This is a known limitation documented in the security model.

5. **KEK factor design**: Concatenation + HKDF rather than XOR. HKDF is a proper key derivation function that handles uneven entropy distribution across factors. Separate info labels for 2F vs 3F prevent factor-count downgrade attacks.

## Success Metrics

| Metric | Target |
| ------ | ------ |
| Server private key access | Zero (server has only its own nsec + user npubs) |
| Server plaintext content access | Zero stored (outbound SMS/WhatsApp momentary, discarded) |
| Metadata visible to server | Zero plaintext PII; minimal routing metadata only |
| External data flows | Zero for audio (local transcription) |
| Verification possible | Yes (reproducible builds, GitHub Release checksums) |
| User experience impact | Minimal (< 1s latency increase) |
| nsec exposure surface | Crypto worker only; never on main thread |
| KEK factors required | Minimum 2 (PIN + IdP); optional 3rd (WebAuthn PRF) |

## Source Files

| File | Role |
|------|------|
| `src/shared/crypto-labels.ts` | All domain separation constants |
| `src/shared/crypto-types.ts` | Branded `Ciphertext` and `HmacHash` types |
| `src/client/lib/crypto-worker.ts` | Web Worker — holds nsec, all private-key operations |
| `src/client/lib/crypto-worker-client.ts` | Main-thread client for crypto worker |
| `src/client/lib/key-manager.ts` | Singleton key manager — multi-factor unlock |
| `src/client/lib/key-store-v2.ts` | KEK derivation (PBKDF2 + HKDF), encrypted storage |
| `src/client/lib/hub-key-manager.ts` | Hub key generation, wrapping, rotation |
| `src/client/lib/hub-key-cache.ts` | Module-level hub key cache |
| `src/client/lib/hub-field-crypto.ts` | Tier 2 encrypt/decrypt helpers |
| `src/client/lib/decrypt-fields.ts` | Tier 1 decrypt-on-fetch utilities |
| `src/client/lib/query-client.ts` | ENCRYPTED_QUERY_KEYS, invalidation |
| `src/client/lib/auth.tsx` | Unlock flow: hub key load → query invalidation |
| `src/server/db/crypto-columns.ts` | Drizzle column type helpers |
| `src/server/messaging/router.ts` | Server-side envelope encryption on webhook |
