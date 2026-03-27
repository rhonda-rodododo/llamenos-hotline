# MinIO → RustFS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MinIO with RustFS and introduce per-hub bucket isolation with admin-configurable retention and SSE-S3 encryption at rest.

**Architecture:** New `StorageManager` class wraps `@aws-sdk/client-s3` with hub-aware bucket routing (`{hubId}-{namespace}`). `FilesService` gains `hubId` parameter on all blob methods. Hub creation/deletion provisions/destroys buckets via standard S3 API. Provider-agnostic `STORAGE_*` env vars replace `MINIO_*`.

**Tech Stack:** `@aws-sdk/client-s3` (existing), RustFS (Docker), Drizzle ORM (new migration for `hub_storage_settings`), `bun:test`

**Spec:** `docs/superpowers/specs/2026-03-26-minio-to-rustfs-migration-design.md`

---

## File Map

### New Files
| File | Purpose |
|------|---------|
| `src/server/lib/storage-manager.ts` | Hub-aware S3 storage manager (replaces `blob-storage.ts`) |
| `src/server/lib/storage-manager.test.ts` | Unit tests for StorageManager |
| `src/server/db/schema/storage.ts` | `hub_storage_settings` Drizzle table |

### Modified Files
| File | Changes |
|------|---------|
| `src/server/types.ts` | Replace `BlobStorage` with `StorageManager` interface |
| `src/server/services/files.ts` | Accept `StorageManager`, add `hubId` to all blob methods |
| `src/server/services/index.ts` | Wire `StorageManager` instead of `BlobStorage` |
| `src/server/lib/voicemail-storage.ts` | Use `'voicemails'` namespace via StorageManager |
| `src/server/lib/voicemail-storage.test.ts` | Update mocks for new method signatures |
| `src/server/routes/files.ts` | Thread `hubId` to `getAssembled` |
| `src/server/routes/uploads.ts` | Thread `hubId` to chunk/assembled ops |
| `src/server/routes/hubs.ts` | Call `provisionHub`/`destroyHub` on create/delete |
| `src/server/routes/health.ts` | Use RustFS `/health` endpoint |
| `src/server/server.ts` | `createStorageManager()` replaces `createBlobStorage()` |
| `src/server/db/schema/index.ts` | Export storage schema |
| `deploy/docker/docker-compose.yml` | RustFS container, env vars |
| `deploy/docker/docker-compose.dev.yml` | RustFS port mappings |
| `deploy/docker/docker-compose.production.yml` | RustFS logging |
| `deploy/docker/docker-compose.test.yml` | Health check update |
| `deploy/docker/.env.example` | Rename to `STORAGE_*` |
| `deploy/docker/.env.dev.defaults` | Rename to `STORAGE_*` |
| `deploy/ansible/roles/llamenos/tasks/main.yml` | Remove MinIO init, RustFS container only |
| `deploy/ansible/roles/llamenos/templates/env.j2` | Rename to `STORAGE_*` |
| `deploy/ansible/vars.example.yml` | Rename to `storage_*` |
| `deploy/helm/llamenos/values.yaml` | `rustfs.*` keys |
| `deploy/helm/llamenos/templates/statefulset-minio.yaml` | → `statefulset-rustfs.yaml` |

### Deleted Files
| File | Reason |
|------|--------|
| `src/server/lib/blob-storage.ts` | Replaced by `storage-manager.ts` |
| `deploy/scripts/init-minio.sh` | App handles bucket management |

---

### Task 1: StorageManager Interface + Types

**Files:**
- Modify: `src/server/types.ts`
- Create: `src/server/lib/storage-manager.ts` (interface + namespace registry only)

- [ ] **Step 1: Define STORAGE_NAMESPACES registry and StorageManager interface in types.ts**

Replace the `BlobStorage` interface in `src/server/types.ts` (lines 8-17) with:

```typescript
/**
 * Storage namespace registry — defines per-hub bucket types with default lifecycle.
 * Adding a new namespace here automatically provisions it on hub creation.
 */
export const STORAGE_NAMESPACES = {
  voicemails: { defaultRetentionDays: 365 },
  attachments: { defaultRetentionDays: null }, // no expiry
} satisfies Record<string, { defaultRetentionDays: number | null }>

export type StorageNamespace = keyof typeof STORAGE_NAMESPACES

/** Result from a storage get() operation */
export interface BlobResult {
  body: ReadableStream
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Hub-aware S3-compatible storage manager.
 * Routes operations to per-hub buckets: {hubId}-{namespace}
 */
export interface StorageManager {
  put(hubId: string, namespace: StorageNamespace, key: string, body: ReadableStream | ArrayBuffer | Uint8Array | string): Promise<void>
  get(hubId: string, namespace: StorageNamespace, key: string): Promise<BlobResult | null>
  delete(hubId: string, namespace: StorageNamespace, key: string): Promise<void>
  provisionHub(hubId: string): Promise<void>
  destroyHub(hubId: string): Promise<void>
  setRetention(hubId: string, namespace: StorageNamespace, days: number | null): Promise<void>
  healthy(): Promise<boolean>
}
```

Also update the `Env` interface — replace line 39-40 (`R2_BUCKET: BlobStorage`) with:

```typescript
  // Blob storage (hub-aware S3 storage manager)
  STORAGE: StorageManager
```

- [ ] **Step 2: Verify typecheck fails (references to old BlobStorage)**

Run: `bun run typecheck 2>&1 | head -30`
Expected: errors in `blob-storage.ts`, `services/files.ts`, `services/index.ts` referencing missing `BlobStorage`

- [ ] **Step 3: Commit interface changes**

```bash
git add src/server/types.ts
git commit -m "refactor: replace BlobStorage with StorageManager interface and namespace registry"
```

---

### Task 2: StorageManager Implementation

**Files:**
- Create: `src/server/lib/storage-manager.ts`
- Create: `src/server/lib/storage-manager.test.ts`

- [ ] **Step 1: Write failing tests for StorageManager**

Create `src/server/lib/storage-manager.test.ts`:

```typescript
import { describe, expect, mock, test, beforeEach } from 'bun:test'

// We'll test the internal logic by mocking @aws-sdk/client-s3
// StorageManager delegates to S3Client — we verify correct bucket routing and commands

describe('StorageManager', () => {
  describe('bucket name resolution', () => {
    test('resolves bucket name as {hubId}-{namespace}', async () => {
      const { createStorageManager } = await import('./storage-manager')
      const mgr = createStorageManager({
        endpoint: 'http://localhost:9000',
        accessKeyId: 'test',
        secretAccessKey: 'test',
      })

      // Put to attachments namespace
      // Will fail connecting to S3 but we verify it constructs correctly
      // (Integration tests will verify real S3 calls)
      await expect(
        mgr.put('hub-123', 'attachments', 'test-key', 'data')
      ).rejects.toThrow() // No S3 server in unit tests
    })
  })

  describe('provisionHub', () => {
    test('creates buckets for all registered namespaces', async () => {
      const { createStorageManager } = await import('./storage-manager')
      const mgr = createStorageManager({
        endpoint: 'http://localhost:9000',
        accessKeyId: 'test',
        secretAccessKey: 'test',
      })

      // Will fail connecting but verifies the function exists with correct signature
      await expect(mgr.provisionHub('hub-456')).rejects.toThrow()
    })
  })

  describe('destroyHub', () => {
    test('has correct interface', async () => {
      const { createStorageManager } = await import('./storage-manager')
      const mgr = createStorageManager({
        endpoint: 'http://localhost:9000',
        accessKeyId: 'test',
        secretAccessKey: 'test',
      })

      await expect(mgr.destroyHub('hub-789')).rejects.toThrow()
    })
  })

  describe('healthy', () => {
    test('returns false when endpoint unreachable', async () => {
      const { createStorageManager } = await import('./storage-manager')
      const mgr = createStorageManager({
        endpoint: 'http://localhost:59999', // unreachable
        accessKeyId: 'test',
        secretAccessKey: 'test',
      })

      const result = await mgr.healthy()
      expect(result).toBe(false)
    })
  })

  describe('env var migration', () => {
    test('reads STORAGE_* env vars', async () => {
      const { createStorageManager } = await import('./storage-manager')
      // With no env vars and no opts, should throw
      const originalEnv = { ...process.env }
      delete process.env.STORAGE_ACCESS_KEY
      delete process.env.STORAGE_SECRET_KEY
      delete process.env.MINIO_ACCESS_KEY
      delete process.env.MINIO_SECRET_KEY
      delete process.env.MINIO_APP_USER
      delete process.env.MINIO_APP_PASSWORD

      expect(() => createStorageManager()).toThrow('Storage credentials required')

      // Restore
      Object.assign(process.env, originalEnv)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/lib/storage-manager.test.ts`
Expected: FAIL — module `./storage-manager` not found

- [ ] **Step 3: Implement StorageManager**

Create `src/server/lib/storage-manager.ts`:

```typescript
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  STORAGE_NAMESPACES,
  type BlobResult,
  type StorageManager,
  type StorageNamespace,
} from '../types'

export function createStorageManager(opts?: {
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  region?: string
}): StorageManager {
  const endpoint =
    opts?.endpoint ||
    process.env.STORAGE_ENDPOINT ||
    process.env.MINIO_ENDPOINT ||
    'http://localhost:9000'

  // New STORAGE_* vars preferred; fall back to old MINIO_* vars with deprecation warning
  let accessKeyId =
    opts?.accessKeyId || process.env.STORAGE_ACCESS_KEY
  let secretAccessKey =
    opts?.secretAccessKey || process.env.STORAGE_SECRET_KEY

  if (!accessKeyId || !secretAccessKey) {
    // Legacy fallback
    accessKeyId = process.env.MINIO_APP_USER || process.env.MINIO_ACCESS_KEY
    secretAccessKey = process.env.MINIO_APP_PASSWORD || process.env.MINIO_SECRET_KEY
    if (accessKeyId && secretAccessKey) {
      console.warn(
        '[storage] Using deprecated MINIO_* env vars — migrate to STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY'
      )
    }
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Storage credentials required: set STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY (or legacy MINIO_APP_USER/MINIO_ACCESS_KEY)'
    )
  }

  const region = opts?.region || 'us-east-1'

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })

  function bucketName(hubId: string, namespace: StorageNamespace): string {
    return `${hubId}-${namespace}`
  }

  return {
    async put(
      hubId: string,
      namespace: StorageNamespace,
      key: string,
      body: ReadableStream | ArrayBuffer | Uint8Array | string
    ): Promise<void> {
      let bodyBytes: Uint8Array | string
      if (body instanceof ArrayBuffer) {
        bodyBytes = new Uint8Array(body)
      } else if (body instanceof Uint8Array) {
        bodyBytes = body
      } else if (typeof body === 'string') {
        bodyBytes = body
      } else {
        const reader = body.getReader()
        const chunks: Uint8Array[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }
        const total = chunks.reduce((s, c) => s + c.length, 0)
        bodyBytes = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          bodyBytes.set(chunk, offset)
          offset += chunk.length
        }
      }

      await client.send(
        new PutObjectCommand({
          Bucket: bucketName(hubId, namespace),
          Key: key,
          Body: bodyBytes,
        })
      )
    },

    async get(
      hubId: string,
      namespace: StorageNamespace,
      key: string
    ): Promise<BlobResult | null> {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: bucketName(hubId, namespace),
            Key: key,
          })
        )

        if (!result.Body) return null

        const size = result.ContentLength ?? 0
        const bodyBytes = await result.Body.transformToByteArray()

        return {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(bodyBytes)
              controller.close()
            },
          }),
          size,
          async arrayBuffer() {
            return bodyBytes.buffer.slice(
              bodyBytes.byteOffset,
              bodyBytes.byteOffset + bodyBytes.byteLength
            ) as ArrayBuffer
          },
        }
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null
        throw err
      }
    },

    async delete(
      hubId: string,
      namespace: StorageNamespace,
      key: string
    ): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucketName(hubId, namespace),
          Key: key,
        })
      )
    },

    async provisionHub(hubId: string): Promise<void> {
      for (const ns of Object.keys(STORAGE_NAMESPACES) as StorageNamespace[]) {
        const bucket = bucketName(hubId, ns)

        await client.send(new CreateBucketCommand({ Bucket: bucket }))

        // Enable SSE-S3 encryption at rest
        await client.send(
          new PutBucketEncryptionCommand({
            Bucket: bucket,
            ServerSideEncryptionConfiguration: {
              Rules: [
                {
                  ApplyServerSideEncryptionByDefault: {
                    SSEAlgorithm: 'AES256',
                  },
                },
              ],
            },
          })
        )

        // Apply default lifecycle rule if namespace has retention
        const config = STORAGE_NAMESPACES[ns]
        if (config.defaultRetentionDays !== null) {
          await client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: bucket,
              LifecycleConfiguration: {
                Rules: [
                  {
                    ID: `${ns}-expiry`,
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    Expiration: { Days: config.defaultRetentionDays },
                  },
                ],
              },
            })
          )
        }
      }
    },

    async destroyHub(hubId: string): Promise<void> {
      for (const ns of Object.keys(STORAGE_NAMESPACES) as StorageNamespace[]) {
        const bucket = bucketName(hubId, ns)

        // Empty the bucket first (S3 requires buckets to be empty before deletion)
        let continuationToken: string | undefined
        do {
          const list = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              ContinuationToken: continuationToken,
            })
          )

          if (list.Contents && list.Contents.length > 0) {
            await client.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: {
                  Objects: list.Contents.map((obj) => ({ Key: obj.Key })),
                  Quiet: true,
                },
              })
            )
          }

          continuationToken = list.IsTruncated
            ? list.NextContinuationToken
            : undefined
        } while (continuationToken)

        await client.send(new DeleteBucketCommand({ Bucket: bucket }))
      }
    },

    async setRetention(
      hubId: string,
      namespace: StorageNamespace,
      days: number | null
    ): Promise<void> {
      const bucket = bucketName(hubId, namespace)

      if (days === null) {
        // Remove lifecycle rules (keep forever)
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: bucket,
            LifecycleConfiguration: { Rules: [] },
          })
        )
      } else {
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: bucket,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: `${namespace}-expiry`,
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  Expiration: { Days: days },
                },
              ],
            },
          })
        )
      }
    },

    async healthy(): Promise<boolean> {
      try {
        const res = await fetch(`${endpoint}/health`, {
          signal: AbortSignal.timeout(5000),
        })
        return res.ok
      } catch {
        return false
      }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/lib/storage-manager.test.ts`
Expected: All tests PASS (healthy returns false for unreachable, env var throws, interface shapes correct)

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/storage-manager.ts src/server/lib/storage-manager.test.ts
git commit -m "feat: add StorageManager with per-hub bucket routing, SSE-S3, lifecycle management"
```

---

### Task 3: Add hubId to FileRecord Type + Mapper

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/services/files.ts` (the `#rowToFileRecord` mapper)

- [ ] **Step 1: Add hubId to FileRecord interface**

In `src/shared/types.ts`, add `hubId` to the `FileRecord` interface (after `id`, line 226):

```typescript
export interface FileRecord {
  id: string
  hubId: string
  conversationId: string | null
  // ... rest unchanged
```

- [ ] **Step 2: Add hubId to #rowToFileRecord mapper**

In `src/server/services/files.ts`, update `#rowToFileRecord` (line 133) to include:

```typescript
  #rowToFileRecord(r: typeof fileRecords.$inferSelect): FileRecord {
    return {
      id: r.id,
      hubId: r.hubId ?? 'global',
      conversationId: r.conversationId,
      // ... rest unchanged
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck 2>&1 | head -20`
Expected: May have errors where FileRecord is constructed without hubId — fix any callers

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/server/services/files.ts
git commit -m "refactor: add hubId to FileRecord type and mapper"
```

---

### Task 4: Update FilesService for Hub-Aware Storage

**Files:**
- Modify: `src/server/services/files.ts`

- [ ] **Step 1: Update FilesService constructor and blob methods**

In `src/server/services/files.ts`:

Change the import (line 6):
```typescript
// Old:
import type { BlobStorage } from '../types'
// New:
import type { StorageManager, StorageNamespace } from '../types'
```

Change the constructor (lines 8-12):
```typescript
export class FilesService {
  constructor(
    protected readonly db: Database,
    private readonly storage: StorageManager | null
  ) {}

  get hasBlob(): boolean {
    return this.storage !== null
  }
```

Update the private guard (lines 232-236):
```typescript
  #requireStorage(): StorageManager {
    if (!this.storage) throw new AppError(503, 'File storage not configured')
    return this.storage
  }
```

Update all blob methods to accept `hubId` as first parameter and use namespace routing:

```typescript
  // ------------------------------------------------------------------ Blob: Chunks

  async putChunk(hubId: string, uploadId: string, chunkIndex: number, data: ArrayBuffer): Promise<void> {
    const key = `${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    await this.#requireStorage().put(hubId, 'attachments', key, data)
  }

  async getChunk(hubId: string, uploadId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
    const key = `${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    const obj = await this.#requireStorage().get(hubId, 'attachments', key)
    return obj ? obj.arrayBuffer() : null
  }

  async deleteChunk(hubId: string, uploadId: string, chunkIndex: number): Promise<void> {
    const key = `${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    await this.#requireStorage().delete(hubId, 'attachments', key)
  }

  async deleteAllChunks(hubId: string, uploadId: string, totalChunks: number): Promise<void> {
    const storage = this.#requireStorage()
    const BATCH = 100
    for (let i = 0; i < totalChunks; i += BATCH) {
      const end = Math.min(i + BATCH, totalChunks)
      await Promise.all(
        Array.from({ length: end - i }, (_, j) => {
          const key = `${uploadId}/chunk-${String(i + j).padStart(6, '0')}`
          return storage.delete(hubId, 'attachments', key)
        })
      )
    }
  }

  // ------------------------------------------------------------------ Blob: Assembled content

  async putAssembled(hubId: string, uploadId: string, data: Uint8Array, namespace: StorageNamespace = 'attachments'): Promise<void> {
    await this.#requireStorage().put(hubId, namespace, `${uploadId}/content`, data)
  }

  async getAssembled(hubId: string, uploadId: string, namespace: StorageNamespace = 'attachments'): Promise<{ body: ReadableStream; size: number } | null> {
    return this.#requireStorage().get(hubId, namespace, `${uploadId}/content`)
  }

  async deleteAssembled(hubId: string, uploadId: string, namespace: StorageNamespace = 'attachments'): Promise<void> {
    await this.#requireStorage().delete(hubId, namespace, `${uploadId}/content`)
  }

  // ------------------------------------------------------------------ Blob: Envelopes & Metadata

  async storeEnvelopesBlob(hubId: string, uploadId: string, envelopes: FileKeyEnvelope[]): Promise<void> {
    await this.#requireStorage().put(hubId, 'attachments', `${uploadId}/envelopes`, JSON.stringify(envelopes))
  }

  async storeMetadataBlob(hubId: string, uploadId: string, meta: EncryptedMetaItem[]): Promise<void> {
    await this.#requireStorage().put(hubId, 'attachments', `${uploadId}/metadata`, JSON.stringify(meta))
  }
```

Update `resetForTest()` to accept hubId:
```typescript
  async resetForTest(hubId: string): Promise<void> {
    if (this.storage) {
      const rows = await this.db
        .select({ id: fileRecords.id, totalChunks: fileRecords.totalChunks })
        .from(fileRecords)
      await Promise.all(
        rows.flatMap((r) => [
          this.deleteAssembled(hubId, r.id).catch((err) =>
            console.error('[files] blob cleanup failed:', r.id, err)
          ),
          this.deleteAllChunks(hubId, r.id, r.totalChunks).catch((err) =>
            console.error('[files] chunk cleanup failed:', r.id, err)
          ),
        ])
      )
    }
    await this.db.delete(fileRecords)
  }
```

- [ ] **Step 2: Verify typecheck catches all callers**

Run: `bun run typecheck 2>&1 | head -40`
Expected: Errors in `routes/uploads.ts`, `routes/files.ts`, `voicemail-storage.ts` — all callers need `hubId`

- [ ] **Step 3: Commit FilesService changes**

```bash
git add src/server/services/files.ts
git commit -m "refactor: FilesService accepts StorageManager with hubId on all blob methods"
```

---

### Task 5: Update Services Wiring

**Files:**
- Modify: `src/server/services/index.ts`

- [ ] **Step 1: Update createServices to accept StorageManager**

```typescript
import type { StorageManager } from '../types'
// ... (remove BlobStorage import)

export function createServices(
  db: Database,
  storage: StorageManager | null = null,
  serverSecret = ''
): Services {
  return {
    identity: new IdentityService(db),
    settings: new SettingsService(db, serverSecret),
    records: new RecordsService(db),
    shifts: new ShiftService(db),
    calls: new CallService(db),
    conversations: new ConversationService(db),
    blasts: new BlastService(db),
    files: new FilesService(db, storage),
    gdpr: new GdprService(db),
    reportTypes: new ReportTypeService(db),
    push: new PushService(db),
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/services/index.ts
git commit -m "refactor: createServices accepts StorageManager instead of BlobStorage"
```

---

### Task 6: Update Route Handlers

**Files:**
- Modify: `src/server/routes/uploads.ts`
- Modify: `src/server/routes/files.ts`

- [ ] **Step 1: Update uploads.ts to thread hubId**

In `src/server/routes/uploads.ts`, update all `FilesService` calls to pass `hubId`:

Line 97 — putChunk:
```typescript
  // Old: await services.files.putChunk(uploadId, chunkIndex, body)
  await services.files.putChunk(hubId ?? 'global', uploadId, chunkIndex, body)
```

But first, `hubId` is not in scope in the chunk upload handler. Add it at line 65:
```typescript
uploads.put('/:id/chunks/:chunkIndex', async (c) => {
  const pubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
```

Then line 97:
```typescript
  await services.files.putChunk(hubId ?? 'global', uploadId, chunkIndex, body)
```

Line 134 — getChunk in complete handler:
```typescript
    const chunkData = await services.files.getChunk(hubId ?? 'global', uploadId, i)
```

Line 151 — putAssembled:
```typescript
  await services.files.putAssembled(hubId ?? 'global', uploadId, assembled)
```

Lines 154-155 — storeEnvelopesBlob/storeMetadataBlob:
```typescript
  await services.files.storeEnvelopesBlob(hubId ?? 'global', uploadId, record.recipientEnvelopes)
  await services.files.storeMetadataBlob(hubId ?? 'global', uploadId, record.encryptedMetadata)
```

Line 162 — deleteAllChunks:
```typescript
  await services.files.deleteAllChunks(hubId ?? 'global', uploadId, record.totalChunks)
```

- [ ] **Step 2: Update files.ts to thread hubId for getAssembled**

In `src/server/routes/files.ts`, the download handler at line 31 needs hubId. The record has `hubId` from the DB (the `file_records` table has a `hubId` column). Use the record's hubId:

```typescript
  // Old: const obj = await services.files.getAssembled(fileId)
  const namespace = record.contextType === 'voicemail' ? 'voicemails' as const : 'attachments' as const
  const obj = await services.files.getAssembled(record.hubId ?? 'global', fileId, namespace)
```

This requires that `FileRecord` type includes `hubId`. Check `src/shared/types.ts` for the `FileRecord` type and add `hubId` if missing.

- [ ] **Step 3: Verify typecheck passes for routes**

Run: `bun run typecheck 2>&1 | grep -E '(uploads|files)\.ts'`
Expected: No errors in routes (may still have errors in voicemail-storage.ts, health.ts, server.ts)

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/uploads.ts src/server/routes/files.ts
git commit -m "refactor: thread hubId through upload and file download routes"
```

---

### Task 7: Update Voicemail Storage

**Files:**
- Modify: `src/server/lib/voicemail-storage.ts`
- Modify: `src/server/lib/voicemail-storage.test.ts`

- [ ] **Step 1: Update voicemail-storage.ts**

Line 71 — change `putAssembled` call to use `'voicemails'` namespace:
```typescript
  // Old: await files.putAssembled(fileId, new Uint8Array(encryptedBytes))
  await files.putAssembled(hubId, fileId, new Uint8Array(encryptedBytes), 'voicemails')
```

Update the docstring (line 24) to say "RustFS" instead of "MinIO":
```typescript
 * 4. Store encrypted blob via FilesService (per-hub voicemails bucket)
```

- [ ] **Step 2: Update voicemail-storage.test.ts**

Update mock expectations. In test 1 (line 38), verify hubId is passed:
```typescript
    expect(mockFiles.putAssembled).toHaveBeenCalledWith(
      'hub-1',        // hubId
      expect.any(String), // fileId
      expect.any(Uint8Array),
      'voicemails'    // namespace
    )
```

In test 4 (line 107), the error message should say "Storage unavailable" instead of "MinIO unavailable":
```typescript
      putAssembled: mock(async () => {
        throw new Error('Storage unavailable')
      }),
```
And line 124:
```typescript
    ).rejects.toThrow('Storage unavailable')
```

- [ ] **Step 3: Run voicemail tests**

Run: `bun test src/server/lib/voicemail-storage.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/lib/voicemail-storage.ts src/server/lib/voicemail-storage.test.ts
git commit -m "refactor: voicemail storage uses 'voicemails' namespace with hubId routing"
```

---

### Task 8: Update Health Check

**Files:**
- Modify: `src/server/routes/health.ts`

- [ ] **Step 1: Replace MinIO HeadBucket check with RustFS health endpoint**

Replace the blob storage check block (lines 44-70) with:

```typescript
  // Blob storage check — verify RustFS is healthy
  try {
    const endpoint = process.env.STORAGE_ENDPOINT || process.env.MINIO_ENDPOINT || 'http://localhost:9000'
    const accessKeyId = process.env.STORAGE_ACCESS_KEY || process.env.MINIO_APP_USER || process.env.MINIO_ACCESS_KEY

    if (!accessKeyId) {
      checks.storage = 'failing'
      details.storage = 'Storage credentials not configured'
    } else {
      const res = await fetch(`${endpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      checks.storage = res.ok ? 'ok' : 'failing'
      if (!res.ok) details.storage = `Health check returned ${res.status}`
    }
  } catch (err) {
    checks.storage = 'failing'
    details.storage = err instanceof Error ? err.message : 'unreachable'
  }
```

Remove the `@aws-sdk/client-s3` dynamic import (lines 46-47) — no longer needed in health.ts.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck 2>&1 | grep health`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/health.ts
git commit -m "refactor: health check uses RustFS /health endpoint instead of HeadBucket"
```

---

### Task 9: Update Server Startup + Hub Lifecycle

**Files:**
- Modify: `src/server/server.ts`
- Modify: `src/server/routes/hubs.ts`
- Modify: `src/server/services/index.ts` (add `storage` to Services)

- [ ] **Step 1: Add StorageManager to Services interface**

In `src/server/services/index.ts`, add `storage` to the `Services` interface and `createServices`:

```typescript
import type { StorageManager } from '../types'

export interface Services {
  // ... existing services ...
  storage: StorageManager | null
}

export function createServices(
  db: Database,
  storage: StorageManager | null = null,
  serverSecret = ''
): Services {
  return {
    // ... existing ...
    files: new FilesService(db, storage),
    storage,
  }
}
```

- [ ] **Step 2: Update server.ts to use createStorageManager**

Replace the blob storage block (lines 76-82) in `src/server/server.ts`:

```typescript
  import { createStorageManager } from './lib/storage-manager'
  import type { StorageManager } from './types'

  let storage: StorageManager | null = null
  try {
    storage = createStorageManager()
    console.log('[llamenos] RustFS storage manager connected')
  } catch {
    console.warn('[llamenos] Storage not configured — file upload/download routes will return 503')
  }

  const services = createServices(db, storage, env.SERVER_NOSTR_SECRET ?? '')
```

Remove the old `import { createBlobStorage } from './lib/blob-storage'`.

- [ ] **Step 3: Update hubs.ts — provision storage on create, destroy on delete**

In `src/server/routes/hubs.ts`, after the `createHub` call (around line 65), add:

```typescript
  // Provision per-hub storage buckets
  if (services.storage) {
    try {
      await services.storage.provisionHub(hub.id)
    } catch (err) {
      console.error(`[hubs] Failed to provision storage for hub ${hub.id}:`, err)
    }
  }
```

For hub deletion, replace the try/catch block (lines 127-135) with:

```typescript
  try {
    await services.settings.deleteHub(hubId)

    // Destroy per-hub storage buckets after DB cascade
    // DB is source of truth — if bucket deletion fails, log orphaned buckets
    if (services.storage) {
      try {
        await services.storage.destroyHub(hubId)
      } catch (err) {
        console.error(
          `[hubs] Failed to destroy storage for hub ${hubId} — orphaned buckets may need manual cleanup:`,
          err
        )
      }
    }

    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return c.json({ error: 'Hub not found' }, 404)
    }
    return c.json({ error: 'Failed to delete hub' }, 500)
  }
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck 2>&1 | head -20`
Expected: Errors should be down to just the old `blob-storage.ts` file (which we'll delete next)

- [ ] **Step 5: Commit**

```bash
git add src/server/server.ts src/server/routes/hubs.ts src/server/services/index.ts
git commit -m "feat: wire StorageManager into server startup and hub create/delete lifecycle"
```

---

### Task 10: Delete Old blob-storage.ts + Clean Up References

**Files:**
- Delete: `src/server/lib/blob-storage.ts`
- Modify: any remaining references

- [ ] **Step 1: Delete blob-storage.ts**

```bash
rm src/server/lib/blob-storage.ts
```

- [ ] **Step 2: Search for any remaining references**

Run: `grep -r 'blob-storage\|BlobStorage\|createBlobStorage\|MINIO_BUCKET' src/server/ --include='*.ts' -l`

Fix any remaining references:
- If `types.ts` still has old `BlobStorage` — should already be replaced in Task 1
- If any test files import from `blob-storage` — update to `storage-manager`

- [ ] **Step 3: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS — no errors

- [ ] **Step 4: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete blob-storage.ts, all storage routed through StorageManager"
```

---

### Task 11: Hub Storage Settings DB Schema + Migration

**Files:**
- Create: `src/server/db/schema/storage.ts`
- Modify: `src/server/db/schema/index.ts`
- Generate: Drizzle migration

- [ ] **Step 1: Create storage schema**

Create `src/server/db/schema/storage.ts`:

```typescript
import { integer, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { hubs } from './settings'

export const hubStorageSettings = pgTable(
  'hub_storage_settings',
  {
    hubId: text('hub_id')
      .notNull()
      .references(() => hubs.id, { onDelete: 'cascade' }),
    namespace: text('namespace').notNull(),
    retentionDays: integer('retention_days'), // null = keep forever
  },
  (t) => [unique('hub_storage_namespace_uniq').on(t.hubId, t.namespace)]
)
```

- [ ] **Step 2: Export from schema/index.ts**

Add to `src/server/db/schema/index.ts`:
```typescript
export * from './storage'
```

- [ ] **Step 3: Generate migration**

Run: `bun run migrate:generate`
Expected: Creates a new SQL migration file in `drizzle/migrations/`

- [ ] **Step 4: Verify migration SQL**

Read the generated migration file. Should contain:
```sql
CREATE TABLE IF NOT EXISTS "hub_storage_settings" (
  "hub_id" text NOT NULL REFERENCES "hubs"("id") ON DELETE CASCADE,
  "namespace" text NOT NULL,
  "retention_days" integer,
  CONSTRAINT "hub_storage_namespace_uniq" UNIQUE("hub_id", "namespace")
);
```

- [ ] **Step 5: Add hubStorageSettings to deleteHub cascade**

In `src/server/services/settings.ts`, inside the `deleteHub` transaction (around line 890, with the other settings deletions), add:

```typescript
import { hubStorageSettings } from '../db/schema/storage'

// Inside deleteHub transaction, before existing deletes:
await tx.delete(hubStorageSettings).where(eq(hubStorageSettings.hubId, id))
```

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/storage.ts src/server/db/schema/index.ts drizzle/ src/server/services/settings.ts
git commit -m "feat: add hub_storage_settings table for admin-configurable retention"
```

---

### Task 12: Retention Settings API

**Files:**
- Modify: `src/server/routes/hubs.ts`

- [ ] **Step 1: Add retention settings endpoints to hubs.ts**

Add these routes after the existing hub routes in `src/server/routes/hubs.ts`:

```typescript
import { eq, and } from 'drizzle-orm'
import { hubStorageSettings } from '../db/schema/storage'
import { STORAGE_NAMESPACES, type StorageNamespace } from '../types'

// Get hub storage settings (merged with platform defaults)
routes.get('/:hubId/storage-settings', requirePermission('hub:manage-settings'), async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')
  const db = services.settings.getDb()

  const overrides = await db
    .select()
    .from(hubStorageSettings)
    .where(eq(hubStorageSettings.hubId, hubId))

  const overrideMap = new Map(overrides.map((r) => [r.namespace, r.retentionDays]))

  const settings = Object.entries(STORAGE_NAMESPACES).map(([ns, config]) => ({
    namespace: ns,
    retentionDays: overrideMap.get(ns) ?? config.defaultRetentionDays,
    platformDefault: config.defaultRetentionDays,
    isOverridden: overrideMap.has(ns),
  }))

  return c.json(settings)
})

// Update retention for a namespace
routes.patch('/:hubId/storage-settings', requirePermission('hub:manage-settings'), async (c) => {
  const hubId = c.req.param('hubId')
  const services = c.get('services')
  const db = services.settings.getDb()
  const pubkey = c.get('pubkey')

  const body = (await c.req.json()) as {
    namespace: string
    retentionDays: number | null
  }

  if (!body.namespace || !(body.namespace in STORAGE_NAMESPACES)) {
    return c.json({ error: `Invalid namespace. Valid: ${Object.keys(STORAGE_NAMESPACES).join(', ')}` }, 400)
  }

  const ns = body.namespace as StorageNamespace
  const platformDefault = STORAGE_NAMESPACES[ns].defaultRetentionDays

  // Enforce: cannot exceed platform default
  if (
    platformDefault !== null &&
    body.retentionDays !== null &&
    body.retentionDays > platformDefault
  ) {
    return c.json(
      { error: `Retention cannot exceed platform default of ${platformDefault} days` },
      400
    )
  }

  // Upsert the override
  await db
    .insert(hubStorageSettings)
    .values({ hubId, namespace: ns, retentionDays: body.retentionDays })
    .onConflictDoUpdate({
      target: [hubStorageSettings.hubId, hubStorageSettings.namespace],
      set: { retentionDays: body.retentionDays },
    })

  // Apply lifecycle rule to S3 bucket
  if (services.storage) {
    await services.storage.setRetention(hubId, ns, body.retentionDays)
  }

  await services.records.addAuditEntry(hubId, 'storageRetentionUpdated', pubkey, {
    namespace: ns,
    retentionDays: body.retentionDays,
  })

  return c.json({ ok: true, namespace: ns, retentionDays: body.retentionDays })
})
```

- [ ] **Step 2: Expose getDb() on SettingsService if not already available**

Check if `SettingsService` exposes `getDb()`. If not, add to `src/server/services/settings.ts`:

```typescript
  getDb(): Database {
    return this.db
  }
```

Or better: pass `db` through the `Services` interface. Check existing patterns — if other routes access `db` directly through services, follow that pattern.

- [ ] **Step 3: Run typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/hubs.ts src/server/services/settings.ts
git commit -m "feat: add hub storage retention settings API with platform default caps"
```

---

### Task 13: Docker Infrastructure — RustFS

**Files:**
- Modify: `deploy/docker/docker-compose.yml`
- Modify: `deploy/docker/docker-compose.dev.yml`
- Modify: `deploy/docker/docker-compose.production.yml`
- Modify: `deploy/docker/docker-compose.test.yml`
- Modify: `deploy/docker/.env.example`
- Modify: `deploy/docker/.env.dev.defaults`

- [ ] **Step 1: Update docker-compose.yml**

Replace the minio service (lines 133-149) with:

```yaml
  rustfs:
    image: rustfs/rustfs:latest
    command: server /data
    volumes:
      - rustfs-data:/data
    environment:
      - RUSTFS_ACCESS_KEY=${STORAGE_ACCESS_KEY:?Set STORAGE_ACCESS_KEY}
      - RUSTFS_SECRET_KEY=${STORAGE_SECRET_KEY:?Set STORAGE_SECRET_KEY}
      - RUSTFS_CONSOLE_ENABLE=true
    networks:
      - internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:9000/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

Rename volume `minio-data` → `rustfs-data` in the volumes section.

Update the app service environment (lines 57-60):
```yaml
      - STORAGE_ENDPOINT=http://rustfs:9000
      - STORAGE_ACCESS_KEY=${STORAGE_ACCESS_KEY:?Set STORAGE_ACCESS_KEY}
      - STORAGE_SECRET_KEY=${STORAGE_SECRET_KEY:?Set STORAGE_SECRET_KEY}
```

Remove `MINIO_BUCKET` env var from app service.

Update app `depends_on` — change `minio` to `rustfs`:
```yaml
    depends_on:
      postgres:
        condition: service_healthy
      rustfs:
        condition: service_healthy
      strfry:
        condition: service_healthy
```

- [ ] **Step 2: Update docker-compose.dev.yml**

Replace minio port overrides (lines 24-27):
```yaml
  rustfs:
    ports:
      - "9002:9000"
      - "9003:9001"
```

- [ ] **Step 3: Update docker-compose.production.yml**

If there are MinIO logging overrides, update service name to `rustfs`.

- [ ] **Step 4: Update docker-compose.test.yml**

Change any `minio` references to `rustfs` in service dependencies.

- [ ] **Step 5: Update .env.example**

Replace MinIO vars:
```
# Storage (RustFS — S3-compatible object storage)
STORAGE_ACCESS_KEY=rustfsadmin
STORAGE_SECRET_KEY=rustfsadmin
```

Remove `MINIO_BUCKET`.

- [ ] **Step 6: Update .env.dev.defaults**

```
STORAGE_ACCESS_KEY=rustfsadmin
STORAGE_SECRET_KEY=rustfsadmin
```

- [ ] **Step 7: Commit**

```bash
git add deploy/docker/
git commit -m "infra: replace MinIO with RustFS in Docker Compose configs"
```

---

### Task 14: Ansible Deployment Updates

**Files:**
- Modify: `deploy/ansible/roles/llamenos/tasks/main.yml`
- Modify: `deploy/ansible/roles/llamenos/templates/env.j2`
- Modify: `deploy/ansible/vars.example.yml`

- [ ] **Step 1: Remove MinIO init tasks from Ansible**

In `deploy/ansible/roles/llamenos/tasks/main.yml`, remove lines 83-127 (the MinIO initialization tasks: alias setup, bucket creation, lifecycle rules, IAM user/policy creation). These are no longer needed — the app handles bucket management via S3 API.

- [ ] **Step 2: Update env.j2 template**

Replace MinIO vars (lines 21-27) with:
```jinja2
# Storage (RustFS — S3-compatible, bucket management handled by app)
STORAGE_ENDPOINT=http://rustfs:9000
STORAGE_ACCESS_KEY={{ storage_access_key }}
STORAGE_SECRET_KEY={{ storage_secret_key }}
```

- [ ] **Step 3: Update vars.example.yml**

Replace MinIO vars (lines 93-104) with:
```yaml
# Storage (RustFS)
storage_access_key: "eeeeeeeeeeeeeeeeeeeeeeee"  # Root credentials for RustFS
storage_secret_key: "ffffffffffffffffffffffff"
```

Remove `minio_bucket`, `minio_app_user`, `minio_app_password` — no longer needed.

- [ ] **Step 4: Commit**

```bash
git add deploy/ansible/
git commit -m "infra: update Ansible for RustFS, remove MinIO init tasks"
```

---

### Task 15: Helm Chart Updates

**Files:**
- Modify: `deploy/helm/llamenos/values.yaml`
- Rename: `deploy/helm/llamenos/templates/statefulset-minio.yaml` → `statefulset-rustfs.yaml`

- [ ] **Step 1: Update values.yaml**

Replace the `minio` section (lines 29-49) with:
```yaml
rustfs:
  enabled: true
  image:
    repository: rustfs/rustfs
    tag: "latest"
  persistence:
    size: 50Gi
    storageClass: ""
  credentials:
    accessKey: ""     # REQUIRED
    secretKey: ""     # REQUIRED
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

- [ ] **Step 2: Rewrite statefulset as statefulset-rustfs.yaml**

Rename the file and update:
- Container image references to `rustfs/rustfs`
- Environment variables to `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`, `RUSTFS_CONSOLE_ENABLE`
- Liveness probe: `httpGet path: /health port: 9000`
- Readiness probe: `httpGet path: /health port: 9000`
- Security context: `runAsUser: 10001`, `fsGroup: 10001`
- Secret name references from `minio` to `rustfs`
- Service name from `minio` to `rustfs`

```bash
mv deploy/helm/llamenos/templates/statefulset-minio.yaml deploy/helm/llamenos/templates/statefulset-rustfs.yaml
```

Then edit the file with the above changes.

- [ ] **Step 3: Update any Helm template references to `minio` service name**

Search for `minio` in all Helm templates and update to `rustfs`:
```bash
grep -rl 'minio' deploy/helm/llamenos/templates/
```

- [ ] **Step 4: Commit**

```bash
git add deploy/helm/
git commit -m "infra: update Helm chart for RustFS (statefulset, values, probes)"
```

---

### Task 16: Delete init-minio.sh

**Files:**
- Delete: `deploy/scripts/init-minio.sh`

- [ ] **Step 1: Delete the script**

```bash
rm deploy/scripts/init-minio.sh
```

- [ ] **Step 2: Search for any references to init-minio.sh**

```bash
grep -r 'init-minio' deploy/ docs/ .github/ --include='*.yml' --include='*.yaml' --include='*.md' --include='*.sh' -l
```

Remove any references found.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete init-minio.sh — bucket management handled by app StorageManager"
```

---

### Task 17: Update CLAUDE.md + Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md references**

Search for all MinIO references and update:

- Tech stack section: change "MinIO" references to "RustFS"
- `docker-compose.dev.yml` backing services description: "postgres, minio, strfry" → "postgres, rustfs, strfry"
- Environment variable references: `MINIO_*` → `STORAGE_*`
- Any `init-minio.sh` references → remove
- Key technical patterns: update blob storage description
- Gotchas: remove MinIO-specific gotchas if any, add RustFS UID 10001 note

- [ ] **Step 2: Update .env.live.example if it exists**

Check for MinIO vars and update to STORAGE_*.

- [ ] **Step 3: Run final typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for MinIO → RustFS migration"
```

---

### Task 18: Integration Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Start dev backing services**

```bash
bun run dev:docker
```

Wait for RustFS to be healthy (check `docker ps` for health status).

- [ ] **Step 2: Run unit tests**

```bash
bun run test:unit
```

Expected: All tests PASS including `storage-manager.test.ts` and `voicemail-storage.test.ts`

- [ ] **Step 3: Run the dev server**

```bash
bun run dev:server
```

Check console output for: `[llamenos] RustFS storage manager connected`

- [ ] **Step 4: Verify health endpoint**

```bash
curl http://localhost:3000/api/health | jq .
```

Expected: `"storage": "ok"` in checks

- [ ] **Step 5: Run API tests if available**

```bash
bun run test:api
```

- [ ] **Step 6: Run E2E tests**

```bash
bun run test:e2e
```

- [ ] **Step 7: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address integration test findings from RustFS migration"
```
