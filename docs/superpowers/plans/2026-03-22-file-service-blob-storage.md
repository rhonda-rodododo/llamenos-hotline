# File Service & Blob Storage Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cloudflare R2 + DO file storage with a Drizzle file_records table + MinIO BlobStorage service, and add E2E tests.

**Architecture:** Add a file_records Drizzle table for FileRecord metadata, create FilesService encapsulating both DB operations and blob storage operations, inject BlobStorage via service constructor, migrate uploads.ts and files.ts routes to use FilesService, add E2E test.

**Tech Stack:** Drizzle ORM (drizzle-orm/bun-sql), MinIO (@aws-sdk/client-s3), Hono, Bun, Playwright

---

## Context & Constraints

- The `BlobStorage` interface is already defined in `src/platform/types.ts` and implemented for MinIO in `src/platform/node/blob-storage.ts` (reads `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` env vars).
- `src/worker/routes/uploads.ts` currently stores all file state (manifest, chunks, assembled content, envelopes, metadata) in R2 as JSON blobs. There is no DB table yet.
- `src/worker/routes/files.ts` currently reads content from R2 but returns `501` for envelopes, metadata, and share — all explicitly noting that a `file_records` table is missing.
- The `FileRecord` and `UploadInit` types are already defined in `src/shared/types.ts`.
- All other services follow the pattern: class with `constructor(protected readonly db: Database)`, private `#rowTo*` mapper, `resetForTest()` method. `FilesService` will extend this with a second constructor arg `private readonly blob: BlobStorage`.
- `BlobStorage` is optional — if `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` are absent, `createBlobStorage()` throws. Routes must handle a missing blob service and return `503`.
- Blob keys follow the existing R2 naming convention: `files/{id}/chunk-{000000}`, `files/{id}/content`, `files/{id}/envelopes`, `files/{id}/metadata` — preserve these keys so that any already-stored blobs remain accessible.
- `src/server/db/schema/index.ts` exports all schema tables — add `file_records` there.
- `src/server/services/index.ts` assembles all services — `FilesService` gets added here with `BlobStorage` passed in, requiring `createServices` to accept `blob: BlobStorage | null`.
- The `EncryptedMetaItem` inline type (`{ pubkey: string; encryptedContent: string; ephemeralPubkey: string }`) matches the shape in `FileRecord.encryptedMetadata`; extract as a named type in `src/shared/types.ts` to avoid inline repetition.
- The `completedChunks` field in the DB must be updated atomically using `sql` interpolation (same pattern as `messageCount` in `ConversationService`).
- The chunk upload endpoint currently reads the manifest, increments `completedChunks`, and writes back — this is a read-modify-write with a race condition. The DB version must use `sql\`${fileRecords.completedChunks} + 1\`` for atomicity.
- E2E tests use `resetTestState(request)` (calls `/api/test-reset`) for teardown. `FilesService.resetForTest()` must be called from the test-reset handler.

---

## Task 1: Add `file_records` table to Drizzle schema

**File:** `src/server/db/schema/conversations.ts`
**File:** `src/server/db/schema/index.ts`
**File:** `src/shared/types.ts`

### Steps

- [ ] In `src/shared/types.ts`, extract the inline encrypted-metadata item shape as a named export:
  ```typescript
  export interface EncryptedMetaItem {
    pubkey: string
    encryptedContent: string
    ephemeralPubkey: string
  }
  ```
  Update `FileRecord.encryptedMetadata` and `UploadInit.encryptedMetadata` to use `EncryptedMetaItem[]`.

- [ ] In `src/server/db/schema/conversations.ts`, add the `file_records` table after the `messageEnvelopes` table:
  ```typescript
  export const fileRecords = pgTable('file_records', {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    messageId: text('message_id'),
    uploadedBy: text('uploaded_by').notNull(),
    recipientEnvelopes: jsonb<FileKeyEnvelope[]>()('recipient_envelopes').notNull().default([]),
    encryptedMetadata: jsonb<EncryptedMetaItem[]>()('encrypted_metadata').notNull().default([]),
    totalSize: integer('total_size').notNull(),
    totalChunks: integer('total_chunks').notNull(),
    status: text('status').notNull().default('uploading'), // 'uploading' | 'complete' | 'failed'
    completedChunks: integer('completed_chunks').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  })
  ```
  Import `FileKeyEnvelope` and `EncryptedMetaItem` from `@shared/types`.

- [ ] In `src/server/db/schema/index.ts`, add `export * from './files'` — but since the file_records table is defined in `conversations.ts` (same file as `conversations` and `messageEnvelopes`), no new file is needed; confirm the existing `export * from './conversations'` already covers it.

- [ ] Generate the Drizzle migration:
  ```bash
  cd /home/rikki/projects/llamenos-hotline/.worktrees/cf-removal
  bunx drizzle-kit generate
  ```
  Verify the generated SQL in `drizzle/migrations/` creates the `file_records` table with all columns and correct types.

---

## Task 2: Create `FilesService` — DB operations

**File:** `src/server/services/files.ts` (new file)

The service owns all DB reads/writes for `file_records`. It follows the same class structure as `ConversationService`.

### Steps

- [ ] Create `src/server/services/files.ts` with the `FilesService` class:

```typescript
import { eq, sql } from 'drizzle-orm'
import type { FileKeyEnvelope, FileRecord, EncryptedMetaItem } from '../../shared/types'
import { fileRecords } from '../db/schema'
import type { Database } from '../db'
import type { BlobStorage } from '../../platform/types'
import { AppError } from '../lib/errors'

export class FilesService {
  constructor(
    protected readonly db: Database,
    private readonly blob: BlobStorage | null,
  ) {}

  // ------------------------------------------------------------------ DB: FileRecord CRUD

  async createFileRecord(data: Omit<FileRecord, 'completedChunks' | 'createdAt' | 'completedAt'>): Promise<FileRecord> {
    const now = new Date()
    const [row] = await this.db
      .insert(fileRecords)
      .values({
        id: data.id,
        conversationId: data.conversationId,
        messageId: data.messageId ?? null,
        uploadedBy: data.uploadedBy,
        recipientEnvelopes: data.recipientEnvelopes,
        encryptedMetadata: data.encryptedMetadata,
        totalSize: data.totalSize,
        totalChunks: data.totalChunks,
        status: data.status,
        completedChunks: 0,
        createdAt: now,
      })
      .returning()
    return this.#rowToFileRecord(row)
  }

  async getFileRecord(id: string): Promise<FileRecord | null> {
    const rows = await this.db
      .select()
      .from(fileRecords)
      .where(eq(fileRecords.id, id))
      .limit(1)
    return rows[0] ? this.#rowToFileRecord(rows[0]) : null
  }

  /**
   * Atomically increment completedChunks. Returns the updated counts.
   * Uses sql`` to avoid read-modify-write races.
   */
  async incrementChunk(id: string): Promise<{ completedChunks: number; totalChunks: number }> {
    const [row] = await this.db
      .update(fileRecords)
      .set({ completedChunks: sql`${fileRecords.completedChunks} + 1` })
      .where(eq(fileRecords.id, id))
      .returning({ completedChunks: fileRecords.completedChunks, totalChunks: fileRecords.totalChunks })
    if (!row) throw new AppError(404, 'Upload not found')
    return { completedChunks: row.completedChunks, totalChunks: row.totalChunks }
  }

  async completeUpload(id: string): Promise<FileRecord> {
    const [row] = await this.db
      .update(fileRecords)
      .set({ status: 'complete', completedAt: new Date() })
      .where(eq(fileRecords.id, id))
      .returning()
    if (!row) throw new AppError(404, 'Upload not found')
    return this.#rowToFileRecord(row)
  }

  async failUpload(id: string): Promise<void> {
    await this.db
      .update(fileRecords)
      .set({ status: 'failed' })
      .where(eq(fileRecords.id, id))
  }

  async getFilesByConversation(conversationId: string): Promise<FileRecord[]> {
    const rows = await this.db
      .select()
      .from(fileRecords)
      .where(eq(fileRecords.conversationId, conversationId))
    return rows.map((r) => this.#rowToFileRecord(r))
  }

  async addRecipientEnvelope(id: string, envelope: FileKeyEnvelope, meta: EncryptedMetaItem): Promise<void> {
    const record = await this.getFileRecord(id)
    if (!record) throw new AppError(404, 'File not found')
    await this.db
      .update(fileRecords)
      .set({
        recipientEnvelopes: [...record.recipientEnvelopes, envelope],
        encryptedMetadata: [...record.encryptedMetadata, meta],
      })
      .where(eq(fileRecords.id, id))
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToFileRecord(r: typeof fileRecords.$inferSelect): FileRecord {
    return {
      id: r.id,
      conversationId: r.conversationId,
      messageId: r.messageId ?? undefined,
      uploadedBy: r.uploadedBy,
      recipientEnvelopes: (r.recipientEnvelopes as FileKeyEnvelope[]) ?? [],
      encryptedMetadata: (r.encryptedMetadata as EncryptedMetaItem[]) ?? [],
      totalSize: r.totalSize,
      totalChunks: r.totalChunks,
      status: r.status as FileRecord['status'],
      completedChunks: r.completedChunks,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString(),
    }
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(fileRecords)
  }
}
```

> **Concurrency note:** `addRecipientEnvelope` has a read-modify-write pattern — it reads the current arrays, appends, and writes back. Concurrent share operations on the same file could lose envelopes if they race. As a future hardening item, this should be replaced with a PostgreSQL JSONB append expression (e.g. `jsonb_build_array || to_jsonb(...)`) so the append is atomic at the database level. This does not change the implementation approach described in this plan.

- [ ] Note: blob storage methods are added in Task 3 below.

---

## Task 3: Add blob storage methods to `FilesService`

**File:** `src/server/services/files.ts`

All blob operations are delegated to `this.blob`. Methods throw `AppError(503, ...)` if blob is not configured. Blob key convention mirrors the existing R2 paths.

### Steps

- [ ] Add a private helper that asserts blob is configured:
  ```typescript
  #requireBlob(): BlobStorage {
    if (!this.blob) throw new AppError(503, 'File storage not configured')
    return this.blob
  }
  ```

- [ ] Add blob methods to `FilesService`:

  ```typescript
  // ------------------------------------------------------------------ Blob: Chunks

  async putChunk(uploadId: string, chunkIndex: number, data: ArrayBuffer): Promise<void> {
    const key = `files/${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    await this.#requireBlob().put(key, data)
  }

  async getChunk(uploadId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
    const key = `files/${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    const obj = await this.#requireBlob().get(key)
    return obj ? obj.arrayBuffer() : null
  }

  async deleteChunk(uploadId: string, chunkIndex: number): Promise<void> {
    const key = `files/${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    await this.#requireBlob().delete(key)
  }

  async deleteAllChunks(uploadId: string, totalChunks: number): Promise<void> {
    const blob = this.#requireBlob()
    for (let i = 0; i < totalChunks; i++) {
      const key = `files/${uploadId}/chunk-${String(i).padStart(6, '0')}`
      await blob.delete(key)
    }
  }

  // ------------------------------------------------------------------ Blob: Assembled content

  async putAssembled(uploadId: string, data: Uint8Array): Promise<void> {
    await this.#requireBlob().put(`files/${uploadId}/content`, data)
  }

  async getAssembled(uploadId: string): Promise<{ body: ReadableStream; size: number } | null> {
    return this.#requireBlob().get(`files/${uploadId}/content`)
  }

  async deleteAssembled(uploadId: string): Promise<void> {
    await this.#requireBlob().delete(`files/${uploadId}/content`)
  }

  // ------------------------------------------------------------------ Blob: Envelopes & Metadata
  // NOTE: With the DB-backed approach, envelopes and metadata live in file_records.
  // These blob methods are kept for the assembly step which writes them to blob for
  // legacy compatibility, but getEnvelopes/getMetadata read from DB (Task 6 routes use DB).

  async storeEnvelopesBlob(uploadId: string, envelopes: FileKeyEnvelope[]): Promise<void> {
    await this.#requireBlob().put(`files/${uploadId}/envelopes`, JSON.stringify(envelopes))
  }

  async storeMetadataBlob(uploadId: string, meta: EncryptedMetaItem[]): Promise<void> {
    await this.#requireBlob().put(`files/${uploadId}/metadata`, JSON.stringify(meta))
  }
  ```

  > **Design note:** Envelopes and metadata are the authoritative source from the DB (`file_records.recipientEnvelopes` / `file_records.encryptedMetadata`). The blob copies written during assembly (`files/{id}/envelopes`, `files/{id}/metadata`) are written for backward compatibility with any existing stored files, but the migrated routes read exclusively from the DB. The `storeEnvelopesBlob`/`storeMetadataBlob` methods remain for the assembly step only.

---

## Task 4: Wire `BlobStorage` into `createServices` and `server.ts`

**File:** `src/server/services/index.ts`
**File:** `src/platform/node/server.ts`

### Steps

- [ ] In `src/server/services/index.ts`:
  - Import `FilesService` and `BlobStorage`.
  - Add `files: FilesService` to the `Services` interface.
  - Update `createServices` signature to accept `blob: BlobStorage | null = null`.
  - Instantiate `new FilesService(db, blob)` in the factory.

  ```typescript
  import type { BlobStorage } from '../../platform/types'
  import { FilesService } from './files'

  export type { FilesService, /* ...existing exports */ }

  export interface Services {
    // ...existing fields
    files: FilesService
  }

  export function createServices(db: Database, blob: BlobStorage | null = null): Services {
    return {
      // ...existing services
      files: new FilesService(db, blob),
    }
  }
  ```

- [ ] In `src/platform/node/server.ts`:
  - Import `createBlobStorage` from `../../platform/node/blob-storage`.
  - After `loadEnv()`, attempt to create a BlobStorage instance. If env vars are missing, log a warning and pass `null`:
    ```typescript
    let blob: BlobStorage | null = null
    try {
      blob = createBlobStorage()
      console.log('[llamenos] MinIO blob storage connected')
    } catch {
      console.warn('[llamenos] MinIO not configured — file upload/download routes will return 503')
    }
    ```
  - Pass `blob` to `createServices(db, blob)`.

- [ ] Confirm that `BlobStorage` import in `server.ts` uses the platform interface type (not the implementation), for clean typing:
  ```typescript
  import type { BlobStorage } from '../../platform/types'
  import { createBlobStorage } from './blob-storage'
  ```

- [ ] Wire `files.resetForTest()` into all three reset handlers in `src/worker/routes/dev.ts`:
  - `/test-reset` — full reset (add alongside `conversations.resetForTest()`)
  - `/test-reset-no-admin` — full reset without admin (same location)
  - `/test-reset-records` — light reset that clears transient data (add alongside `conversations.resetForTest()`)

  In each handler, add:
  ```typescript
  await services.files.resetForTest()
  ```
  alongside the other `resetForTest()` calls. File records are transient data, so they belong in all three handlers.

---

## Task 5: Migrate `src/worker/routes/uploads.ts` to `FilesService`

**File:** `src/worker/routes/uploads.ts`

Replace all `c.env.R2_BUCKET` usage and manifest-in-R2 pattern with `services.files` methods.

### Steps

- [ ] Rewrite `POST /uploads/init`:
  - Remove `c.env.R2_BUCKET` check — the blob check is now inside `FilesService`. If blob is not configured, the `createFileRecord` call itself will succeed (DB only), but `putChunk` will fail later with 503. Guard: call `services.files.hasBlob()` (add a public getter: `get hasBlob() { return this.blob !== null }`), return 503 early if false.
  - Create a `FileRecord` with `crypto.randomUUID()` as `id`, then call `services.files.createFileRecord(...)`.
  - Return `{ uploadId, totalChunks }`.

  ```typescript
  uploads.post('/init', async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId')
    const pubkey = c.get('pubkey')
    const body = (await c.req.json()) as UploadInit

    if (!body.totalSize || !body.totalChunks || !body.conversationId) {
      return c.json({ error: 'Missing required fields: totalSize, totalChunks, conversationId' }, 400)
    }
    if (body.totalSize > MAX_UPLOAD_SIZE) {
      return c.json({ error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` }, 400)
    }
    if (body.totalChunks > MAX_CHUNKS) {
      return c.json({ error: 'Too many chunks (max 10000)' }, 400)
    }
    if (!services.files.hasBlob) {
      return c.json({ error: 'File storage not configured' }, 503)
    }

    const uploadId = crypto.randomUUID()
    await services.files.createFileRecord({
      id: uploadId,
      conversationId: body.conversationId,
      uploadedBy: pubkey,
      recipientEnvelopes: body.recipientEnvelopes ?? [],
      encryptedMetadata: body.encryptedMetadata ?? [],
      totalSize: body.totalSize,
      totalChunks: body.totalChunks,
      status: 'uploading',
    })

    await services.records.addAuditEntry(hubId ?? 'global', 'fileUploadStarted', pubkey, {
      uploadId,
      conversationId: body.conversationId,
      totalSize: body.totalSize,
      totalChunks: body.totalChunks,
    })

    return c.json({ uploadId, totalChunks: body.totalChunks })
  })
  ```

- [ ] Rewrite `PUT /uploads/:id/chunks/:chunkIndex`:
  - Look up the file record via `services.files.getFileRecord(uploadId)` — return 404 if missing.
  - Ownership check: `record.uploadedBy !== pubkey && !checkPermission(...)`.
  - Validate chunk index against `record.totalChunks`.
  - Read body as `ArrayBuffer`, validate size.
  - Call `services.files.putChunk(uploadId, chunkIndex, body)`.
  - Call `services.files.incrementChunk(uploadId)` for the atomic counter update.
  - Return `{ chunkIndex, completedChunks, totalChunks }`.

- [ ] Rewrite `POST /uploads/:id/complete`:
  - Fetch record via `services.files.getFileRecord(uploadId)` — 404 if missing.
  - Ownership check.
  - Verify `record.completedChunks >= record.totalChunks` — return 400 if not.
  - Assemble chunks: loop `getChunk(uploadId, i)`, collect into `Uint8Array`.
  - Call `services.files.putAssembled(uploadId, assembled)`.
  - Persist blob copies: `storeEnvelopesBlob` + `storeMetadataBlob` (for backward compat).
  - Delete chunks: `deleteAllChunks(uploadId, record.totalChunks)`.
  - Call `services.files.completeUpload(uploadId)`.
  - Audit log `fileUploadCompleted`.
  - Return `{ fileId: uploadId, status: 'complete' }`.

- [ ] Rewrite `GET /uploads/:id/status`:
  - Fetch record via `services.files.getFileRecord(uploadId)` — 404 if missing.
  - Ownership check (same logic as before).
  - Return `{ uploadId, status, completedChunks, totalChunks, totalSize }` from the DB record.

- [ ] Add `MAX_CHUNKS = 10000` constant alongside `MAX_UPLOAD_SIZE` and `MAX_CHUNK_SIZE`.

- [ ] Remove all `c.env.R2_BUCKET` references from this file. The route must compile without `R2_BUCKET` being accessed.

---

## Task 6: Migrate `src/worker/routes/files.ts` to `FilesService`

**File:** `src/worker/routes/files.ts`

Replace the `501` stub endpoints with real implementations reading from DB + blob.

### Steps

- [ ] Rewrite `GET /files/:id/content`:
  - Remove `c.env.R2_BUCKET` check — replace with `services.files.hasBlob` check.
  - Add proper ownership check: fetch `services.files.getFileRecord(fileId)`. If not found, return 404. Check that `pubkey` is in `record.recipientEnvelopes.map(e => e.pubkey)` OR `checkPermission(permissions, 'files:download-all')`. Return 403 if neither.
  - Call `services.files.getAssembled(fileId)` — return 404 if null.
  - Return streaming response with `Content-Type: application/octet-stream`, `Content-Length`, `Cache-Control: private, no-cache`.

- [ ] Rewrite `GET /files/:id/envelopes`:
  - Fetch record via `services.files.getFileRecord(fileId)` — 404 if missing.
  - Ownership check (same as content endpoint).
  - Return `c.json(record.recipientEnvelopes)`.

- [ ] Rewrite `GET /files/:id/metadata`:
  - Fetch record via `services.files.getFileRecord(fileId)` — 404 if missing.
  - Ownership check.
  - Return `c.json(record.encryptedMetadata)`.

- [ ] Rewrite `POST /files/:id/share`:
  - Fetch record via `services.files.getFileRecord(fileId)` — 404 if missing.
  - Check existing ownership (uploader or `files:download-all`).
  - Validate request body: `{ envelope: FileKeyEnvelope, encryptedMetadata: EncryptedMetaItem }`.
  - Call `services.files.addRecipientEnvelope(fileId, body.envelope, body.encryptedMetadata)`.
  - Audit log `fileShared`.
  - Return `c.json({ success: true })`.

- [ ] Remove the `501` stubs and all `c.env.R2_BUCKET` references from this file.

- [ ] Add `requirePermission('files:read')` middleware (or check inline) to `GET` routes — review what guards the upload routes use and apply consistently.

---

## Task 7: E2E test for file upload lifecycle

**File:** `tests/file-upload.spec.ts` (new file)

The test exercises the full upload lifecycle via the API. Tests use a `page` fixture with `loginAsAdmin(page)` for auth (matching the pattern in `tests/multi-hub.spec.ts`), and call the API via `page.evaluate(() => window.__authedFetch(...))` inside the browser context. Direct binary downloads use `page.evaluate` to call `window.__authedFetch` and retrieve the response as an `ArrayBuffer`.

### Steps

- [ ] Create `tests/file-upload.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import { loginAsAdmin, resetTestState } from './helpers'

// Extend window type for the authed fetch helper injected by loginAsAdmin tests
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

test.describe('File upload lifecycle', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    // Inject authed fetch helper using keyManager auth tokens — same pattern as multi-hub.spec.ts
    await page.evaluate(() => {
      window.__authedFetch = async (url: string, options: RequestInit = {}) => {
        const km = (window as any).__TEST_KEY_MANAGER
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string> || {}),
        }
        if (km?.isUnlocked()) {
          const reqMethod = (options.method || 'GET').toUpperCase()
          const reqPath = new URL(url, location.origin).pathname
          const token = km.createAuthToken(Date.now(), reqMethod, reqPath)
          headers['Authorization'] = `Bearer ${token}`
        }
        return fetch(url, { ...options, headers })
      }
    })
  })

  test('full upload flow: init → chunks → complete → download', async ({ page }) => {
    // Create a conversation to attach the file to
    const conversationId = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ channelType: 'web', contactIdentifierHash: 'test-hash-file-upload' }),
      })
      const data = await res.json()
      return data.id as string
    })
    expect(typeof conversationId).toBe('string')

    // Get the admin pubkey from keyManager for envelope construction
    const adminPubkey = await page.evaluate(() => {
      return (window as any).__TEST_KEY_MANAGER?.getPublicKey() as string
    })
    expect(typeof adminPubkey).toBe('string')

    // Init upload
    const uploadId = await page.evaluate(
      async ([conversationId, adminPubkey]: [string, string]) => {
        const res = await window.__authedFetch('/api/uploads/init', {
          method: 'POST',
          body: JSON.stringify({
            totalSize: 10,
            totalChunks: 2,
            conversationId,
            recipientEnvelopes: [
              { pubkey: adminPubkey, encryptedFileKey: 'test-key-hex', ephemeralPubkey: 'test-ephem-hex' },
            ],
            encryptedMetadata: [
              { pubkey: adminPubkey, encryptedContent: 'test-meta-hex', ephemeralPubkey: 'test-ephem-hex' },
            ],
          }),
        })
        if (!res.ok) throw new Error(`Init failed: ${res.status} ${await res.text()}`)
        const data = await res.json()
        return data.uploadId as string
      },
      [conversationId, adminPubkey] as [string, string],
    )
    expect(typeof uploadId).toBe('string')

    // Upload chunks — send as base64 and decode on server side is not needed;
    // use fetch with an ArrayBuffer body via page.evaluate
    const chunk0Result = await page.evaluate(async (uploadId: string) => {
      const body = new Uint8Array([1, 2, 3, 4, 5]).buffer
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
      if (km?.isUnlocked()) {
        const token = km.createAuthToken(Date.now(), 'PUT', `/api/uploads/${uploadId}/chunks/0`)
        headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch(`/api/uploads/${uploadId}/chunks/0`, { method: 'PUT', headers, body })
      if (!res.ok) return { ok: false, status: res.status, text: await res.text() }
      return { ok: true, ...(await res.json()) }
    }, uploadId)
    expect(chunk0Result.ok).toBe(true)
    expect(chunk0Result.completedChunks).toBe(1)
    expect(chunk0Result.totalChunks).toBe(2)

    const chunk1Result = await page.evaluate(async (uploadId: string) => {
      const body = new Uint8Array([6, 7, 8, 9, 10]).buffer
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
      if (km?.isUnlocked()) {
        const token = km.createAuthToken(Date.now(), 'PUT', `/api/uploads/${uploadId}/chunks/1`)
        headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch(`/api/uploads/${uploadId}/chunks/1`, { method: 'PUT', headers, body })
      return { ok: res.ok, status: res.status }
    }, uploadId)
    expect(chunk1Result.ok).toBe(true)

    // Check status before completing
    const statusData = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/status`)
      return res.json()
    }, uploadId)
    expect(statusData.completedChunks).toBe(2)
    expect(statusData.totalChunks).toBe(2)
    expect(statusData.status).toBe('uploading')

    // Complete the upload
    const completeData = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/complete`, { method: 'POST' })
      if (!res.ok) throw new Error(`Complete failed: ${res.status} ${await res.text()}`)
      return res.json()
    }, uploadId)
    expect(completeData.fileId).toBe(uploadId)
    expect(completeData.status).toBe('complete')

    // Download content — use __authedFetch and read as ArrayBuffer
    const downloadedBytes = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/files/${uploadId}/content`)
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const buf = await res.arrayBuffer()
      return Array.from(new Uint8Array(buf))
    }, uploadId)
    expect(downloadedBytes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    // Get envelopes from DB
    const envelopes = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/files/${uploadId}/envelopes`)
      return res.json()
    }, uploadId)
    expect(Array.isArray(envelopes)).toBe(true)
    expect(envelopes[0].pubkey).toBe(adminPubkey)

    // Get metadata from DB
    const meta = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/files/${uploadId}/metadata`)
      return res.json()
    }, uploadId)
    expect(Array.isArray(meta)).toBe(true)
    expect(meta[0].pubkey).toBe(adminPubkey)
  })

  test('cannot complete upload with missing chunks', async ({ page }) => {
    const conversationId = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ channelType: 'web', contactIdentifierHash: 'test-hash-missing-chunks' }),
      })
      const data = await res.json()
      return data.id as string
    })

    const adminPubkey = await page.evaluate(() => {
      return (window as any).__TEST_KEY_MANAGER?.getPublicKey() as string
    })

    const uploadId = await page.evaluate(
      async ([conversationId, adminPubkey]: [string, string]) => {
        const res = await window.__authedFetch('/api/uploads/init', {
          method: 'POST',
          body: JSON.stringify({
            totalSize: 100,
            totalChunks: 3,
            conversationId,
            recipientEnvelopes: [{ pubkey: adminPubkey, encryptedFileKey: 'k', ephemeralPubkey: 'e' }],
            encryptedMetadata: [{ pubkey: adminPubkey, encryptedContent: 'm', ephemeralPubkey: 'e' }],
          }),
        })
        const data = await res.json()
        return data.uploadId as string
      },
      [conversationId, adminPubkey] as [string, string],
    )

    // Only upload 1 of 3 chunks
    await page.evaluate(async (uploadId: string) => {
      const body = new Uint8Array([1, 2, 3]).buffer
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
      if (km?.isUnlocked()) {
        const token = km.createAuthToken(Date.now(), 'PUT', `/api/uploads/${uploadId}/chunks/0`)
        headers['Authorization'] = `Bearer ${token}`
      }
      await fetch(`/api/uploads/${uploadId}/chunks/0`, { method: 'PUT', headers, body })
    }, uploadId)

    const completeResult = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/complete`, { method: 'POST' })
      return { status: res.status, body: await res.json() }
    }, uploadId)
    expect(completeResult.status).toBe(400)
    expect(completeResult.body.completedChunks).toBe(1)
    expect(completeResult.body.totalChunks).toBe(3)
  })
})
```

- [ ] Verify the test can be run once the server is up:
  ```bash
  bunx playwright test tests/file-upload.spec.ts
  ```
  If MinIO is not running, the init endpoint will return 503 — run `bun run dev:docker` first.

---

## Task 8: Typecheck + build verification

**Commands to run in `src/worktrees/cf-removal`:**

### Steps

- [ ] Run typecheck:
  ```bash
  bun run typecheck
  ```
  Fix any type errors. Common sources:
  - `fileRecords.$inferSelect` column types (timestamps return `Date`, not `string` — use `.toISOString()` in mapper).
  - `sql`` expression type widening on `completedChunks` — may need explicit cast or `.returning()` field selection.
  - `BlobStorage | null` propagation through `createServices`.
  - `EncryptedMetaItem` import in schema file — must use `@shared/types` alias.

- [ ] Run build:
  ```bash
  bun run build
  ```
  Fix any bundler errors.

- [ ] Run the new test:
  ```bash
  bunx playwright test tests/file-upload.spec.ts
  ```
  All tests must pass. If MinIO is not running locally, the tests will return 503 — run `bun run dev:docker` first to start the MinIO container.

- [ ] Run the full test suite to confirm no regressions:
  ```bash
  bunx playwright test
  ```

---

## File Change Summary

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `EncryptedMetaItem` named export; update `FileRecord` and `UploadInit` to use it |
| `src/server/db/schema/conversations.ts` | Add `fileRecords` pgTable definition |
| `src/server/db/schema/index.ts` | Already exports `conversations.ts` — no change needed |
| `src/server/services/files.ts` | New file: `FilesService` class with DB + blob methods |
| `src/server/services/index.ts` | Add `files: FilesService`, update `createServices(db, blob?)` |
| `src/platform/node/server.ts` | Create `BlobStorage` instance, pass to `createServices` |
| `src/worker/routes/uploads.ts` | Migrate from R2/manifest-in-blob to `services.files` |
| `src/worker/routes/files.ts` | Replace 501 stubs with real `services.files` calls |
| `src/worker/routes/test-reset.ts` | Add `services.files.resetForTest()` call |
| `tests/file-upload.spec.ts` | New E2E test: upload lifecycle, missing-chunk guard, ACL check |
| `drizzle/migrations/` | New migration SQL for `file_records` table (generated) |
