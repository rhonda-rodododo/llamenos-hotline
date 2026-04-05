# Machine Reporter Pattern

## Purpose

The machine reporter pattern defines how automated server-side agents author structured, E2EE reports on behalf of the system. It exists to give automated processes — transcription engines, LLM extraction agents, radio monitors — the same cryptographic standing as human users when creating persistent, user-visible content.

Without this pattern, automated content either lands unencrypted (a security regression), gets authored under a shared server identity (no auditability per agent), or lacks a well-defined lifecycle (nsec leakage on crash). The pattern solves all three.

**When to apply:** Any automated process that creates persistent, human-reviewable, E2EE content and requires audit accountability should follow this pattern.

---

## Current Implementations

| Agent | Source | Output |
|---|---|---|
| **Transcription agent** | WASM Whisper / client-side | E2EE call notes (`LABEL_TRANSCRIPTION`) |
| **Firehose agent** | Signal group ingestion + LLM extraction | E2EE firehose reports (`LABEL_FIREHOSE_REPORT_WRAP`) |

The firehose agent is the canonical server-side implementation; use it as the reference when adding new agents.

---

## Machine Identity

Each agent instance gets its own Nostr keypair. The keypair provides:

- **Accountability**: Every report is signed by a specific agent instance, not a generic server key.
- **Encryption participation**: The agent's pubkey is one of the envelope recipients so it can re-read its own outputs during the run.
- **Auditability**: Admin audit logs include the agent pubkey as the `authorPubkey` field.

### Generating a keypair

```typescript
import { generateAgentKeypair } from '@server/lib/agent-identity'
import { LABEL_MY_AGENT_SEAL } from '@shared/crypto-labels'

const { pubkey, encryptedNsec } = generateAgentKeypair(
  agentInstanceId,   // stable UUID — HKDF salt, ties ciphertext to this instance
  sealKey,           // FIREHOSE_AGENT_SEAL_KEY or equivalent deploy secret (hex 32 bytes)
  LABEL_MY_AGENT_SEAL  // domain separation constant from crypto-labels.ts
)
```

`generateAgentKeypair` (`src/server/lib/agent-identity.ts`):

1. Generates a random secp256k1 keypair via `schnorr.utils.randomSecretKey()`.
2. Derives a per-instance encryption key: `HKDF(sha256, sealKey, salt=agentId, info=sealLabel, 32)`.
3. Seals the nsec with XChaCha20-Poly1305 (nonce prepended): `nonce || AEAD(nsecHex)`.
4. Zeros the raw `nsecBytes` from memory before returning.
5. Returns `{ pubkey, encryptedNsec }` — both stored in the DB alongside the agent record.

The `encryptedNsec` is bound to the specific `agentId` and `sealLabel`. Replaying it with the wrong ID or label fails AEAD authentication.

### Unsealing at startup

```typescript
import { unsealAgentNsec } from '@server/lib/agent-identity'
import { LABEL_MY_AGENT_SEAL } from '@shared/crypto-labels'

const nsecHex = unsealAgentNsec(
  agentInstanceId,
  conn.encryptedAgentNsec,
  sealKey,
  LABEL_MY_AGENT_SEAL
)
const nsecBytes = hexToBytes(nsecHex)
// ... use nsecBytes for decryption/signing
```

### Zeroing on shutdown

Every agent holds `nsecBytes: Uint8Array` in its in-memory state. On `stopAgent` / `shutdown`:

```typescript
agent.nsecBytes.fill(0)
```

This limits the window of nsec exposure to the agent's active lifetime. The sealed blob in the DB is the persistent form; the live bytes are ephemeral.

### Deploy secret

The seal key is a 32-byte random hex value stored as an env var (`FIREHOSE_AGENT_SEAL_KEY` for the firehose agent). Each new agent type should use a dedicated env var — do not reuse the same key across agent types even though domain separation via `sealLabel` would technically prevent cross-agent decryption.

### Adding a new seal label

Before implementing a new agent, add a constant to `src/shared/crypto-labels.ts`:

```typescript
// --- SDR Report Agent ---

/** SDR agent nsec sealed encryption (per-receiver, derived from deploy secret) */
export const LABEL_SDR_AGENT_SEAL = 'llamenos:sdr:agent-seal'
```

Never use raw string literals for crypto labels in code.

---

## Envelope Encryption for Outputs

Agent-authored content must be E2EE — the server must not hold plaintext. Follow the envelope encryption pattern used in `firehose-agent.ts`:

```typescript
import { LABEL_MY_AGENT_REPORT_WRAP } from '@shared/crypto-labels'

// Collect recipients: agent itself + admins + any users with reports:read-all
const adminPubkeys = await this.identity.getSuperAdminPubkeys()
const recipientPubkeys = [
  ...new Set([agentPubkey, ...adminPubkeys.filter((pk) => /^[0-9a-f]{64}$/i.test(pk))]),
]

// Envelope-encrypt
const { encrypted, envelopes } = this.crypto.envelopeEncrypt(
  reportContent,          // plaintext JSON string
  recipientPubkeys,
  LABEL_MY_AGENT_REPORT_WRAP
)

// Create conversation / report record
const conversation = await this.conversations.createConversation({ ... })

// Attach encrypted content as first message
await this.conversations.addMessage({
  conversationId: conversation.id,
  direction: 'inbound',
  authorPubkey: agentPubkey,
  encryptedContent: encrypted as string,
  readerEnvelopes: envelopes,
  hasAttachments: false,
  status: 'delivered',
})
```

Each agent type needs its own `LABEL_*_REPORT_WRAP` constant — reports from different agent types must not share an encryption domain.

---

## Audit Logging

Every agent action that creates or modifies persistent data must emit an audit entry. Use the format:

```
authorPubkey: agentPubkey   // the agent's own pubkey, not a user pubkey
```

Recommended audit event names (add new ones to the audit event enum as needed):

| Event | When |
|---|---|
| `firehoseReportExtracted` | Report successfully created from buffer |
| `firehoseDecryptionFailed` | Could not decrypt a buffered message |
| `firehoseCircuitBreakerTripped` | Agent auto-paused after consecutive failures |

For new agent types, follow the naming convention `{agentType}ReportExtracted`, `{agentType}DecryptionFailed`, etc.

---

## Admin Notifications

After submitting a report, notify admins:

1. **Nostr event** (always): Publish an ephemeral event to the hub relay. Use the agent-type-specific Nostr kind constant (e.g. `KIND_FIREHOSE_REPORT`). Content is a small JSON payload with connection/report IDs — no PII, no plaintext content.

2. **Channel-specific DM** (optional, per-connection setting): For example, Signal DM for firehose agents when `notifyViaSignal` is enabled. Check per-user opt-out via `FirehoseService.isOptedOut()` or equivalent before sending.

Notification example from the firehose agent:

```typescript
publisher.publish({
  kind: KIND_FIREHOSE_REPORT,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['d', hubId],
    ['t', 'llamenos:event'],
    ['c', connectionId],
  ],
  content: JSON.stringify({
    type: 'firehose:report:notify',
    connectionId,
    reportId,
    confidence,
  }),
})
```

Always wrap publisher calls in try/catch — missing publisher config is expected in test and non-Signal environments.

---

## Agent Lifecycle

### Initialization (server startup)

```typescript
async init(): Promise<void> {
  const connections = await this.firehose.listActiveConnections()
  for (const conn of connections) {
    await this.startAgent(conn.id)
  }
}
```

### startAgent

1. Load connection record from DB.
2. Verify status is `active` (throw otherwise — caller handles gracefully).
3. Unseal `encryptedAgentNsec` → `nsecBytes` (held in memory).
4. Create or reuse inference/processing client for the configured endpoint.
5. Start periodic extraction loop via `setInterval`.
6. Store `AgentInstance` state in the in-memory map.
7. Reset circuit breaker counter.

### stopAgent

1. `clearInterval` on the extraction loop handle.
2. Zero `nsecBytes` (`agent.nsecBytes.fill(0)`).
3. Remove from the in-memory map.

### shutdown (graceful process exit)

```typescript
shutdown(): void {
  for (const connectionId of this.agents.keys()) {
    this.stopAgent(connectionId)
  }
  this.inferenceClients.clear()
}
```

Wire `shutdown()` to the process `SIGTERM` / `SIGINT` handler in `server.ts`.

### Circuit breaker

Track consecutive extraction failures per agent. After `CIRCUIT_BREAKER_THRESHOLD` (default: 3) consecutive failures:

1. `stopAgent(connectionId)` — zeros nsec.
2. Update connection status to `'paused'` in DB.
3. Emit `{agentType}CircuitBreakerTripped` audit entry.

The connection can be manually re-activated by an admin, which triggers `startAgent` again.

---

## Canonical submitReport Flow

The complete flow from raw input to stored E2EE report, as implemented in `firehose-agent.ts`:

```typescript
async submitReport(
  conn: { id: string; hubId: string; reportTypeId: string; agentPubkey: string },
  reportContent: string,   // plaintext JSON — never persisted
  nsecBytes: Uint8Array,   // from in-memory AgentInstance
): Promise<string> {
  // 1. Build recipient list
  const adminPubkeys = await this.identity.getSuperAdminPubkeys()
  const recipientPubkeys = [
    ...new Set([conn.agentPubkey, ...adminPubkeys.filter(pk => /^[0-9a-f]{64}$/i.test(pk))]),
  ]

  // 2. Envelope-encrypt
  const { encrypted, envelopes } = this.crypto.envelopeEncrypt(
    reportContent,
    recipientPubkeys,
    LABEL_MY_AGENT_REPORT_WRAP
  )

  // 3. Create conversation record
  const conversation = await this.conversations.createConversation({
    hubId: conn.hubId,
    channelType: 'web',
    contactIdentifierHash: conn.agentPubkey,
    skipDedup: true,
    status: 'waiting',
    metadata: { type: 'report', /* agent-specific metadata */ },
    reportTypeId: conn.reportTypeId,
  })

  // 4. Attach encrypted content as first message
  await this.conversations.addMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    authorPubkey: conn.agentPubkey,
    encryptedContent: encrypted as string,
    readerEnvelopes: envelopes,
    hasAttachments: false,
    status: 'delivered',
  })

  // 5. Audit log
  await this.records.addAuditEntry(conn.hubId, 'myAgentReportExtracted', conn.agentPubkey, {
    conversationId: conversation.id,
    connectionId: conn.id,
  })

  // 6. Notify admins
  await this.notifyAdmins(conn, conversation.id)

  return conversation.id
}
```

The plaintext `reportContent` is never written to the DB — it exists only in the stack frame of this function before being handed to `envelopeEncrypt`.

---

## References

- `src/server/lib/agent-identity.ts` — shared keypair generation and sealing
- `src/server/services/firehose-agent.ts` — canonical implementation
- `src/server/services/firehose.ts` — connection CRUD (FirehoseService)
- `src/server/routes/firehose.ts` — connection creation + keypair generation at API layer
- `src/shared/crypto-labels.ts` — all domain separation constants
- `src/server/lib/crypto-service.ts` — `envelopeEncrypt` / `envelopeDecrypt`
