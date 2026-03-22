# File Field Type for Custom Fields — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Problem

Custom fields currently support: text, number, select, checkbox, textarea. There is no way to attach a file (image, PDF, document) to a note or report through the custom field system. Volunteers cannot upload evidence, medical forms, or supporting documents alongside their structured notes. The `file_records` table and MinIO/R2 storage infrastructure exist and are used by the messaging system, but are not connected to the custom field layer.

## Goals

1. Add `file` as a custom field type usable in notes and reports.
2. Maintain zero-knowledge: the server must never see file plaintext. Files are encrypted client-side before upload.
3. Use the same encryption primitives as the rest of the codebase (XChaCha20-Poly1305 + ECIES, `@noble/ciphers`).
4. Admin can constrain field to specific MIME types and maximum file sizes.
5. Files are accessible to the note author and all admins (same multi-envelope pattern as notes and messages).

## Non-Goals

- Multi-file upload in a single field instance (single file per field; a form can have multiple file fields).
- Virus scanning (out of scope; files are ciphertext on server anyway).
- Image editing or annotation.

## Security Model

File encryption follows the same pattern as message attachments — the existing system in `src/worker/lib/file-crypto.ts`:

```
Random 32-byte fileKey
  → XChaCha20-Poly1305 encrypt(file bytes, fileKey) → ciphertext
  → ECIES wrap(fileKey, authorPubkey)  → FileKeyEnvelope  [domain: llamenos:file-key]
  → ECIES wrap(fileKey, adminPubkey)   → FileKeyEnvelope[] [domain: llamenos:file-key]
  → ECIES wrap(metadata, authorPubkey) → encryptedMetadata [domain: llamenos:file-metadata]
  → ECIES wrap(metadata, adminPubkey)  → encryptedMetadata[] [domain: llamenos:file-metadata]
```

The `fileKey` is never transmitted in plaintext. It is stored server-side as ECIES-wrapped `FileKeyEnvelope` records, one per authorized recipient (uploader + each admin). The ciphertext is stored in MinIO/R2. File metadata (filename, mimeType, size) is separately ECIES-wrapped with `LABEL_FILE_METADATA` and stored in `encryptedMetadata`.

**Key design:** The file custom field value stores only a `fileId` reference. The file's key envelopes follow the existing `FileKeyEnvelope` model in `src/shared/types.ts` and are stored server-side alongside the `FileRecord`. When a recipient downloads a file, they call `GET /api/files/:id/envelopes` to retrieve their `FileKeyEnvelope`, unwrap the file key with their private key, then use that key to decrypt the ciphertext fetched from `GET /api/files/:id/content`. This allows admins to decrypt any file independently of the parent note, and allows file access without needing to first decrypt the parent note.

## Data Model

### CustomFieldDefinition — extend existing type

The existing `CustomFieldDefinition` type in `src/shared/types.ts` already includes `'file'` in the type union. The `allowedMimeTypes`, `maxFileSize`, and `maxFiles` fields are also already present. No type changes needed for the definition itself — the implementation must wire up the field rendering and upload logic.

```typescript
// Existing type in src/shared/types.ts (no change needed):
interface CustomFieldDefinition {
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'file'
  // File field options (already present):
  allowedMimeTypes?: string[]   // e.g. ['image/*', 'application/pdf']; empty = all allowed
  maxFileSize?: number          // bytes; default: discuss below
  maxFiles?: number             // default: 1 (single file per field)
  // ...other fields
}
```

### File size limit

The existing upload system enforces `MAX_UPLOAD_SIZE = 100 MB` and `MAX_CHUNK_SIZE = 10 MB` in `src/worker/routes/uploads.ts`. For custom field files, admins may configure a per-field `maxFileSize` (recommended default: 10 MB, i.e. `10_485_760` bytes) — this is enforced client-side before upload and server-side at `POST /api/uploads/init`. The global 100 MB server limit still applies as an absolute ceiling.

### Custom field value type

```typescript
// Stored inside the note's encrypted NotePayload.fields:
interface FileFieldValue {
  fileId: string    // references the FileRecord; used to fetch envelopes and ciphertext
}
```

The `fileId` is the only thing stored in the note's encrypted payload for a file custom field. The file key, metadata, and ciphertext are all retrieved separately via the file API using the existing envelope model.

### FileRecord — extend existing type

The existing `FileRecord` in `src/shared/types.ts` uses `conversationId` as its binding context. To support custom field files (which belong to notes/reports, not conversations), extend `FileRecord` and `UploadInit` with an optional `contextType` discriminator:

```typescript
// Extended FileRecord (src/shared/types.ts):
export interface FileRecord {
  id: string
  conversationId: string           // required by existing system; pass hubId or '' for custom_field context
  contextType?: 'conversation' | 'note' | 'report' | 'custom_field'  // new optional field
  contextId?: string               // noteId or reportId; set after the parent record is saved
  messageId?: string               // existing field for message attachments
  uploadedBy: string               // pubkey of uploader
  recipientEnvelopes: FileKeyEnvelope[]
  encryptedMetadata: Array<{
    pubkey: string
    encryptedContent: string
    ephemeralPubkey: string
  }>
  totalSize: number
  totalChunks: number
  status: 'uploading' | 'complete' | 'failed'
  completedChunks: number
  createdAt: string
  completedAt?: string
}
```

Similarly extend `UploadInit` to accept the optional context fields.

## Upload Flow

The upload uses the **existing chunked upload API** — no new upload endpoints are needed:

```
1. Volunteer selects file in custom field input
2. Client: generateFileKey() → random 32 bytes (via existing file-crypto.ts)
3. Client: XChaCha20-Poly1305 encrypt(fileBytes, fileKey) → ciphertext (LABEL_FILE_KEY)
4. Client: ECIES wrap(fileKey, volunteerPubkey) → FileKeyEnvelope (LABEL_FILE_KEY)
5. Client: ECIES wrap(fileKey, adminPubkey) × N → FileKeyEnvelope[] (LABEL_FILE_KEY)
6. Client: ECIES wrap(metadata, volunteerPubkey) → encryptedMetadata entry (LABEL_FILE_METADATA)
7. Client: ECIES wrap(metadata, adminPubkey) × N → encryptedMetadata[] (LABEL_FILE_METADATA)
8. Client: POST /api/uploads/init { totalSize, totalChunks, conversationId: hubId,
     contextType: 'custom_field', recipientEnvelopes, encryptedMetadata }
9. Server: create FileRecord (status: 'uploading'), return { uploadId }
10. Client: PUT /api/uploads/:uploadId/chunks/:n (one or more chunks of ciphertext)
11. Client: POST /api/uploads/:uploadId/complete → { fileId, status: 'complete' }
12. Client: store { fileId } in note form state for the file custom field value
13. On note save: { fileId } is embedded in NotePayload.fields as the field value
```

After the parent note is saved and its ID is known:
```
14. Client: PATCH /api/uploads/:fileId/context { contextId: noteId, contextType: 'custom_field' }
    (new lightweight endpoint to bind the fileId to the noteId after note creation)
```

## Download Flow

Uses the **existing file download API**:

```
1. Volunteer opens note, NotePayload decrypts → recovers fileId for each file field
2. Volunteer clicks download button
3. Client: GET /api/files/:fileId/envelopes → returns FileKeyEnvelope for the requesting user
4. Client: ECIES unwrap(envelope.encryptedFileKey, myPrivKey, LABEL_FILE_KEY) → fileKey
5. Client: GET /api/files/:fileId/metadata → returns encryptedMetadata entry for the requesting user
6. Client: ECIES unwrap(metadata.encryptedContent, myPrivKey, LABEL_FILE_METADATA) → { filename, mimeType, size, ... }
7. Client: GET /api/files/:fileId/content → streams ciphertext bytes from R2
8. Client: XChaCha20-Poly1305 decrypt(ciphertext, fileKey) → plaintext bytes
9. Client: blob URL → browser download / image preview
```

Admins use the same flow — they have their own `FileKeyEnvelope` in `recipientEnvelopes`, so they can decrypt any file without the parent note.

## API Surface

All upload paths reuse the existing upload API. The download and envelope paths already exist in `src/worker/routes/files.ts`. One new endpoint is needed:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/uploads/init` | volunteer+ | **Existing.** Initialize chunked upload; pass `contextType: 'custom_field'` |
| PUT | `/api/uploads/:id/chunks/:n` | volunteer+ | **Existing.** Upload a ciphertext chunk |
| POST | `/api/uploads/:id/complete` | volunteer+ | **Existing.** Assemble chunks, mark complete |
| GET | `/api/uploads/:id/status` | owner or admin | **Existing.** Resume support |
| GET | `/api/files/:id/content` | owner or admin | **Existing.** Stream ciphertext from R2 |
| GET | `/api/files/:id/envelopes` | owner or admin | **Existing.** Return FileKeyEnvelope for requester |
| GET | `/api/files/:id/metadata` | owner or admin | **Existing.** Return encryptedMetadata for requester |
| POST | `/api/files/:id/share` | admin | **Existing.** Add a new recipient envelope |
| PATCH | `/api/uploads/:id/context` | owner | **New.** Bind file to noteId/reportId after parent save |

The `PATCH /api/uploads/:id/context` endpoint sets `contextId` and `contextType` on the `FileRecord` after the parent note is created, completing the relationship.

## Domain Separation

Two existing labels from `src/shared/crypto-labels.ts` are used:

- `LABEL_FILE_KEY = 'llamenos:file-key'` — for ECIES wrapping the symmetric file encryption key
- `LABEL_FILE_METADATA = 'llamenos:file-metadata'` — for ECIES wrapping encrypted file metadata (filename, mimeType, size, checksum)

Both labels are already defined and used in the existing messaging attachment system. Never use raw string literals.

## Admin Field Configuration UI

Admins configure file fields in the custom field definition form:
- MIME type allowlist (multi-select with presets: Images, PDFs, Audio, Any)
- Max file size (number + unit selector, default 10 MB; absolute ceiling is 100 MB per server config)

## Error States

| Scenario | Behaviour |
|----------|-----------|
| File exceeds field's `maxFileSize` | Client-side rejection before upload; error message with limit |
| File exceeds server's 100 MB ceiling | Server returns 400; client shows error |
| MIME type not allowed | Client-side rejection; error message listing allowed types |
| Upload fails mid-chunk | Show retry button; upload is resumable via `/api/uploads/:id/status` |
| Note cannot save until all uploads succeed | Note save blocked if any file field is in `uploading` state |
| Decryption fails (envelope not found for user) | Show "File unavailable" placeholder; log error |
| MinIO unavailable | Upload blocked; note cannot be saved with pending file |

## Testing

- Upload a file via file custom field → verify DB has no plaintext file content (ciphertext only in R2)
- Admin can download and decrypt the same file as the volunteer who uploaded (admin has own envelope)
- Unauthorized volunteer cannot access another volunteer's file envelopes or content (403)
- File size limit enforced client-side and server-side
- Note with file custom field round-trips correctly: save → reload → fetch envelopes → decrypt → download
- `GET /api/files/:id/envelopes` returns only the requesting user's envelope (not all envelopes) for non-admins
