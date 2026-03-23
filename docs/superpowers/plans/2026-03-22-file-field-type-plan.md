# File Field Type for Custom Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a `file` custom field type that allows attaching encrypted files to notes and reports through the custom fields system. Files stored in MinIO/R2 via the existing chunked upload system. File keys stored as ECIES-wrapped `FileKeyEnvelope` records server-side (same model as message attachments) — not embedded in the parent note payload.

**Context:** v1 has `file_records` table (from `2026-03-22-drizzle-schema-completeness-addendum.md`) and MinIO configured. The chunked upload API (`/api/uploads/`) and file download API (`/api/files/`) already exist and are used by the messaging system. `CustomFieldDefinition.type` already includes `'file'` in `src/shared/types.ts`. This plan wires up the file upload flow to the custom fields UI layer.

**Depends on:** `file_records` table must exist (from drizzle-schema-completeness-addendum). Apply that addendum first.

---

## Phase 1: Extend Shared Types

- [x] In `src/shared/types.ts`, verify `CustomFieldDefinition.type` includes `'file'` — it already does. Confirm `allowedMimeTypes`, `maxFileSize`, and `maxFiles` fields are present on `CustomFieldDefinition` — they already are. **No change needed to the type definition itself.**

- [x] Add `FileFieldValue` type to `src/shared/types.ts`:
  ```typescript
  export interface FileFieldValue {
    fileId: string   // references FileRecord.id; used to fetch envelopes + content
  }
  ```
  This is the only value stored in `NotePayload.fields` for a file custom field. The key, metadata, and ciphertext are all stored separately via the existing FileRecord/FileKeyEnvelope model.

- [x] Extend `FileRecord` in `src/shared/types.ts` to add optional context binding:
  ```typescript
  contextType?: 'conversation' | 'note' | 'report' | 'custom_field'
  contextId?: string   // noteId or reportId; set after parent record is saved
  ```

- [x] Extend `UploadInit` in `src/shared/types.ts` to accept the same optional context fields:
  ```typescript
  contextType?: 'conversation' | 'note' | 'report' | 'custom_field'
  contextId?: string
  ```

- [x] Update `NotePayload.fields` type to allow `FileFieldValue` as a possible value:
  ```typescript
  export interface NotePayload {
    text: string
    fields?: Record<string, string | number | boolean | FileFieldValue>
  }
  ```

---

## Phase 2: New Upload Context Binding Endpoint

### 2.1 PATCH /api/uploads/:id/context
- [x] Add to `src/worker/routes/uploads.ts`:
  ```
  PATCH /api/uploads/:id/context
  Body: { contextId: string, contextType: 'note' | 'report' | 'custom_field' }
  ```
  - Auth: uploader only (owner check against `fileRecord.uploadedBy`)
  - Validates the file is in `status: 'complete'` before binding
  - Updates `contextId` and `contextType` on the `FileRecord` in ConversationDO
  - Returns `{ ok: true }`
  - Audit log: `fileContextBound` event with `{ fileId, contextType, contextId }`

  **No other new upload endpoints needed** — `POST /api/uploads/init`, `PUT /api/uploads/:id/chunks/:n`, and `POST /api/uploads/:id/complete` already exist and work as-is.

---

## Phase 3: Client-Side File Crypto

### 3.1 Verify existing file-crypto.ts
- [x] Confirm `src/worker/lib/file-crypto.ts` (or `src/client/lib/file-crypto.ts`) exports:
  - `generateFileKey(): Uint8Array` — random 32-byte key
  - `encryptFile(key, buffer): EncryptedFile` — XChaCha20-Poly1305
  - `decryptFile(key, encrypted): Uint8Array` — XChaCha20-Poly1305

  If a client-side variant does not exist, create `src/client/lib/file-crypto.ts` with the above functions using `xchacha20poly1305` from `@noble/ciphers/chacha.js` (consistent with note and message encryption). **Do NOT use WebCrypto AES-GCM** — the codebase uses noble/ciphers throughout.

### 3.2 Envelope construction for custom field uploads
- [x] Create `src/client/lib/file-upload.ts` (or extend existing upload helper) to wrap the upload flow for custom field files:
  - `generateFileKey()` → 32-byte random key
  - Encrypt file bytes → ciphertext
  - ECIES wrap fileKey for volunteer + each admin → `FileKeyEnvelope[]` using `LABEL_FILE_KEY`
  - ECIES wrap metadata (`EncryptedFileMetadata`: originalName, mimeType, size, checksum) for volunteer + each admin using `LABEL_FILE_METADATA`
  - `POST /api/uploads/init` with `contextType: 'custom_field'`, `recipientEnvelopes`, `encryptedMetadata`
  - Stream ciphertext chunks via `PUT /api/uploads/:id/chunks/:n`
  - `POST /api/uploads/:id/complete` → get `fileId`
  - Return `{ fileId }` as the `FileFieldValue` to store in the form state
  - After note save: `PATCH /api/uploads/:fileId/context` with `{ contextId: noteId, contextType: 'custom_field' }`

### 3.3 File download helper
- [x] Create or extend download helper in `src/client/lib/file-upload.ts`:
  - `GET /api/files/:fileId/envelopes` → get caller's `FileKeyEnvelope`
  - ECIES unwrap `encryptedFileKey` with caller's private key using `LABEL_FILE_KEY` → `fileKey`
  - `GET /api/files/:fileId/metadata` → get caller's `encryptedMetadata` entry
  - ECIES unwrap metadata with caller's private key using `LABEL_FILE_METADATA` → `EncryptedFileMetadata`
  - `GET /api/files/:fileId/content` → fetch ciphertext stream
  - `decryptFile(fileKey, ciphertext)` → plaintext bytes
  - Return `{ plaintext: Uint8Array, metadata: EncryptedFileMetadata }`

---

## Phase 4: Frontend — FileField Components

### 4.1 FileFieldInput component
- [x] Create `src/client/components/custom-fields/file-field-input.tsx`:
  - File dropzone or file input button
  - Preview: show filename, size, file type icon (from `EncryptedFileMetadata` after upload)
  - On file select: encrypt and upload via the helper from Phase 3.2; show progress bar
  - Store `FileFieldValue { fileId }` in form state on upload complete
  - Remove button: marks the field as empty (does not delete the file record — note may not be saved yet)
  - Validation: MIME type against `allowedMimeTypes`, file size against `maxFileSize` (client-side before upload)
  - Single file per field instance (multiple fields possible in the same form)

### 4.2 FileFieldDisplay component
- [x] Create `src/client/components/custom-fields/file-field-display.tsx`:
  - Reads `FileFieldValue { fileId }` from decrypted note fields
  - On mount: fetch metadata (via download helper) to display filename, size, file type icon
  - Download button: full download flow (Phase 3.3) → create blob URL → trigger browser download
  - Image previews: if `mimeType` starts with `image/`, show thumbnail (decrypt in memory, display via blob URL)
  - Shows "File unavailable" if envelopes fetch returns 403 or decryption fails

### 4.3 Register in custom field renderer
- [x] In `src/client/components/custom-fields/custom-field-input.tsx` (or equivalent input renderer):
  - Add `case 'file': return <FileFieldInput definition={field} value={value} onChange={onChange} />`
- [x] In `src/client/components/custom-fields/custom-field-display.tsx` (or equivalent display renderer):
  - Add `case 'file': return <FileFieldDisplay definition={field} value={value} />`

---

## Phase 5: Admin — Field Definition UI

- [x] In custom field definition form, confirm `file` appears in type dropdown (type already exists in `CustomFieldDefinition`)
- [x] When type = `file`, show additional options:
  - Allowed MIME types (multi-select with common presets: Images, PDFs, Audio, Any)
  - Max file size (number input + MB/KB selector, default 10 MB, max 100 MB)
  - Note: `maxFiles` is already in the type but keep it fixed to 1 for now (multi-file is a non-goal)

---

## Phase 6: i18n

- [x] Add to all 13 locale files (`src/client/locales/*.json`):
  - `customFields.file.upload`
  - `customFields.file.uploading`
  - `customFields.file.download`
  - `customFields.file.remove`
  - `customFields.file.tooLarge` (with `{{max}}` placeholder)
  - `customFields.file.invalidType`
  - `customFields.file.unavailable`

---

## Phase 7: Tests

- [x] Upload a file via file custom field → verify R2 has only ciphertext (no plaintext); verify `file_records` row has `recipientEnvelopes` and `encryptedMetadata` (not a raw key)
- [x] File appears in note display after save (FileFieldDisplay shows filename and download button)
- [x] Download button fetches envelopes, unwraps key, decrypts and downloads file correctly
- [x] Admin viewing the same note can also download (admin has their own `FileKeyEnvelope`)
- [x] Volunteer B cannot access volunteer A's file (403 on `/api/files/:id/envelopes`)
- [x] File exceeding `maxFileSize` (field config) shows client-side error before upload
- [x] File with disallowed MIME shows client-side error before upload
- [x] Note with file custom field round-trips correctly: save → reload → decrypt note → fetch envelopes → decrypt file → download

---

## Completion Checklist

- [x] `FileFieldValue` type defined in `src/shared/types.ts`
- [x] `FileRecord` and `UploadInit` extended with `contextType`/`contextId`
- [x] `PATCH /api/uploads/:id/context` endpoint added to `src/worker/routes/uploads.ts`
- [x] Client-side file encrypt/decrypt using XChaCha20-Poly1305 (`@noble/ciphers/chacha.js`)
- [x] ECIES key wrapping uses `LABEL_FILE_KEY` for file key, `LABEL_FILE_METADATA` for metadata
- [x] File key stored as `FileKeyEnvelope` server-side — never inside the note payload
- [x] `FileFieldInput` and `FileFieldDisplay` components implemented
- [x] Admin field definition supports MIME type + size constraints
- [x] i18n keys in all 13 locales
- [x] `bun run typecheck` passes
- [x] `bun run build` passes
- [x] E2E tests pass
