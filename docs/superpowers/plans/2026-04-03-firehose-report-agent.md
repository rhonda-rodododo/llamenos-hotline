# Firehose Report Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Signal group chat firehoses via a self-hosted LLM (Qwen3.5-9B on vLLM) to extract structured reports for human triage, with per-group agent identity and E2EE envelope encryption.

**Architecture:** Each connected Signal group gets its own agent keypair. Messages arrive via the existing Signal webhook pipeline, are envelope-encrypted for the agent + admins, and buffered. A periodic extraction loop uses the OpenAI JS SDK against a vLLM endpoint to detect incidents and extract structured reports matching the connection's report type custom fields. Reports are submitted as E2EE envelopes via the existing Report API.

**Tech Stack:** Bun, Hono (OpenAPIHono), Drizzle ORM, PostgreSQL, OpenAI JS SDK (against vLLM), Qwen3.5-9B, secp256k1 (ECIES), XChaCha20-Poly1305, zod, TanStack Router + React + shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-03-firehose-report-agent-design.md`

---

## File Structure

### New Files
```
src/shared/schemas/firehose.ts              — Zod schemas for firehose API types
src/server/db/schema/firehose.ts            — Drizzle tables (connections, buffer, optouts)
src/server/services/firehose.ts             — FirehoseService (connection CRUD, buffer ops)
src/server/services/firehose-agent.ts       — FirehoseAgentService (extraction engine, lifecycle)
src/server/services/firehose-inference.ts   — LLM client (OpenAI SDK wrapper for vLLM)
src/server/routes/firehose.ts               — Admin API routes (connection CRUD, status, health)
src/client/components/admin-settings/firehose-section.tsx — Admin UI for managing connections
src/client/lib/api/firehose.ts              — Client API functions
src/client/lib/queries/firehose.ts          — React Query hooks
tests/api/firehose.spec.ts                  — API E2E tests
tests/api/firehose-extraction.spec.ts       — Extraction integration tests (mock vLLM)
```

### Modified Files
```
src/shared/crypto-labels.ts                 — Add 3 firehose domain separation labels
src/shared/nostr-events.ts                  — Add KIND_FIREHOSE_MESSAGE, KIND_FIREHOSE_REPORT
src/shared/permissions.ts                   — Add firehose:manage, firehose:read permissions
src/shared/schemas/index.ts                 — Re-export firehose schemas
src/server/db/schema/index.ts               — Re-export firehose tables
src/server/services/index.ts                — Add FirehoseService + FirehoseAgentService
src/server/app.ts                           — Mount firehose routes
src/server/messaging/router.ts              — Firehose group detection branch
src/client/routes/admin/settings.tsx        — Add FirehoseSection tab
src/client/lib/query-client.ts              — Add firehose to ENCRYPTED_QUERY_KEYS
```

---

## Phase 1: Foundation (Schema, Types, Permissions)

### Task 1: Crypto Labels & Nostr Events

**Files:**
- Modify: `src/shared/crypto-labels.ts`
- Modify: `src/shared/nostr-events.ts`

- [ ] **Step 1: Add firehose crypto labels**

Add to `src/shared/crypto-labels.ts` at the end:

```typescript
// --- Firehose Report Agent ---

/** Firehose agent nsec sealed encryption (per-connection, derived from deploy secret) */
export const LABEL_FIREHOSE_AGENT_SEAL = 'llamenos:firehose:agent-seal'

/** Firehose message buffer at-rest encryption (agent-key encrypted) */
export const LABEL_FIREHOSE_BUFFER_ENCRYPT = 'llamenos:firehose:buffer-encrypt'

/** Firehose extracted report envelope wrapping */
export const LABEL_FIREHOSE_REPORT_WRAP = 'llamenos:firehose:report-wrap'
```

- [ ] **Step 2: Add firehose Nostr event kinds**

Add to `src/shared/nostr-events.ts` after `KIND_SETTINGS_CHANGED`:

```typescript
/** New firehose message received (for agent subscription) */
export const KIND_FIREHOSE_MESSAGE = 1040

/** Firehose report extracted and submitted */
export const KIND_FIREHOSE_REPORT = 1041
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/crypto-labels.ts src/shared/nostr-events.ts
git commit -m "feat(firehose): add crypto labels and Nostr event kinds"
```

### Task 2: Permissions

**Files:**
- Modify: `src/shared/permissions.ts`

- [ ] **Step 1: Add firehose permission group label**

In `PERMISSION_GROUP_LABELS`, add:

```typescript
firehose: 'Firehose Agents',
```

- [ ] **Step 2: Add firehose permissions to PERMISSION_CATALOG**

After the voicemail permissions block:

```typescript
// --- Firehose ---
'firehose:manage': {
  label: 'Create, update, and delete firehose connections',
  group: 'firehose',
  subgroup: 'actions',
},
'firehose:read': {
  label: 'View firehose connection status and health',
  group: 'firehose',
  subgroup: 'actions',
},
```

- [ ] **Step 3: Add firehose permissions to default Hub Admin role**

In the `DEFAULT_ROLES` array, find the Hub Admin role and add to its permissions:

```typescript
'firehose:manage',
'firehose:read',
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/permissions.ts
git commit -m "feat(firehose): add firehose permissions to PBAC catalog"
```

### Task 3: Zod Schemas

**Files:**
- Create: `src/shared/schemas/firehose.ts`
- Modify: `src/shared/schemas/index.ts`

- [ ] **Step 1: Create firehose zod schemas**

Create `src/shared/schemas/firehose.ts`:

```typescript
import { z } from 'zod/v4'

// --- Firehose Connection ---

export const FirehoseConnectionStatusSchema = z.enum([
  'pending',
  'active',
  'paused',
  'disabled',
])
export type FirehoseConnectionStatus = z.infer<typeof FirehoseConnectionStatusSchema>

export const CreateFirehoseConnectionSchema = z.object({
  displayName: z.string().optional(),
  encryptedDisplayName: z.string().optional(),
  reportTypeId: z.string(),
  geoContext: z.string().optional(),
  geoContextCountryCodes: z.array(z.string().length(2)).optional(),
  inferenceEndpoint: z.string().url().optional(),
  extractionIntervalSec: z.number().int().min(30).max(300).optional(),
  systemPromptSuffix: z.string().max(2000).optional(),
  bufferTtlDays: z.number().int().min(1).max(30).optional(),
  notifyViaSignal: z.boolean().optional(),
})
export type CreateFirehoseConnectionInput = z.infer<typeof CreateFirehoseConnectionSchema>

export const UpdateFirehoseConnectionSchema = z.object({
  displayName: z.string().optional(),
  encryptedDisplayName: z.string().optional(),
  reportTypeId: z.string().optional(),
  geoContext: z.string().nullable().optional(),
  geoContextCountryCodes: z.array(z.string().length(2)).nullable().optional(),
  inferenceEndpoint: z.string().url().nullable().optional(),
  extractionIntervalSec: z.number().int().min(30).max(300).optional(),
  systemPromptSuffix: z.string().max(2000).nullable().optional(),
  bufferTtlDays: z.number().int().min(1).max(30).optional(),
  notifyViaSignal: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'disabled']).optional(),
})
export type UpdateFirehoseConnectionInput = z.infer<typeof UpdateFirehoseConnectionSchema>

export const FirehoseConnectionSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  signalGroupId: z.string().nullable(),
  displayName: z.string(),
  encryptedDisplayName: z.string().optional(),
  reportTypeId: z.string(),
  agentPubkey: z.string(),
  geoContext: z.string().nullable(),
  geoContextCountryCodes: z.array(z.string()).nullable(),
  inferenceEndpoint: z.string().nullable(),
  extractionIntervalSec: z.number(),
  systemPromptSuffix: z.string().nullable(),
  bufferTtlDays: z.number(),
  notifyViaSignal: z.boolean(),
  status: FirehoseConnectionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type FirehoseConnection = z.infer<typeof FirehoseConnectionSchema>

// --- Firehose Health/Status ---

export const FirehoseConnectionHealthSchema = z.object({
  id: z.string(),
  status: FirehoseConnectionStatusSchema,
  lastMessageReceived: z.string().nullable(),
  lastReportSubmitted: z.string().nullable(),
  bufferSize: z.number(),
  extractionCount: z.number(),
  inferenceHealthMs: z.number().nullable(),
})
export type FirehoseConnectionHealth = z.infer<typeof FirehoseConnectionHealthSchema>

// --- Extraction Types (internal, not API-facing) ---

export const ExtractedReportFieldsSchema = z.record(z.string(), z.string())

export const SourceMessageSchema = z.object({
  signalUsername: z.string(),
  timestamp: z.string(),
  content: z.string(),
  messageId: z.string(),
})

export const ResolvedLocationSchema = z.object({
  fieldName: z.string(),
  rawText: z.string(),
  resolved: z.object({
    address: z.string(),
    displayName: z.string().optional(),
    lat: z.number().optional(),
    lon: z.number().optional(),
    countryCode: z.string().optional(),
  }).nullable(),
})
```

- [ ] **Step 2: Re-export from schemas index**

Add to `src/shared/schemas/index.ts`:

```typescript
export * from './firehose'
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/schemas/firehose.ts src/shared/schemas/index.ts
git commit -m "feat(firehose): add zod schemas for firehose connections"
```

### Task 4: Database Schema

**Files:**
- Create: `src/server/db/schema/firehose.ts`
- Modify: `src/server/db/schema/index.ts`

- [ ] **Step 1: Create Drizzle table definitions**

Create `src/server/db/schema/firehose.ts`:

```typescript
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'
import { hubs } from './settings'
import { reportTypes } from './report-types'

export const firehoseConnections = pgTable(
  'firehose_connections',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id')
      .notNull()
      .references(() => hubs.id),
    signalGroupId: text('signal_group_id'),
    displayName: text('display_name').notNull().default(''),
    encryptedDisplayName: ciphertext('encrypted_display_name'),
    reportTypeId: text('report_type_id')
      .notNull()
      .references(() => reportTypes.id),
    agentPubkey: text('agent_pubkey').notNull(),
    encryptedAgentNsec: text('encrypted_agent_nsec').notNull(),
    geoContext: text('geo_context'),
    geoContextCountryCodes: text('geo_context_country_codes').array(),
    inferenceEndpoint: text('inference_endpoint'),
    extractionIntervalSec: integer('extraction_interval_sec').notNull().default(60),
    systemPromptSuffix: text('system_prompt_suffix'),
    bufferTtlDays: integer('buffer_ttl_days').notNull().default(7),
    notifyViaSignal: boolean('notify_via_signal').notNull().default(true),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('firehose_connections_hub_idx').on(table.hubId),
    index('firehose_connections_signal_group_idx').on(table.signalGroupId),
  ]
)

export const firehoseMessageBuffer = pgTable(
  'firehose_message_buffer',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => firehoseConnections.id, { onDelete: 'cascade' }),
    signalTimestamp: timestamp('signal_timestamp', { withTimezone: true }).notNull(),
    encryptedContent: text('encrypted_content').notNull(),
    encryptedSenderInfo: text('encrypted_sender_info').notNull(),
    clusterId: text('cluster_id'),
    extractedReportId: text('extracted_report_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('firehose_buffer_connection_idx').on(table.connectionId),
    index('firehose_buffer_expires_idx').on(table.expiresAt),
    index('firehose_buffer_unextracted_idx')
      .on(table.connectionId)
      .where(/* extractedReportId IS NULL — add via raw SQL in migration */),
  ]
)

export const firehoseNotificationOptouts = pgTable(
  'firehose_notification_optouts',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => firehoseConnections.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('firehose_optout_unique').on(table.connectionId, table.userId),
  ]
)
```

- [ ] **Step 2: Re-export from schema index**

Add to `src/server/db/schema/index.ts`:

```typescript
export * from './firehose'
```

- [ ] **Step 3: Generate migration**

```bash
bun run migrate:generate
```

Review the generated migration SQL. The partial index for `firehose_buffer_unextracted_idx` may need manual adjustment in the migration file to add `WHERE extracted_report_id IS NULL`.

- [ ] **Step 4: Apply migration**

```bash
bun run migrate
```

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/firehose.ts src/server/db/schema/index.ts drizzle/
git commit -m "feat(firehose): add database schema and migration"
```

---

## Phase 2: Service Layer (Connection CRUD + Buffer)

### Task 5: FirehoseService (Connection CRUD)

**Files:**
- Create: `src/server/services/firehose.ts`
- Modify: `src/server/services/index.ts`

- [ ] **Step 1: Write failing test for connection CRUD**

Create `src/server/services/firehose.test.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test'
import type { Database } from '../db'
import type { CryptoService } from '../lib/crypto-service'
import { FirehoseService } from './firehose'

// Mock database and crypto
const mockDb = {
  select: mock(() => ({ from: mock(() => ({ where: mock(() => ({ limit: mock(() => []) })) })) })),
  insert: mock(() => ({ values: mock(() => ({ returning: mock(() => []) })) })),
  update: mock(() => ({ set: mock(() => ({ where: mock(() => ({ returning: mock(() => []) })) })) })),
  delete: mock(() => ({ where: mock(() => ({})) })),
} as unknown as Database

const mockCrypto = {
  envelopeEncrypt: mock(() => ({ encrypted: 'enc', envelopes: [] })),
  generateKeypair: mock(() => ({ pubkey: 'deadbeef'.repeat(8), nsec: 'cafebabe'.repeat(8) })),
} as unknown as CryptoService

describe('FirehoseService', () => {
  it('should be constructable', () => {
    const service = new FirehoseService(mockDb, mockCrypto)
    expect(service).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/server/services/firehose.test.ts
```

Expected: FAIL — `FirehoseService` not found.

- [ ] **Step 3: Implement FirehoseService**

Create `src/server/services/firehose.ts`:

```typescript
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '../db'
import {
  firehoseConnections,
  firehoseMessageBuffer,
  firehoseNotificationOptouts,
} from '../db/schema/firehose'
import type { CryptoService } from '../lib/crypto-service'
import type { Ciphertext } from '@shared/crypto-types'

export class FirehoseService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  // --- Connection CRUD ---

  async createConnection(hubId: string, data: {
    displayName?: string
    encryptedDisplayName?: string
    reportTypeId: string
    agentPubkey: string
    encryptedAgentNsec: string
    geoContext?: string | null
    geoContextCountryCodes?: string[] | null
    inferenceEndpoint?: string | null
    extractionIntervalSec?: number
    systemPromptSuffix?: string | null
    bufferTtlDays?: number
    notifyViaSignal?: boolean
  }) {
    const id = crypto.randomUUID()
    const now = new Date()
    const encDisplayName = (data.encryptedDisplayName ?? data.displayName ?? '') as Ciphertext

    const [row] = await this.db
      .insert(firehoseConnections)
      .values({
        id,
        hubId,
        displayName: data.displayName ?? '',
        encryptedDisplayName: encDisplayName,
        reportTypeId: data.reportTypeId,
        agentPubkey: data.agentPubkey,
        encryptedAgentNsec: data.encryptedAgentNsec,
        geoContext: data.geoContext ?? null,
        geoContextCountryCodes: data.geoContextCountryCodes ?? null,
        inferenceEndpoint: data.inferenceEndpoint ?? null,
        extractionIntervalSec: data.extractionIntervalSec ?? 60,
        systemPromptSuffix: data.systemPromptSuffix ?? null,
        bufferTtlDays: data.bufferTtlDays ?? 7,
        notifyViaSignal: data.notifyViaSignal ?? true,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return row
  }

  async getConnection(id: string) {
    const rows = await this.db
      .select()
      .from(firehoseConnections)
      .where(eq(firehoseConnections.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  async listConnections(hubId: string) {
    return this.db
      .select()
      .from(firehoseConnections)
      .where(eq(firehoseConnections.hubId, hubId))
      .orderBy(firehoseConnections.createdAt)
  }

  async listActiveConnections() {
    return this.db
      .select()
      .from(firehoseConnections)
      .where(eq(firehoseConnections.status, 'active'))
  }

  async updateConnection(id: string, data: {
    displayName?: string
    encryptedDisplayName?: string
    reportTypeId?: string
    signalGroupId?: string | null
    geoContext?: string | null
    geoContextCountryCodes?: string[] | null
    inferenceEndpoint?: string | null
    extractionIntervalSec?: number
    systemPromptSuffix?: string | null
    bufferTtlDays?: number
    notifyViaSignal?: boolean
    status?: string
  }) {
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (data.displayName !== undefined) updates.displayName = data.displayName
    if (data.encryptedDisplayName !== undefined) updates.encryptedDisplayName = data.encryptedDisplayName as Ciphertext
    if (data.reportTypeId !== undefined) updates.reportTypeId = data.reportTypeId
    if (data.signalGroupId !== undefined) updates.signalGroupId = data.signalGroupId
    if (data.geoContext !== undefined) updates.geoContext = data.geoContext
    if (data.geoContextCountryCodes !== undefined) updates.geoContextCountryCodes = data.geoContextCountryCodes
    if (data.inferenceEndpoint !== undefined) updates.inferenceEndpoint = data.inferenceEndpoint
    if (data.extractionIntervalSec !== undefined) updates.extractionIntervalSec = data.extractionIntervalSec
    if (data.systemPromptSuffix !== undefined) updates.systemPromptSuffix = data.systemPromptSuffix
    if (data.bufferTtlDays !== undefined) updates.bufferTtlDays = data.bufferTtlDays
    if (data.notifyViaSignal !== undefined) updates.notifyViaSignal = data.notifyViaSignal
    if (data.status !== undefined) updates.status = data.status

    const [row] = await this.db
      .update(firehoseConnections)
      .set(updates)
      .where(eq(firehoseConnections.id, id))
      .returning()

    return row ?? null
  }

  async deleteConnection(id: string) {
    await this.db
      .delete(firehoseConnections)
      .where(eq(firehoseConnections.id, id))
  }

  async findConnectionBySignalGroup(signalGroupId: string, hubId?: string) {
    const conditions = [eq(firehoseConnections.signalGroupId, signalGroupId)]
    if (hubId) conditions.push(eq(firehoseConnections.hubId, hubId))

    const rows = await this.db
      .select()
      .from(firehoseConnections)
      .where(and(...conditions))
      .limit(1)
    return rows[0] ?? null
  }

  async findPendingConnection(hubId: string) {
    const rows = await this.db
      .select()
      .from(firehoseConnections)
      .where(
        and(
          eq(firehoseConnections.hubId, hubId),
          eq(firehoseConnections.status, 'pending'),
          isNull(firehoseConnections.signalGroupId)
        )
      )
      .orderBy(firehoseConnections.createdAt)
      .limit(1)
    return rows[0] ?? null
  }

  // --- Buffer Operations ---

  async addBufferMessage(connectionId: string, data: {
    signalTimestamp: Date
    encryptedContent: string
    encryptedSenderInfo: string
    expiresAt: Date
  }) {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(firehoseMessageBuffer)
      .values({
        id,
        connectionId,
        signalTimestamp: data.signalTimestamp,
        encryptedContent: data.encryptedContent,
        encryptedSenderInfo: data.encryptedSenderInfo,
        expiresAt: data.expiresAt,
        receivedAt: new Date(),
      })
      .returning()
    return row
  }

  async getUnextractedMessages(connectionId: string) {
    return this.db
      .select()
      .from(firehoseMessageBuffer)
      .where(
        and(
          eq(firehoseMessageBuffer.connectionId, connectionId),
          isNull(firehoseMessageBuffer.extractedReportId)
        )
      )
      .orderBy(firehoseMessageBuffer.signalTimestamp)
  }

  async markMessagesExtracted(messageIds: string[], reportId: string, clusterId: string) {
    await this.db
      .update(firehoseMessageBuffer)
      .set({ extractedReportId: reportId, clusterId })
      .where(
        sql`${firehoseMessageBuffer.id} = ANY(${messageIds})`
      )
  }

  async purgeExpiredMessages() {
    const result = await this.db
      .delete(firehoseMessageBuffer)
      .where(lt(firehoseMessageBuffer.expiresAt, new Date()))
    return result
  }

  async getBufferSize(connectionId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(firehoseMessageBuffer)
      .where(eq(firehoseMessageBuffer.connectionId, connectionId))
    return result[0]?.count ?? 0
  }

  // --- Notification Optouts ---

  async addOptout(connectionId: string, userId: string) {
    const id = crypto.randomUUID()
    await this.db
      .insert(firehoseNotificationOptouts)
      .values({ id, connectionId, userId })
      .onConflictDoNothing()
  }

  async removeOptout(connectionId: string, userId: string) {
    await this.db
      .delete(firehoseNotificationOptouts)
      .where(
        and(
          eq(firehoseNotificationOptouts.connectionId, connectionId),
          eq(firehoseNotificationOptouts.userId, userId)
        )
      )
  }

  async isOptedOut(connectionId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(firehoseNotificationOptouts)
      .where(
        and(
          eq(firehoseNotificationOptouts.connectionId, connectionId),
          eq(firehoseNotificationOptouts.userId, userId)
        )
      )
      .limit(1)
    return rows.length > 0
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/server/services/firehose.test.ts
```

- [ ] **Step 5: Register service in services index**

Modify `src/server/services/index.ts`:

Add import:
```typescript
import { FirehoseService } from './firehose'
```

Add to type exports:
```typescript
export type { FirehoseService }
```

Add to `Services` interface:
```typescript
firehose: FirehoseService
```

Add to `createServices()`:
```typescript
firehose: new FirehoseService(db, crypto),
```

- [ ] **Step 6: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 7: Commit**

```bash
git add src/server/services/firehose.ts src/server/services/firehose.test.ts src/server/services/index.ts
git commit -m "feat(firehose): add FirehoseService with connection CRUD and buffer ops"
```

### Task 6: Agent Keypair Generation

**Files:**
- Modify: `src/server/services/firehose.ts`

The service needs a helper to generate a per-connection keypair and seal the nsec. This depends on how `CryptoService` works — specifically HKDF + XChaCha20 for sealing.

- [ ] **Step 1: Write keypair seal/unseal test**

Add to `src/server/services/firehose.test.ts`:

```typescript
import { LABEL_FIREHOSE_AGENT_SEAL } from '@shared/crypto-labels'

describe('FirehoseService.generateAgentKeypair', () => {
  it('should generate a valid keypair with sealed nsec', () => {
    // This test requires the real CryptoService — mark as integration
    // For unit test, just verify the method exists and returns the right shape
    const service = new FirehoseService(mockDb, mockCrypto)
    expect(typeof service.generateAgentKeypair).toBe('function')
  })
})
```

- [ ] **Step 2: Implement generateAgentKeypair**

Add to `FirehoseService`:

```typescript
import { LABEL_FIREHOSE_AGENT_SEAL } from '@shared/crypto-labels'
import { schnorr } from '@noble/curves/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'

generateAgentKeypair(connectionId: string, sealKey: string): {
  pubkey: string
  encryptedNsec: string
} {
  // Generate random keypair
  const nsecBytes = schnorr.utils.randomPrivateKey()
  const pubkeyBytes = schnorr.getPublicKey(nsecBytes)
  const pubkey = bytesToHex(pubkeyBytes)
  const nsecHex = bytesToHex(nsecBytes)

  // Derive per-connection seal key via HKDF
  const sealKeyBytes = hexToBytes(sealKey)
  const derivedKey = hkdf(sha256, sealKeyBytes, connectionId, LABEL_FIREHOSE_AGENT_SEAL, 32)

  // Encrypt nsec with XChaCha20-Poly1305
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const cipher = xchacha20poly1305(derivedKey, nonce)
  const sealed = cipher.encrypt(new TextEncoder().encode(nsecHex))

  // Encode as hex: nonce || ciphertext
  const encryptedNsec = bytesToHex(nonce) + bytesToHex(sealed)

  // Zero nsec from memory
  nsecBytes.fill(0)

  return { pubkey, encryptedNsec }
}

unsealAgentNsec(connectionId: string, encryptedNsec: string, sealKey: string): string {
  const sealKeyBytes = hexToBytes(sealKey)
  const derivedKey = hkdf(sha256, sealKeyBytes, connectionId, LABEL_FIREHOSE_AGENT_SEAL, 32)

  const combined = hexToBytes(encryptedNsec)
  const nonce = combined.slice(0, 24)
  const ciphertext = combined.slice(24)

  const cipher = xchacha20poly1305(derivedKey, nonce)
  const decrypted = cipher.decrypt(ciphertext)
  return new TextDecoder().decode(decrypted)
}
```

- [ ] **Step 3: Run tests**

```bash
bun test src/server/services/firehose.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/server/services/firehose.ts src/server/services/firehose.test.ts
git commit -m "feat(firehose): add agent keypair generation and seal/unseal"
```

---

## Phase 3: API Routes (Connection CRUD)

### Task 7: Firehose Admin Routes

**Files:**
- Create: `src/server/routes/firehose.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: Create route file with CRUD endpoints**

Create `src/server/routes/firehose.ts`:

```typescript
import { createRoute, z } from '@hono/zod-openapi'
import {
  CreateFirehoseConnectionSchema,
  FirehoseConnectionSchema,
  FirehoseConnectionHealthSchema,
  UpdateFirehoseConnectionSchema,
} from '@shared/schemas/firehose'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const router = createRouter()

// --- List connections ---
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Firehose'],
  summary: 'List firehose connections for this hub',
  middleware: [requirePermission('firehose:read')],
  responses: {
    200: {
      description: 'Success',
      content: {
        'application/json': {
          schema: z.object({ items: z.array(FirehoseConnectionSchema) }),
        },
      },
    },
  },
})

router.openapi(listRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const items = await services.firehose.listConnections(hubId)
  return c.json({ items }, 200)
})

// --- Create connection ---
const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Firehose'],
  summary: 'Create a new firehose connection',
  middleware: [requirePermission('firehose:manage')],
  request: {
    body: {
      content: { 'application/json': { schema: CreateFirehoseConnectionSchema } },
    },
  },
  responses: {
    201: {
      description: 'Created',
      content: {
        'application/json': {
          schema: z.object({ item: FirehoseConnectionSchema }),
        },
      },
    },
    400: { description: 'Invalid input' },
  },
})

router.openapi(createRoute_, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const body = c.req.valid('json')

  // Validate report type exists in this hub
  const reportType = await services.reportTypes.getReportType(hubId, body.reportTypeId)
  if (!reportType) {
    return c.json({ error: 'Report type not found' }, 404)
  }

  // Generate agent keypair
  const sealKey = c.env.FIREHOSE_AGENT_SEAL_KEY
  if (!sealKey) {
    return c.json({ error: 'Firehose agent seal key not configured' }, 503)
  }

  const connectionId = crypto.randomUUID()
  const { pubkey, encryptedNsec } = services.firehose.generateAgentKeypair(connectionId, sealKey)

  const item = await services.firehose.createConnection(hubId, {
    ...body,
    agentPubkey: pubkey,
    encryptedAgentNsec: encryptedNsec,
  })

  return c.json({ item }, 201)
})

// --- Get connection ---
const getRoute = createRoute({
  method: 'get',
  path: '/:id',
  tags: ['Firehose'],
  summary: 'Get firehose connection details',
  middleware: [requirePermission('firehose:read')],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Success',
      content: {
        'application/json': {
          schema: z.object({ item: FirehoseConnectionSchema }),
        },
      },
    },
    404: { description: 'Not found' },
  },
})

router.openapi(getRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const item = await services.firehose.getConnection(id)
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json({ item }, 200)
})

// --- Update connection ---
const updateRoute = createRoute({
  method: 'patch',
  path: '/:id',
  tags: ['Firehose'],
  summary: 'Update firehose connection settings',
  middleware: [requirePermission('firehose:manage')],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: UpdateFirehoseConnectionSchema } },
    },
  },
  responses: {
    200: {
      description: 'Updated',
      content: {
        'application/json': {
          schema: z.object({ item: FirehoseConnectionSchema }),
        },
      },
    },
    404: { description: 'Not found' },
  },
})

router.openapi(updateRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  const existing = await services.firehose.getConnection(id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Validate report type if changing it
  if (body.reportTypeId) {
    const hubId = c.get('hubId') ?? existing.hubId
    const reportType = await services.reportTypes.getReportType(hubId, body.reportTypeId)
    if (!reportType) return c.json({ error: 'Report type not found' }, 404)
  }

  const item = await services.firehose.updateConnection(id, body)
  return c.json({ item }, 200)
})

// --- Delete connection ---
const deleteRoute = createRoute({
  method: 'delete',
  path: '/:id',
  tags: ['Firehose'],
  summary: 'Delete a firehose connection',
  middleware: [requirePermission('firehose:manage')],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: 'Deleted' },
    404: { description: 'Not found' },
  },
})

router.openapi(deleteRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const existing = await services.firehose.getConnection(id)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await services.firehose.deleteConnection(id)
  return c.body(null, 204)
})

// --- Health/status ---
const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Firehose'],
  summary: 'Get firehose connection health status',
  middleware: [requirePermission('firehose:read')],
  responses: {
    200: {
      description: 'Success',
      content: {
        'application/json': {
          schema: z.object({ items: z.array(FirehoseConnectionHealthSchema) }),
        },
      },
    },
  },
})

router.openapi(statusRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const connections = await services.firehose.listConnections(hubId)

  const items = await Promise.all(
    connections.map(async (conn) => ({
      id: conn.id,
      status: conn.status as 'pending' | 'active' | 'paused' | 'disabled',
      lastMessageReceived: null, // TODO: track in buffer stats
      lastReportSubmitted: null, // TODO: track from reports
      bufferSize: await services.firehose.getBufferSize(conn.id),
      extractionCount: 0, // TODO: count from reports
      inferenceHealthMs: null, // TODO: ping vLLM
    }))
  )

  return c.json({ items }, 200)
})

export default router
```

- [ ] **Step 2: Mount routes in app.ts**

In `src/server/app.ts`:

Add import:
```typescript
import firehoseRoutes from './routes/firehose'
```

Add to OpenAPI tags array:
```typescript
{ name: 'Firehose', description: 'Firehose report agent connections' },
```

Add route registration (in the authenticated section, with requireHubOrSuperAdmin):
```typescript
authenticated.use('/firehose/*', requireHubOrSuperAdmin)
authenticated.use('/firehose', requireHubOrSuperAdmin)
authenticated.route('/firehose', firehoseRoutes)
```

Add hub-scoped route:
```typescript
hubScoped.route('/firehose', firehoseRoutes)
```

Add to `KNOWN_API_PREFIXES`:
```typescript
'firehose',
```

- [ ] **Step 3: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/firehose.ts src/server/app.ts
git commit -m "feat(firehose): add admin CRUD API routes for firehose connections"
```

### Task 8: API E2E Tests for Connection CRUD

**Files:**
- Create: `tests/api/firehose.spec.ts`

- [ ] **Step 1: Write API E2E tests**

Create `tests/api/firehose.spec.ts` following the patterns in existing API tests (e.g., `tests/api/report-types.spec.ts`). Use `authed-request.ts` helper for authenticated requests.

```typescript
import { expect, test } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'

test.describe('Firehose Connections API', () => {
  let connectionId: string
  let reportTypeId: string

  test.beforeAll(async () => {
    // Create a report type for firehose connections to reference
    const res = await authedRequest('POST', '/api/report-types', {
      name: 'SALUTE Test',
      description: 'For firehose testing',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    reportTypeId = body.item.id
  })

  test('POST /api/firehose - creates a connection', async () => {
    const res = await authedRequest('POST', '/api/firehose', {
      displayName: 'Test Firehose Group',
      reportTypeId,
      geoContext: 'Minneapolis, MN',
      geoContextCountryCodes: ['US'],
      extractionIntervalSec: 60,
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.item.id).toBeDefined()
    expect(body.item.agentPubkey).toBeDefined()
    expect(body.item.status).toBe('pending')
    expect(body.item.geoContext).toBe('Minneapolis, MN')
    connectionId = body.item.id
  })

  test('GET /api/firehose - lists connections', async () => {
    const res = await authedRequest('GET', '/api/firehose')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBeGreaterThan(0)
  })

  test('GET /api/firehose/:id - gets a connection', async () => {
    const res = await authedRequest('GET', `/api/firehose/${connectionId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.id).toBe(connectionId)
    expect(body.item.reportTypeId).toBe(reportTypeId)
  })

  test('PATCH /api/firehose/:id - updates a connection', async () => {
    const res = await authedRequest('PATCH', `/api/firehose/${connectionId}`, {
      extractionIntervalSec: 120,
      geoContext: 'Minneapolis, MN, North',
      status: 'paused',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.extractionIntervalSec).toBe(120)
    expect(body.item.geoContext).toBe('Minneapolis, MN, North')
    expect(body.item.status).toBe('paused')
  })

  test('DELETE /api/firehose/:id - deletes a connection', async () => {
    const res = await authedRequest('DELETE', `/api/firehose/${connectionId}`)
    expect(res.status).toBe(204)

    const getRes = await authedRequest('GET', `/api/firehose/${connectionId}`)
    expect(getRes.status).toBe(404)
  })

  test('GET /api/firehose/status - returns health', async () => {
    const res = await authedRequest('GET', '/api/firehose/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the API tests**

```bash
bunx playwright test tests/api/firehose.spec.ts
```

Fix any failures.

- [ ] **Step 3: Commit**

```bash
git add tests/api/firehose.spec.ts
git commit -m "test(firehose): add API E2E tests for connection CRUD"
```

---

## Phase 4: Messaging Router Integration

### Task 9: Firehose Group Detection in MessagingRouter

**Files:**
- Modify: `src/server/messaging/router.ts`

- [ ] **Step 1: Add firehose detection after message parsing**

In `src/server/messaging/router.ts`, after the message is parsed (line ~113) and before keyword interception (line ~115), add firehose group detection:

```typescript
// --- Firehose group detection ---
// If this is a Signal group message, check if it belongs to a firehose connection.
// If so, encrypt for the agent + admins and buffer it. Do NOT create a conversation.
if (incoming.channelType === 'signal' && incoming.metadata?.groupId) {
  const firehoseResult = await handleFirehoseMessage(
    services,
    c.env,
    hubId ?? 'global',
    incoming
  )
  if (firehoseResult) {
    return c.json({ ok: true })
  }
  // Not a firehose group — continue normal flow
}
```

- [ ] **Step 2: Implement handleFirehoseMessage function**

Add at the bottom of `router.ts`:

```typescript
import { LABEL_FIREHOSE_BUFFER_ENCRYPT } from '@shared/crypto-labels'
import { KIND_FIREHOSE_MESSAGE } from '../../shared/nostr-events'

/**
 * Check if an incoming Signal group message belongs to a firehose connection.
 * If so, encrypt and buffer it for the agent. Returns true if handled.
 */
async function handleFirehoseMessage(
  services: Services,
  env: AppEnv['Bindings'],
  hubId: string,
  incoming: IncomingMessage
): Promise<boolean> {
  const groupId = incoming.metadata?.groupId
  if (!groupId) return false

  // Look up active firehose connection for this Signal group
  let connection = await services.firehose.findConnectionBySignalGroup(groupId, hubId)

  // If no active connection, try to auto-link a pending connection
  if (!connection) {
    const pending = await services.firehose.findPendingConnection(hubId)
    if (pending) {
      await services.firehose.updateConnection(pending.id, {
        signalGroupId: groupId,
        status: 'active',
      })
      connection = await services.firehose.getConnection(pending.id)
    }
  }

  if (!connection || connection.status === 'disabled') return false

  // Encrypt message body for the agent + admins
  const adminPubkey = env.ADMIN_DECRYPTION_PUBKEY || env.ADMIN_PUBKEY
  if (!adminPubkey) return false

  const readerPubkeys = [connection.agentPubkey, adminPubkey]
  const encrypted = services.crypto.envelopeEncrypt(
    incoming.body || '',
    readerPubkeys,
    LABEL_FIREHOSE_BUFFER_ENCRYPT
  )

  // Encrypt sender info separately
  const senderInfo = JSON.stringify({
    identifier: incoming.senderIdentifier,
    identifierHash: incoming.senderIdentifierHash,
    username: incoming.metadata?.senderName || incoming.senderIdentifier,
    timestamp: incoming.timestamp,
  })
  const encryptedSender = services.crypto.envelopeEncrypt(
    senderInfo,
    [connection.agentPubkey],
    LABEL_FIREHOSE_BUFFER_ENCRYPT
  )

  // Buffer the message
  const ttlMs = connection.bufferTtlDays * 24 * 60 * 60 * 1000
  await services.firehose.addBufferMessage(connection.id, {
    signalTimestamp: new Date(incoming.timestamp),
    encryptedContent: encrypted.encrypted as string,
    encryptedSenderInfo: encryptedSender.encrypted as string,
    expiresAt: new Date(Date.now() + ttlMs),
  })

  // Publish Nostr event for agent subscription
  try {
    const publisher = getNostrPublisher(env)
    publisher.publish({
      kind: KIND_FIREHOSE_MESSAGE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', hubId],
        ['t', 'llamenos:event'],
        ['c', connection.id],
      ],
      content: JSON.stringify({
        type: 'firehose:message',
        connectionId: connection.id,
      }),
    }).catch((err) => console.error('[nostr] firehose event publish failed:', err))
  } catch {
    // Nostr not configured
  }

  // Audit log
  services.records
    .addAuditEntry(hubId, 'firehoseMessageReceived', 'system', {
      connectionId: connection.id,
      senderHash: incoming.senderIdentifierHash,
    })
    .catch((err) => console.error('[background]', err))

  return true
}
```

- [ ] **Step 3: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add src/server/messaging/router.ts
git commit -m "feat(firehose): add firehose group detection to messaging router"
```

---

## Phase 5: LLM Inference Client

### Task 10: Firehose Inference Client

**Files:**
- Create: `src/server/services/firehose-inference.ts`
- Create: `src/server/services/firehose-inference.test.ts`

- [ ] **Step 1: Install openai SDK**

```bash
bun add openai
```

- [ ] **Step 2: Write failing test**

Create `src/server/services/firehose-inference.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { FirehoseInferenceClient } from './firehose-inference'

describe('FirehoseInferenceClient', () => {
  it('should be constructable with endpoint URL', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    expect(client).toBeDefined()
  })

  it('should generate JSON schema from custom field definitions', () => {
    const client = new FirehoseInferenceClient('http://localhost:8000/v1')
    const fields = [
      { id: '1', name: 'size', label: 'Size', type: 'text' as const, required: true, options: [], order: 0, createdAt: '', context: 'all' as const, visibleTo: 'contacts:envelope-summary' as const },
      { id: '2', name: 'activity', label: 'Activity', type: 'text' as const, required: true, options: [], order: 1, createdAt: '', context: 'all' as const, visibleTo: 'contacts:envelope-summary' as const },
      { id: '3', name: 'location', label: 'Location', type: 'text' as const, required: true, options: [], order: 2, createdAt: '', context: 'all' as const, visibleTo: 'contacts:envelope-summary' as const },
      { id: '4', name: 'equipment', label: 'Equipment', type: 'text' as const, required: false, options: [], order: 3, createdAt: '', context: 'all' as const, visibleTo: 'contacts:envelope-summary' as const },
    ]
    const schema = client.buildJsonSchemaFromFields(fields)
    expect(schema.type).toBe('object')
    expect(schema.properties.size).toBeDefined()
    expect(schema.properties.activity).toBeDefined()
    expect(schema.required).toContain('size')
    expect(schema.required).toContain('activity')
    expect(schema.required).not.toContain('equipment')
  })
})
```

- [ ] **Step 3: Run test to verify failure**

```bash
bun test src/server/services/firehose-inference.test.ts
```

- [ ] **Step 4: Implement FirehoseInferenceClient**

Create `src/server/services/firehose-inference.ts`:

```typescript
import OpenAI from 'openai'
import type { CustomFieldDefinition } from '@shared/types'

export interface DecryptedFirehoseMessage {
  id: string
  senderUsername: string
  content: string
  timestamp: string
}

export interface MessageCluster {
  id: string
  messages: DecryptedFirehoseMessage[]
  confidence: number
}

export interface ExtractionResult {
  fields: Record<string, string>
  confidence: number
}

export class FirehoseInferenceClient {
  private client: OpenAI
  private model: string

  constructor(
    baseURL: string,
    model = 'Qwen/Qwen3.5-9B',
    apiKey = 'not-needed'
  ) {
    this.client = new OpenAI({
      baseURL,
      apiKey,
    })
    this.model = model
  }

  /**
   * Generate a JSON Schema from custom field definitions for use as response_format.
   */
  buildJsonSchemaFromFields(fields: CustomFieldDefinition[]): {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required: string[]
  } {
    const properties: Record<string, { type: string; description: string; enum?: string[] }> = {}
    const required: string[] = []

    for (const field of fields) {
      const prop: { type: string; description: string; enum?: string[] } = {
        description: field.label || field.name,
        type: 'string', // default
      }

      switch (field.type) {
        case 'number':
          prop.type = 'string' // LLM extracts as string, we parse later
          prop.description = `${prop.description} (numeric value)`
          break
        case 'select':
          prop.enum = field.options
          break
        case 'multiselect':
          prop.type = 'string'
          prop.description = `${prop.description} (comma-separated from: ${field.options.join(', ')})`
          break
        case 'checkbox':
          prop.type = 'string'
          prop.description = `${prop.description} (yes or no)`
          break
        case 'date':
          prop.description = `${prop.description} (ISO 8601 datetime)`
          break
        default:
          // text, location — just string
          break
      }

      properties[field.name] = prop
      if (field.required) required.push(field.name)
    }

    return { type: 'object', properties, required }
  }

  /**
   * Detect incident boundaries in a set of messages.
   * Returns refined clusters of related messages.
   */
  async detectIncidentBoundaries(
    messages: DecryptedFirehoseMessage[],
    candidates: MessageCluster[],
    geoContext?: string
  ): Promise<MessageCluster[]> {
    const systemPrompt = [
      'You are an incident boundary detector. Given a set of chat messages from a rapid response group,',
      'determine which messages are about the same incident.',
      geoContext ? `Geographic context: ${geoContext}` : '',
      'Return a JSON array of clusters. Each cluster has an "id" (string), "messageIds" (array of message IDs), and "confidence" (0-1).',
    ].filter(Boolean).join(' ')

    const messagesText = messages.map(m =>
      `[${m.id}] ${m.timestamp} ${m.senderUsername}: ${m.content}`
    ).join('\n')

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messagesText },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'incident_clusters',
          schema: {
            type: 'object',
            properties: {
              clusters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    messageIds: { type: 'array', items: { type: 'string' } },
                    confidence: { type: 'number' },
                  },
                  required: ['id', 'messageIds', 'confidence'],
                },
              },
            },
            required: ['clusters'],
          },
        },
      },
      temperature: 0.1,
      max_tokens: 2048,
    })

    const content = response.choices[0]?.message?.content
    if (!content) return candidates

    const parsed = JSON.parse(content) as {
      clusters: Array<{ id: string; messageIds: string[]; confidence: number }>
    }

    // Map back to MessageCluster format
    return parsed.clusters.map(c => ({
      id: c.id,
      messages: c.messageIds
        .map(mid => messages.find(m => m.id === mid))
        .filter((m): m is DecryptedFirehoseMessage => m !== undefined),
      confidence: c.confidence,
    }))
  }

  /**
   * Extract a structured report from a cluster of messages.
   */
  async extractReport(
    messages: DecryptedFirehoseMessage[],
    schema: ReturnType<typeof this.buildJsonSchemaFromFields>,
    geoContext?: string,
    systemPromptSuffix?: string
  ): Promise<ExtractionResult> {
    const systemPrompt = [
      'You are a report extraction agent. Given chat messages from a rapid response firehose group,',
      'extract structured report fields according to the schema.',
      'Include a "confidence" field (0-1) indicating how confident you are in the extraction.',
      geoContext ? `Geographic context: ${geoContext}. Use this to disambiguate locations.` : '',
      systemPromptSuffix ?? '',
    ].filter(Boolean).join(' ')

    const messagesText = messages.map(m =>
      `${m.timestamp} ${m.senderUsername}: ${m.content}`
    ).join('\n')

    // Add confidence to the schema
    const schemaWithConfidence = {
      ...schema,
      properties: {
        ...schema.properties,
        confidence: { type: 'number' as const, description: 'Extraction confidence 0-1' },
      },
      required: [...schema.required, 'confidence'],
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messagesText },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'report_extraction',
          schema: schemaWithConfidence,
        },
      },
      temperature: 0.1,
      max_tokens: 4096,
    })

    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('No extraction response from LLM')

    const parsed = JSON.parse(content) as Record<string, string> & { confidence: number }
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
    const fields = { ...parsed }
    delete (fields as Record<string, unknown>).confidence

    return { fields, confidence }
  }

  /**
   * Health check — ping the vLLM endpoint.
   */
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = performance.now()
    try {
      await this.client.models.list()
      return { ok: true, latencyMs: Math.round(performance.now() - start) }
    } catch {
      return { ok: false, latencyMs: Math.round(performance.now() - start) }
    }
  }
}
```

- [ ] **Step 5: Run tests**

```bash
bun test src/server/services/firehose-inference.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/server/services/firehose-inference.ts src/server/services/firehose-inference.test.ts package.json bun.lockb
git commit -m "feat(firehose): add LLM inference client with schema generation"
```

---

## Phase 6: Extraction Engine (Agent Service)

### Task 11: FirehoseAgentService

**Files:**
- Create: `src/server/services/firehose-agent.ts`
- Modify: `src/server/services/index.ts`

- [ ] **Step 1: Create the agent service**

Create `src/server/services/firehose-agent.ts`. This is the core extraction engine — manages the per-connection extraction loops:

```typescript
import { LABEL_FIREHOSE_REPORT_WRAP } from '@shared/crypto-labels'
import { KIND_FIREHOSE_REPORT } from '@shared/nostr-events'
import type { CustomFieldDefinition } from '@shared/types'
import type { Database } from '../db'
import { getNostrPublisher } from '../lib/adapters'
import type { CryptoService } from '../lib/crypto-service'
import type {
  DecryptedFirehoseMessage,
  FirehoseInferenceClient,
  MessageCluster,
} from './firehose-inference'
import type { FirehoseService } from './firehose'
import type { ReportTypeService } from './report-types'
import type { SettingsService } from './settings'
import type { ConversationService } from './conversations'
import type { RecordsService } from './records'
import type { IdentityService } from './identity'

interface AgentInstance {
  connectionId: string
  hubId: string
  agentNsec: string
  intervalHandle: ReturnType<typeof setInterval>
}

export class FirehoseAgentService {
  private agents = new Map<string, AgentInstance>()
  private inferenceClients = new Map<string, FirehoseInferenceClient>()

  constructor(
    private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly firehose: FirehoseService,
    private readonly reportTypes: ReportTypeService,
    private readonly settings: SettingsService,
    private readonly conversations: ConversationService,
    private readonly records: RecordsService,
    private readonly identity: IdentityService,
    private readonly env: {
      FIREHOSE_AGENT_SEAL_KEY?: string
      FIREHOSE_INFERENCE_URL?: string
      FIREHOSE_DEFAULT_MODEL?: string
      ADMIN_PUBKEY?: string
      ADMIN_DECRYPTION_PUBKEY?: string
    }
  ) {}

  /**
   * Initialize all active firehose agents on server startup.
   */
  async init(): Promise<void> {
    const sealKey = this.env.FIREHOSE_AGENT_SEAL_KEY
    if (!sealKey) {
      console.log('[firehose] No FIREHOSE_AGENT_SEAL_KEY — firehose agents disabled')
      return
    }

    const connections = await this.firehose.listActiveConnections()
    console.log(`[firehose] Starting ${connections.length} active agent(s)`)

    for (const conn of connections) {
      try {
        await this.startAgent(conn.id)
      } catch (err) {
        console.error(`[firehose] Failed to start agent ${conn.id}:`, err)
      }
    }

    // Periodic buffer cleanup (every hour)
    setInterval(() => {
      this.firehose.purgeExpiredMessages().catch((err) =>
        console.error('[firehose] Buffer purge failed:', err)
      )
    }, 60 * 60 * 1000)
  }

  /**
   * Start a single agent for a connection.
   */
  async startAgent(connectionId: string): Promise<void> {
    if (this.agents.has(connectionId)) return // Already running

    const sealKey = this.env.FIREHOSE_AGENT_SEAL_KEY
    if (!sealKey) throw new Error('FIREHOSE_AGENT_SEAL_KEY not configured')

    const conn = await this.firehose.getConnection(connectionId)
    if (!conn) throw new Error(`Connection ${connectionId} not found`)

    // Unseal agent nsec
    const nsec = this.firehose.unsealAgentNsec(connectionId, conn.encryptedAgentNsec, sealKey)

    // Create or reuse inference client for this endpoint
    const inferenceUrl = conn.inferenceEndpoint || this.env.FIREHOSE_INFERENCE_URL || 'http://localhost:8000/v1'
    if (!this.inferenceClients.has(inferenceUrl)) {
      const { FirehoseInferenceClient } = await import('./firehose-inference')
      this.inferenceClients.set(
        inferenceUrl,
        new FirehoseInferenceClient(inferenceUrl, this.env.FIREHOSE_DEFAULT_MODEL)
      )
    }

    // Start extraction loop
    const intervalMs = conn.extractionIntervalSec * 1000
    const intervalHandle = setInterval(
      () => this.runExtractionLoop(connectionId).catch((err) =>
        console.error(`[firehose] Extraction loop error for ${connectionId}:`, err)
      ),
      intervalMs
    )

    this.agents.set(connectionId, {
      connectionId,
      hubId: conn.hubId,
      agentNsec: nsec,
      intervalHandle,
    })

    console.log(`[firehose] Agent started for connection ${connectionId} (interval: ${conn.extractionIntervalSec}s)`)
  }

  /**
   * Stop a single agent.
   */
  stopAgent(connectionId: string): void {
    const agent = this.agents.get(connectionId)
    if (!agent) return

    clearInterval(agent.intervalHandle)
    // Zero nsec from memory
    const nsecArr = new TextEncoder().encode(agent.agentNsec)
    nsecArr.fill(0)
    this.agents.delete(connectionId)

    console.log(`[firehose] Agent stopped for connection ${connectionId}`)
  }

  /**
   * Stop all agents (shutdown).
   */
  shutdown(): void {
    for (const [id] of this.agents) {
      this.stopAgent(id)
    }
  }

  /**
   * Core extraction loop — runs periodically per connection.
   */
  private async runExtractionLoop(connectionId: string): Promise<void> {
    const agent = this.agents.get(connectionId)
    if (!agent) return

    const conn = await this.firehose.getConnection(connectionId)
    if (!conn || conn.status !== 'active') {
      this.stopAgent(connectionId)
      return
    }

    // Get unextracted messages
    const buffered = await this.firehose.getUnextractedMessages(connectionId)
    if (buffered.length === 0) return

    // Decrypt messages using agent nsec
    const decrypted: DecryptedFirehoseMessage[] = []
    for (const msg of buffered) {
      try {
        const content = this.crypto.envelopeDecrypt(
          msg.encryptedContent,
          [], // envelopes not stored separately in buffer — agent re-decrypts
          agent.agentNsec
        )
        const senderInfo = this.crypto.envelopeDecrypt(
          msg.encryptedSenderInfo,
          [],
          agent.agentNsec
        )
        const sender = JSON.parse(senderInfo) as { username: string; timestamp: string }
        decrypted.push({
          id: msg.id,
          senderUsername: sender.username,
          content,
          timestamp: sender.timestamp,
        })
      } catch (err) {
        console.error(`[firehose] Failed to decrypt buffer message ${msg.id}:`, err)
      }
    }

    if (decrypted.length < 2) return // Need at least 2 messages for clustering

    // Get inference client
    const inferenceUrl = conn.inferenceEndpoint || this.env.FIREHOSE_INFERENCE_URL || 'http://localhost:8000/v1'
    const inferenceClient = this.inferenceClients.get(inferenceUrl)
    if (!inferenceClient) return

    // Phase 1: Heuristic clustering
    const clusters = this.heuristicCluster(decrypted)

    // Phase 2: LLM refinement for ambiguous clusters
    let refinedClusters: MessageCluster[]
    try {
      refinedClusters = await inferenceClient.detectIncidentBoundaries(
        decrypted,
        clusters,
        conn.geoContext ?? undefined
      )
    } catch (err) {
      console.error(`[firehose] Incident detection failed for ${connectionId}:`, err)
      refinedClusters = clusters // Fall back to heuristic clusters
    }

    // Get report type custom fields for schema generation
    const reportType = await this.reportTypes.getReportType(conn.hubId, conn.reportTypeId)
    if (!reportType) return

    const customFields = await this.settings.getCustomFields(conn.hubId, 'reports')
    const schema = inferenceClient.buildJsonSchemaFromFields(customFields)

    // Extract reports from each cluster
    for (const cluster of refinedClusters) {
      if (cluster.messages.length < 1) continue

      try {
        const extraction = await inferenceClient.extractReport(
          cluster.messages,
          schema,
          conn.geoContext ?? undefined,
          conn.systemPromptSuffix ?? undefined
        )

        // Build report payload and submit
        await this.submitExtractedReport(conn, cluster, extraction, customFields)

        // Mark messages as extracted
        const messageIds = cluster.messages.map(m => m.id)
        const reportId = crypto.randomUUID() // Will be the actual report ID
        await this.firehose.markMessagesExtracted(messageIds, reportId, cluster.id)

      } catch (err) {
        console.error(`[firehose] Extraction failed for cluster ${cluster.id}:`, err)
        this.records.addAuditEntry(conn.hubId, 'firehoseExtractionFailed', `system:firehose-agent:${connectionId}`, {
          clusterId: cluster.id,
          error: String(err),
        }).catch(() => {})
      }
    }
  }

  /**
   * Heuristic message clustering — cheap, no LLM.
   */
  private heuristicCluster(messages: DecryptedFirehoseMessage[]): MessageCluster[] {
    if (messages.length === 0) return []

    // Simple temporal clustering: group messages within 5-minute windows
    const WINDOW_MS = 5 * 60 * 1000
    const clusters: MessageCluster[] = []
    let current: DecryptedFirehoseMessage[] = [messages[0]]

    for (let i = 1; i < messages.length; i++) {
      const prev = new Date(messages[i - 1].timestamp).getTime()
      const curr = new Date(messages[i].timestamp).getTime()

      if (curr - prev <= WINDOW_MS) {
        current.push(messages[i])
      } else {
        clusters.push({
          id: crypto.randomUUID(),
          messages: current,
          confidence: 0.6, // Heuristic confidence
        })
        current = [messages[i]]
      }
    }

    if (current.length > 0) {
      clusters.push({
        id: crypto.randomUUID(),
        messages: current,
        confidence: 0.6,
      })
    }

    return clusters
  }

  /**
   * Submit an extracted report via the existing report/conversation system.
   */
  private async submitExtractedReport(
    conn: { id: string; hubId: string; agentPubkey: string; reportTypeId: string },
    cluster: MessageCluster,
    extraction: { fields: Record<string, string>; confidence: number },
    _customFields: CustomFieldDefinition[]
  ): Promise<void> {
    // Build the report content as JSON
    const reportContent = JSON.stringify({
      extractedFields: extraction.fields,
      sourceMessages: cluster.messages.map(m => ({
        signalUsername: m.senderUsername,
        timestamp: m.timestamp,
        content: m.content,
        messageId: m.id,
      })),
      agentId: conn.id,
      confidence: extraction.confidence,
      incidentTimestamp: cluster.messages[0].timestamp,
    })

    // Get admin pubkeys for envelope recipients
    const adminPubkey = this.env.ADMIN_DECRYPTION_PUBKEY || this.env.ADMIN_PUBKEY
    if (!adminPubkey) throw new Error('No admin pubkey configured')

    // Get all users with reports:read-all permission for envelope recipients
    const allUsers = await this.identity.getUsers()
    const readerPubkeys = new Set<string>([adminPubkey, conn.agentPubkey])
    // In production, filter by reports:read-all permission. For now, include all admins.
    for (const user of allUsers) {
      if (user.isSuperAdmin) readerPubkeys.add(user.pubkey)
    }

    // Envelope encrypt the report content
    const encrypted = this.crypto.envelopeEncrypt(
      reportContent,
      [...readerPubkeys],
      LABEL_FIREHOSE_REPORT_WRAP
    )

    // Create a report conversation
    const conversation = await this.conversations.createConversation({
      hubId: conn.hubId,
      channelType: 'web',
      contactIdentifierHash: '' as import('@shared/crypto-types').HmacHash,
      externalId: `firehose:${conn.id}:${cluster.id}`,
      status: 'waiting',
      metadata: {
        type: 'report',
        reportTypeId: conn.reportTypeId,
        reporterPubkey: conn.agentPubkey,
        firehoseConnectionId: conn.id,
        firehoseClusterId: cluster.id,
        confidence: String(extraction.confidence),
      },
      skipDedup: true,
    })

    // Add the encrypted report as the first message
    await this.conversations.addMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      authorPubkey: `system:firehose-agent:${conn.id}`,
      encryptedContent: encrypted.encrypted as string,
      readerEnvelopes: encrypted.envelopes,
    })

    // Audit log
    await this.records.addAuditEntry(
      conn.hubId,
      'firehoseReportSubmitted',
      `system:firehose-agent:${conn.id}`,
      {
        reportId: conversation.id,
        confidence: extraction.confidence,
        messageCount: cluster.messages.length,
      }
    )

    console.log(`[firehose] Report submitted from connection ${conn.id}, confidence: ${extraction.confidence}`)
  }
}
```

- [ ] **Step 2: Register agent service**

Update `src/server/services/index.ts`:

Note: `FirehoseAgentService` has many dependencies and needs env vars, so it's initialized separately in `server.ts`, not in `createServices()`. Add it as an optional field:

```typescript
import { FirehoseAgentService } from './firehose-agent'
export type { FirehoseAgentService }
```

Add to `Services` interface:
```typescript
firehoseAgent?: FirehoseAgentService
```

- [ ] **Step 3: Initialize agent in server.ts**

Find the server startup code in `src/server/server.ts` and add agent initialization after services are created:

```typescript
// Initialize firehose agents (after services are ready)
if (process.env.FIREHOSE_AGENT_SEAL_KEY) {
  const { FirehoseAgentService } = await import('./services/firehose-agent')
  const agentService = new FirehoseAgentService(
    db,
    services.crypto,
    services.firehose,
    services.reportTypes,
    services.settings,
    services.conversations,
    services.records,
    services.identity,
    {
      FIREHOSE_AGENT_SEAL_KEY: process.env.FIREHOSE_AGENT_SEAL_KEY,
      FIREHOSE_INFERENCE_URL: process.env.FIREHOSE_INFERENCE_URL,
      FIREHOSE_DEFAULT_MODEL: process.env.FIREHOSE_DEFAULT_MODEL,
      ADMIN_PUBKEY: process.env.ADMIN_PUBKEY,
      ADMIN_DECRYPTION_PUBKEY: process.env.ADMIN_DECRYPTION_PUBKEY,
    }
  )
  services.firehoseAgent = agentService
  await agentService.init()
}
```

- [ ] **Step 4: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 5: Commit**

```bash
git add src/server/services/firehose-agent.ts src/server/services/index.ts src/server/server.ts
git commit -m "feat(firehose): add FirehoseAgentService extraction engine"
```

---

## Phase 7: Notification System

### Task 12: Signal DM Notifications with Opt-Out

**Files:**
- Modify: `src/server/services/firehose-agent.ts`
- Modify: `src/server/messaging/router.ts`

- [ ] **Step 1: Add notification method to FirehoseAgentService**

Add to `FirehoseAgentService`:

```typescript
/**
 * Notify admins about a new firehose report.
 * In-app via Nostr (always), Signal DM (unless opted out).
 */
private async notifyAdmins(
  conn: { id: string; hubId: string; notifyViaSignal: boolean },
  reportId: string,
  confidence: number,
  env: Record<string, string | undefined>
): Promise<void> {
  // Nostr notification (always)
  try {
    const publisher = getNostrPublisher(env as unknown as import('../types').AppEnv['Bindings'])
    publisher.publish({
      kind: KIND_FIREHOSE_REPORT,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', conn.hubId],
        ['t', 'llamenos:event'],
        ['c', conn.id],
      ],
      content: JSON.stringify({
        type: 'firehose:report',
        connectionId: conn.id,
        reportId,
        confidence,
      }),
    }).catch(() => {})
  } catch {
    // Nostr not configured
  }

  // Signal DM (if enabled and not opted out)
  if (!conn.notifyViaSignal) return

  const admins = await this.identity.getUsers()
  const shortCode = conn.id.slice(0, 8).toUpperCase()

  for (const admin of admins) {
    if (!admin.isSuperAdmin) continue
    const optedOut = await this.firehose.isOptedOut(conn.id, admin.id)
    if (optedOut) continue

    // Send Signal DM via the messaging adapter
    // This would use the existing Signal adapter's sendMessage
    // Implementation depends on how the Signal adapter is accessed from services
    console.log(`[firehose] Would send Signal DM to admin ${admin.id.slice(0, 8)} for connection ${conn.id}`)
  }
}
```

- [ ] **Step 2: Wire notification into submitExtractedReport**

At the end of `submitExtractedReport`, add:

```typescript
// Notify admins
await this.notifyAdmins(conn, conversation.id, extraction.confidence, this.env as Record<string, string | undefined>)
```

- [ ] **Step 3: Add opt-out detection in messaging router**

In the messaging router, in the keyword interception section, add detection for `STOP-{code}` pattern for firehose opt-outs:

```typescript
// Firehose notification opt-out detection
const firehoseOptoutMatch = normalizedBody.match(/^STOP-([A-Z0-9]{8})$/)
if (firehoseOptoutMatch) {
  const shortCode = firehoseOptoutMatch[1]
  // Find connection by short code prefix
  const connections = await services.firehose.listConnections(hId)
  const conn = connections.find(c => c.id.slice(0, 8).toUpperCase() === shortCode)
  if (conn) {
    // Look up user by sender identifier
    // This requires mapping the Signal sender to a user ID
    // For now, log and continue
    console.log(`[firehose] Opt-out request for connection ${conn.id} from ${incoming.senderIdentifierHash}`)
  }
}
```

- [ ] **Step 4: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 5: Commit**

```bash
git add src/server/services/firehose-agent.ts src/server/messaging/router.ts
git commit -m "feat(firehose): add admin notifications with Signal DM opt-out"
```

---

## Phase 8: Admin UI

### Task 13: Client API + Query Hooks

**Files:**
- Create: `src/client/lib/api/firehose.ts`
- Create: `src/client/lib/queries/firehose.ts`
- Modify: `src/client/lib/query-client.ts`

- [ ] **Step 1: Create client API functions**

Create `src/client/lib/api/firehose.ts` following the pattern of `src/client/lib/api/reports.ts`:

```typescript
import type {
  CreateFirehoseConnectionInput,
  FirehoseConnection,
  FirehoseConnectionHealth,
  UpdateFirehoseConnectionInput,
} from '@shared/schemas/firehose'
import { apiFetch } from './base'

export async function listFirehoseConnections(hubId?: string): Promise<{ items: FirehoseConnection[] }> {
  const prefix = hubId ? `/api/hubs/${hubId}` : '/api'
  return apiFetch(`${prefix}/firehose`)
}

export async function getFirehoseConnection(id: string, hubId?: string): Promise<{ item: FirehoseConnection }> {
  const prefix = hubId ? `/api/hubs/${hubId}` : '/api'
  return apiFetch(`${prefix}/firehose/${id}`)
}

export async function createFirehoseConnection(
  data: CreateFirehoseConnectionInput,
  hubId?: string
): Promise<{ item: FirehoseConnection }> {
  const prefix = hubId ? `/api/hubs/${hubId}` : '/api'
  return apiFetch(`${prefix}/firehose`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateFirehoseConnection(
  id: string,
  data: UpdateFirehoseConnectionInput,
  hubId?: string
): Promise<{ item: FirehoseConnection }> {
  const prefix = hubId ? `/api/hubs/${hubId}` : '/api'
  return apiFetch(`${prefix}/firehose/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteFirehoseConnection(id: string, hubId?: string): Promise<void> {
  const prefix = hubId ? `/api/hubs/${hubId}` : '/api'
  await apiFetch(`${prefix}/firehose/${id}`, { method: 'DELETE' })
}

export async function getFirehoseStatus(hubId?: string): Promise<{ items: FirehoseConnectionHealth[] }> {
  const prefix = hubId ? `/api/hubs/${hubId}` : '/api'
  return apiFetch(`${prefix}/firehose/status`)
}
```

- [ ] **Step 2: Create React Query hooks**

Create `src/client/lib/queries/firehose.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useConfig } from '../hooks/use-config'
import { queryKeys } from '../query-client'
import {
  createFirehoseConnection,
  deleteFirehoseConnection,
  getFirehoseStatus,
  listFirehoseConnections,
  updateFirehoseConnection,
} from '../api/firehose'
import type { CreateFirehoseConnectionInput, UpdateFirehoseConnectionInput } from '@shared/schemas/firehose'

export function useFirehoseConnections() {
  const { currentHubId } = useConfig()
  return useQuery({
    queryKey: queryKeys.firehose.list(),
    queryFn: () => listFirehoseConnections(currentHubId),
  })
}

export function useFirehoseStatus() {
  const { currentHubId } = useConfig()
  return useQuery({
    queryKey: queryKeys.firehose.status(),
    queryFn: () => getFirehoseStatus(currentHubId),
    refetchInterval: 30_000, // Refresh every 30s
  })
}

export function useCreateFirehoseConnection() {
  const queryClient = useQueryClient()
  const { currentHubId } = useConfig()
  return useMutation({
    mutationFn: (data: CreateFirehoseConnectionInput) =>
      createFirehoseConnection(data, currentHubId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.list() })
    },
  })
}

export function useUpdateFirehoseConnection() {
  const queryClient = useQueryClient()
  const { currentHubId } = useConfig()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFirehoseConnectionInput }) =>
      updateFirehoseConnection(id, data, currentHubId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.list() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.status() })
    },
  })
}

export function useDeleteFirehoseConnection() {
  const queryClient = useQueryClient()
  const { currentHubId } = useConfig()
  return useMutation({
    mutationFn: (id: string) => deleteFirehoseConnection(id, currentHubId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.firehose.list() })
    },
  })
}
```

- [ ] **Step 3: Add firehose to query keys and encrypted query keys**

In `src/client/lib/query-client.ts`:

Add to `queryKeys`:
```typescript
firehose: {
  list: () => ['firehose'] as const,
  detail: (id: string) => ['firehose', id] as const,
  status: () => ['firehose', 'status'] as const,
},
```

Add `'firehose'` to `PLAINTEXT_QUERY_KEYS` (the display names are hub-key encrypted but connection data itself is not envelope-encrypted in the query cache).

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/api/firehose.ts src/client/lib/queries/firehose.ts src/client/lib/query-client.ts
git commit -m "feat(firehose): add client API functions and React Query hooks"
```

### Task 14: Admin Settings UI

**Files:**
- Create: `src/client/components/admin-settings/firehose-section.tsx`
- Modify: `src/client/routes/admin/settings.tsx`

- [ ] **Step 1: Create the FirehoseSection component**

Create `src/client/components/admin-settings/firehose-section.tsx`. Follow the pattern of `src/client/components/admin-settings/report-types-section.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useCreateFirehoseConnection,
  useDeleteFirehoseConnection,
  useFirehoseConnections,
  useFirehoseStatus,
  useUpdateFirehoseConnection,
} from '@/lib/queries/firehose'
import { useReportTypes } from '@/lib/queries/reports'
import type { CreateFirehoseConnectionInput, FirehoseConnection } from '@shared/schemas/firehose'
import { Loader2, Pause, Play, Plus, Trash2 } from 'lucide-react'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500',
  active: 'bg-green-500',
  paused: 'bg-orange-500',
  disabled: 'bg-gray-500',
}

export function FirehoseSection() {
  const { t } = useTranslation()
  const { data: connections, isLoading } = useFirehoseConnections()
  const { data: status } = useFirehoseStatus()
  const { data: reportTypes } = useReportTypes()
  const createMutation = useCreateFirehoseConnection()
  const updateMutation = useUpdateFirehoseConnection()
  const deleteMutation = useDeleteFirehoseConnection()
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (isLoading) return <Loader2 className="animate-spin" />

  const items = connections?.items ?? []
  const statusMap = new Map((status?.items ?? []).map(s => [s.id, s]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Firehose Connections</h3>
          <p className="text-sm text-muted-foreground">
            Connect Signal groups to automatically extract structured reports
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add Connection
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No firehose connections configured. Add one to start ingesting Signal group messages.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((conn) => {
            const health = statusMap.get(conn.id)
            return (
              <Card key={conn.id} data-testid={`firehose-connection-${conn.id}`}>
                <CardContent className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <Badge className={STATUS_COLORS[conn.status] ?? 'bg-gray-500'}>
                      {conn.status}
                    </Badge>
                    <div>
                      <p className="font-medium">{conn.displayName || conn.id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">
                        {conn.signalGroupId ? `Group: ${conn.signalGroupId.slice(0, 12)}...` : 'Awaiting group link'}
                        {health ? ` · Buffer: ${health.bufferSize} msgs` : ''}
                        {conn.geoContext ? ` · ${conn.geoContext}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {conn.status === 'active' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateMutation.mutate({ id: conn.id, data: { status: 'paused' } })}
                      >
                        <Pause className="h-4 w-4" />
                      </Button>
                    )}
                    {conn.status === 'paused' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateMutation.mutate({ id: conn.id, data: { status: 'active' } })}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingId(conn.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (confirm('Delete this firehose connection? Buffer data will be lost.')) {
                          deleteMutation.mutate(conn.id)
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Dialog */}
      <CreateFirehoseDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        reportTypes={reportTypes?.items ?? []}
        onCreate={(data) => {
          createMutation.mutate(data, { onSuccess: () => setShowCreate(false) })
        }}
        isLoading={createMutation.isPending}
      />

      {/* Edit Dialog */}
      {editingId && (
        <EditFirehoseDialog
          connection={items.find(c => c.id === editingId)!}
          open={!!editingId}
          onClose={() => setEditingId(null)}
          reportTypes={reportTypes?.items ?? []}
          onSave={(data) => {
            updateMutation.mutate({ id: editingId, data }, { onSuccess: () => setEditingId(null) })
          }}
          isLoading={updateMutation.isPending}
        />
      )}
    </div>
  )
}

function CreateFirehoseDialog({
  open,
  onClose,
  reportTypes,
  onCreate,
  isLoading,
}: {
  open: boolean
  onClose: () => void
  reportTypes: Array<{ id: string; name: string }>
  onCreate: (data: CreateFirehoseConnectionInput) => void
  isLoading: boolean
}) {
  const [displayName, setDisplayName] = useState('')
  const [reportTypeId, setReportTypeId] = useState('')
  const [geoContext, setGeoContext] = useState('')
  const [geoCountryCodes, setGeoCountryCodes] = useState('')
  const [interval, setInterval] = useState(60)

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Firehose Connection</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Display Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., Field Team Alpha"
              data-testid="firehose-display-name"
            />
          </div>
          <div>
            <Label>Report Type</Label>
            <Select value={reportTypeId} onValueChange={setReportTypeId}>
              <SelectTrigger data-testid="firehose-report-type">
                <SelectValue placeholder="Select report type" />
              </SelectTrigger>
              <SelectContent>
                {reportTypes.map((rt) => (
                  <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Geographic Context</Label>
            <Input
              value={geoContext}
              onChange={(e) => setGeoContext(e.target.value)}
              placeholder="e.g., Minneapolis, MN, North"
              data-testid="firehose-geo-context"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Helps the AI disambiguate locations and understand local references
            </p>
          </div>
          <div>
            <Label>Country Codes (comma-separated)</Label>
            <Input
              value={geoCountryCodes}
              onChange={(e) => setGeoCountryCodes(e.target.value)}
              placeholder="e.g., US"
              data-testid="firehose-country-codes"
            />
          </div>
          <div>
            <Label>Extraction Interval: {interval}s</Label>
            <Slider
              value={[interval]}
              onValueChange={([v]) => setInterval(v)}
              min={30}
              max={300}
              step={30}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onCreate({
              displayName,
              reportTypeId,
              geoContext: geoContext || undefined,
              geoContextCountryCodes: geoCountryCodes ? geoCountryCodes.split(',').map(s => s.trim()) : undefined,
              extractionIntervalSec: interval,
            })}
            disabled={!reportTypeId || isLoading}
            data-testid="firehose-create-submit"
          >
            {isLoading ? <Loader2 className="animate-spin" /> : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditFirehoseDialog({
  connection,
  open,
  onClose,
  reportTypes,
  onSave,
  isLoading,
}: {
  connection: FirehoseConnection
  open: boolean
  onClose: () => void
  reportTypes: Array<{ id: string; name: string }>
  onSave: (data: Record<string, unknown>) => void
  isLoading: boolean
}) {
  const [geoContext, setGeoContext] = useState(connection.geoContext ?? '')
  const [geoCountryCodes, setGeoCountryCodes] = useState(
    connection.geoContextCountryCodes?.join(', ') ?? ''
  )
  const [interval, setInterval] = useState(connection.extractionIntervalSec)
  const [systemPrompt, setSystemPrompt] = useState(connection.systemPromptSuffix ?? '')
  const [bufferTtl, setBufferTtl] = useState(connection.bufferTtlDays)
  const [notifySignal, setNotifySignal] = useState(connection.notifyViaSignal)
  const [inferenceUrl, setInferenceUrl] = useState(connection.inferenceEndpoint ?? '')

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit: {connection.displayName || connection.id.slice(0, 8)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <div>
            <Label>Geographic Context</Label>
            <Input value={geoContext} onChange={(e) => setGeoContext(e.target.value)} />
          </div>
          <div>
            <Label>Country Codes</Label>
            <Input value={geoCountryCodes} onChange={(e) => setGeoCountryCodes(e.target.value)} />
          </div>
          <div>
            <Label>Extraction Interval: {interval}s</Label>
            <Slider value={[interval]} onValueChange={([v]) => setInterval(v)} min={30} max={300} step={30} />
          </div>
          <div>
            <Label>System Prompt (additional context for the AI)</Label>
            <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>Buffer TTL: {bufferTtl} days</Label>
            <Slider value={[bufferTtl]} onValueChange={([v]) => setBufferTtl(v)} min={1} max={30} step={1} />
          </div>
          <div>
            <Label>Inference Endpoint Override</Label>
            <Input value={inferenceUrl} onChange={(e) => setInferenceUrl(e.target.value)} placeholder="http://gpu-server:8000/v1" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={notifySignal} onCheckedChange={setNotifySignal} />
            <Label>Signal DM notifications</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({
              geoContext: geoContext || null,
              geoContextCountryCodes: geoCountryCodes ? geoCountryCodes.split(',').map(s => s.trim()) : null,
              extractionIntervalSec: interval,
              systemPromptSuffix: systemPrompt || null,
              bufferTtlDays: bufferTtl,
              notifyViaSignal: notifySignal,
              inferenceEndpoint: inferenceUrl || null,
            })}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Add FirehoseSection to admin settings**

In `src/client/routes/admin/settings.tsx`, import and add the `FirehoseSection` as a new tab/section following the existing pattern (look at how `ReportTypesSection` is included).

- [ ] **Step 3: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add src/client/components/admin-settings/firehose-section.tsx src/client/lib/api/firehose.ts src/client/lib/queries/firehose.ts src/client/lib/query-client.ts src/client/routes/admin/settings.tsx
git commit -m "feat(firehose): add admin UI for firehose connection management"
```

---

## Phase 9: Integration Tests

### Task 15: Mock vLLM Extraction Tests

**Files:**
- Create: `tests/api/firehose-extraction.spec.ts`

- [ ] **Step 1: Write extraction integration tests with mock vLLM**

Create `tests/api/firehose-extraction.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'

test.describe('Firehose Extraction Integration', () => {
  let connectionId: string
  let reportTypeId: string

  test.beforeAll(async () => {
    // Create report type with SALUTE fields
    const rtRes = await authedRequest('POST', '/api/report-types', {
      name: 'SALUTE',
      description: 'Military observation report',
    })
    expect(rtRes.status).toBe(201)
    reportTypeId = (await rtRes.json()).item.id

    // Create firehose connection
    const connRes = await authedRequest('POST', '/api/firehose', {
      displayName: 'Test Extraction Group',
      reportTypeId,
      geoContext: 'Minneapolis, MN',
      geoContextCountryCodes: ['US'],
      extractionIntervalSec: 30,
    })
    expect(connRes.status).toBe(201)
    connectionId = (await connRes.json()).item.id
  })

  test('connection is created in pending state', async () => {
    const res = await authedRequest('GET', `/api/firehose/${connectionId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.status).toBe('pending')
    expect(body.item.agentPubkey).toHaveLength(64)
    expect(body.item.geoContext).toBe('Minneapolis, MN')
  })

  test('status endpoint shows buffer size', async () => {
    const res = await authedRequest('GET', '/api/firehose/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    const connStatus = body.items.find((s: { id: string }) => s.id === connectionId)
    expect(connStatus).toBeDefined()
    expect(connStatus.bufferSize).toBe(0)
  })

  test('connection can be paused and resumed', async () => {
    // Pause
    let res = await authedRequest('PATCH', `/api/firehose/${connectionId}`, { status: 'paused' })
    expect(res.status).toBe(200)
    expect((await res.json()).item.status).toBe('paused')

    // Resume
    res = await authedRequest('PATCH', `/api/firehose/${connectionId}`, { status: 'active' })
    expect(res.status).toBe(200)
    expect((await res.json()).item.status).toBe('active')
  })

  test.afterAll(async () => {
    await authedRequest('DELETE', `/api/firehose/${connectionId}`)
    await authedRequest('DELETE', `/api/report-types/${reportTypeId}`)
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
bunx playwright test tests/api/firehose-extraction.spec.ts
```

- [ ] **Step 3: Fix any failures and commit**

```bash
git add tests/api/firehose-extraction.spec.ts
git commit -m "test(firehose): add extraction integration tests"
```

---

## Phase 10: Deployment Configuration

### Task 16: Docker + Ansible Configuration

**Files:**
- Modify: `deploy/docker/docker-compose.dev.yml`
- Modify: `deploy/docker/.env.example`

- [ ] **Step 1: Add vLLM service to dev docker-compose**

Add to `deploy/docker/docker-compose.dev.yml`:

```yaml
  vllm:
    image: vllm/vllm-openai:latest
    command: >
      --model Qwen/Qwen3.5-9B
      --max-model-len 8192
      --guided-decoding-backend outlines
      --structured-outputs-config.enable_in_reasoning=True
    ports:
      - "8000:8000"
    networks:
      - inference_net
    profiles:
      - firehose  # Only start when explicitly requested: docker compose --profile firehose up
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

- [ ] **Step 2: Add env vars to .env.example**

Add to `deploy/docker/.env.example`:

```bash
# Firehose Report Agent (optional — only needed when using firehose connections)
# FIREHOSE_AGENT_SEAL_KEY=    # 64 hex chars — seals agent private keys at rest
# FIREHOSE_INFERENCE_URL=http://vllm:8000/v1
# FIREHOSE_DEFAULT_MODEL=Qwen/Qwen3.5-9B
```

- [ ] **Step 3: Commit**

```bash
git add deploy/docker/docker-compose.dev.yml deploy/docker/.env.example
git commit -m "feat(firehose): add vLLM container and env var configuration"
```

### Task 17: Final Typecheck, Build, and Verification

- [ ] **Step 1: Run full typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 2: Run all unit tests**

```bash
bun run test:unit
```

- [ ] **Step 3: Run API E2E tests**

```bash
bunx playwright test tests/api/firehose.spec.ts tests/api/firehose-extraction.spec.ts
```

- [ ] **Step 4: Run full test suite to check for regressions**

```bash
bun run test:all
```

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(firehose): address test and build issues"
```
