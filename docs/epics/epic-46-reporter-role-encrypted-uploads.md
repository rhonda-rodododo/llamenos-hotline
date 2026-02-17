# Epic 46: Reporter Role & Encrypted File Uploads

## Problem

The hotline needs a way for trusted community members, field workers, or partner organizations to submit reports — incident documentation, evidence, field observations — that may include large media files (photos, video, audio recordings). These reports must be encrypted end-to-end and support threaded conversations so admins/assigned volunteers can ask follow-up questions. The current system only has two roles (admin, volunteer) and no file upload capability.

## Threat Model Considerations

**Reporter identity protection:**
- Reporters are identified to admins only (same model as volunteers). Other volunteers and reporters cannot see each other's identities.
- Reporter accounts use the same Nostr keypair + WebAuthn auth as volunteers.
- Reporter invite codes are role-specific (`role: 'reporter'`).

**Encrypted file uploads — zero-knowledge storage:**
- All files are encrypted client-side before upload. The server never sees plaintext file content.
- Encryption uses ECIES: ephemeral ECDH on secp256k1 + XChaCha20-Poly1305 (same scheme as notes/transcriptions).
- Each file is dual-encrypted: one copy for the reporter, one for the admin. When a volunteer is assigned, a third copy can be re-encrypted for them by the admin.
- File metadata (name, type, size) is encrypted alongside the content.
- Cloudflare R2 stores only opaque encrypted blobs. R2 bucket access is restricted to the Worker.

**Large file handling:**
- Files are chunked client-side (e.g., 5MB chunks), each chunk independently encrypted.
- Chunked upload supports resumability — interrupted uploads can continue from the last successful chunk.
- No file size limit enforced by the application (R2 supports objects up to 5TB, multipart upload for >5GB).
- Server-side: chunks are reassembled into a single R2 object after upload completes.

**Metadata minimization:**
- R2 object keys are random UUIDs, not derived from file names or content.
- File metadata (original filename, MIME type, dimensions) is encrypted in a separate metadata blob, not stored in R2 object metadata.
- Upload timestamps are the only unencrypted metadata (needed for audit logging).

## Solution

### 1. Reporter Role

Extend the role system to support `'reporter'`:

```typescript
// worker/types.ts
interface Volunteer {
  role: 'volunteer' | 'admin' | 'reporter'
  // ... existing fields
}
```

**Reporter capabilities:**
- Submit reports (create conversations with `type: 'report'`)
- View and reply to their own report threads
- Upload encrypted file attachments to their reports
- See their own reports and conversation history
- Update their own profile

**Reporter cannot:**
- See other reporters' reports
- See any volunteer information
- See call records, notes, shifts, settings, or audit logs
- Answer phone calls or claim conversations from other channels

**Reporter-specific UI:**
- Simplified dashboard: list of their submitted reports + "New Report" button
- Report submission form with custom fields (admin-defined) + file upload
- Conversation thread for each report

### 2. Invite Flow

Extend existing invite code system:

```typescript
interface InviteCode {
  code: string
  role: 'volunteer' | 'reporter'  // admin is always bootstrapped, not invited
  createdBy: string  // admin pubkey
  createdAt: string
  usedBy?: string
  usedAt?: string
  expiresAt?: string
  maxUses?: number
  currentUses?: number
}
```

Admin creates reporter invite codes from the volunteer management UI (new "Reporters" tab).

### 3. Report Submission

Reports use the `Conversation` type from Epic 42 with `metadata.type: 'report'`:

```typescript
interface ReportConversation extends Conversation {
  channelType: 'web'  // reports are always web-based
  metadata: {
    type: 'report'
    reportTitle: string         // encrypted
    reportCategory?: string     // admin-defined categories
    customFieldValues: string   // encrypted JSON of custom field values
  }
}
```

**Custom fields for reports:**
Extend `CustomFieldDefinition` with a `context` field:

```typescript
interface CustomFieldDefinition {
  // ... existing fields
  context: 'call-notes' | 'reports' | 'both'  // where this field appears
  allowFileUpload?: boolean  // this field accepts file attachments
  acceptedFileTypes?: string[] // e.g., ['image/*', 'video/*', 'application/pdf']
}
```

Admins can configure which custom fields appear on the report form vs. call notes vs. both.

### 4. Encrypted File Upload System

#### Client-Side Encryption

```typescript
// src/client/lib/file-crypto.ts

interface EncryptedFileMetadata {
  originalName: string
  mimeType: string
  size: number
  dimensions?: { width: number; height: number }  // for images/video
  duration?: number  // for audio/video
  checksum: string   // SHA-256 of plaintext for integrity verification after decryption
}

async function encryptFile(
  file: File,
  recipientPubkeys: string[],  // [reporter, admin] or [reporter, admin, assignedVolunteer]
): Promise<EncryptedFileUpload> {
  const plaintextBytes = new Uint8Array(await file.arrayBuffer())

  // Encrypt metadata
  const metadata: EncryptedFileMetadata = {
    originalName: file.name,
    mimeType: file.type,
    size: file.size,
    checksum: hex(await crypto.subtle.digest('SHA-256', plaintextBytes)),
  }

  // For each recipient, create an ECIES envelope for the symmetric file key
  // (encrypt the file once with a random symmetric key, then wrap that key for each recipient)
  const fileKey = randomBytes(32)
  const fileNonce = randomBytes(24)
  const encryptedContent = xchacha20poly1305(fileKey, fileNonce).encrypt(plaintextBytes)

  const recipientEnvelopes = await Promise.all(
    recipientPubkeys.map(pubkey => encryptFileKey(fileKey, pubkey))
  )

  const encryptedMetadata = await Promise.all(
    recipientPubkeys.map(pubkey =>
      encryptForPublicKey(JSON.stringify(metadata), pubkey)
    )
  )

  return {
    encryptedContent: concat(fileNonce, encryptedContent),
    recipientEnvelopes,  // each: { pubkey, encryptedFileKey, ephemeralPubkey }
    encryptedMetadata,   // each: { pubkey, encryptedContent, ephemeralPubkey }
  }
}
```

**Key wrapping approach:** Instead of encrypting the entire file N times (once per recipient), encrypt it once with a random symmetric key, then ECIES-wrap the symmetric key for each recipient. This is critical for large files — a 1GB video is encrypted once, with only the 32-byte key wrapped per recipient.

#### Chunked Upload

For files larger than a configurable threshold (default: 10MB):

```
Client                              Server                          R2
  |                                    |                              |
  |  POST /api/uploads/init            |                              |
  |  { totalSize, totalChunks,         |                              |
  |    recipientEnvelopes,             |                              |
  |    encryptedMetadata }             |                              |
  |  ←— { uploadId, presignedChunkUrls } ——                          |
  |                                    |                              |
  |  PUT /chunk/0  [encrypted bytes]   | ——→  PUT chunk to R2         |
  |  PUT /chunk/1  [encrypted bytes]   | ——→  PUT chunk to R2         |
  |  ...                               |                              |
  |  PUT /chunk/N  [encrypted bytes]   | ——→  PUT chunk to R2         |
  |                                    |                              |
  |  POST /api/uploads/:id/complete    |                              |
  |                                    | ——→  R2 multipart complete   |
  |  ←— { fileId, status: 'complete' } |                              |
```

**Resumability:** If upload is interrupted, client calls `GET /api/uploads/:id/status` to learn which chunks were received, then resumes from the next chunk.

#### R2 Storage Structure

```
r2-bucket/
  files/
    {fileId}/
      content       — encrypted file content (single object or multipart)
      envelopes     — JSON: recipient key envelopes
      metadata      — JSON: per-recipient encrypted metadata blobs
```

#### Download and Decryption

```typescript
async function decryptFile(
  encryptedContent: Uint8Array,
  envelope: { encryptedFileKey: string; ephemeralPubkey: string },
  encryptedMetadata: { encryptedContent: string; ephemeralPubkey: string },
  secretKey: string,
): Promise<{ file: Blob; metadata: EncryptedFileMetadata }> {
  // 1. Decrypt the symmetric file key using ECIES
  const fileKey = await decryptFileKey(envelope.encryptedFileKey, envelope.ephemeralPubkey, secretKey)

  // 2. Extract nonce and decrypt content
  const nonce = encryptedContent.slice(0, 24)
  const ciphertext = encryptedContent.slice(24)
  const plaintext = xchacha20poly1305(fileKey, nonce).decrypt(ciphertext)

  // 3. Decrypt metadata
  const metadata = JSON.parse(
    await decryptForSecretKey(encryptedMetadata.encryptedContent, encryptedMetadata.ephemeralPubkey, secretKey)
  )

  // 4. Verify integrity
  const checksum = hex(await crypto.subtle.digest('SHA-256', plaintext))
  if (checksum !== metadata.checksum) throw new Error('File integrity check failed')

  return {
    file: new Blob([plaintext], { type: metadata.mimeType }),
    metadata,
  }
}
```

### 5. Volunteer File Access via Re-encryption

When an admin assigns a volunteer to a report:
1. Admin's client decrypts the file's symmetric key using their ECIES envelope
2. Admin's client re-encrypts the symmetric key for the assigned volunteer's public key
3. Admin's client uploads the new envelope: `POST /api/files/:id/share` with `{ pubkey, encryptedFileKey, ephemeralPubkey }`
4. Volunteer can now download and decrypt the file

This is a **proxy re-encryption** pattern. The admin must be online to share files with volunteers. The file content is never re-uploaded — only the 32-byte symmetric key is re-wrapped.

### 6. Reporter Dashboard UI

New route: `/reports` (reporter-only, or admin to see all reports)

- **Report list:** cards showing report title (decrypted), status, date, reply count
- **New report form:** title field, custom fields (configured by admin), file upload dropzone, text body
- **Report thread:** conversation view with messages + file attachments inline (images rendered, other files as download links)
- **File upload progress:** chunk-by-chunk progress bar, resumable on failure

### 7. Admin Report Management

- **Reports tab** in admin dashboard: all reports, filterable by status/category/reporter
- **Assignment:** assign a volunteer to investigate/respond to a report
- **Status management:** open → investigating → resolved → closed
- **Re-encryption on assignment:** when assigning a volunteer, admin re-encrypts file keys for them

## Files

- **Create:** `src/client/lib/file-crypto.ts` — client-side file encryption/decryption
- **Create:** `src/client/lib/chunked-upload.ts` — chunked upload with resumability
- **Create:** `src/worker/routes/uploads.ts` — upload init, chunk, complete, status API
- **Create:** `src/worker/routes/files.ts` — file download, share (re-encryption envelope)
- **Create:** `src/worker/routes/reports.ts` — report-specific API routes
- **Create:** `src/client/routes/reports.tsx` — reporter dashboard page
- **Create:** `src/client/routes/reports.$id.tsx` — single report thread page
- **Create:** `src/client/components/ReportForm.tsx` — report submission form
- **Create:** `src/client/components/FileUpload.tsx` — encrypted file upload component
- **Create:** `src/client/components/FilePreview.tsx` — decrypted file preview (images, video, audio, PDF)
- **Create:** `src/client/components/UploadProgress.tsx` — chunk progress indicator
- **Modify:** `src/worker/types.ts` — extend Volunteer.role, add report types
- **Modify:** `src/shared/types.ts` — add CustomFieldDefinition.context, file upload types
- **Modify:** `src/worker/durable-objects/identity-do.ts` — reporter role support, invite code role
- **Modify:** `src/worker/middleware/auth.ts` — role-aware context (not just isAdmin boolean)
- **Modify:** `src/worker/middleware/admin-guard.ts` — support role-based guards (admin-only, admin-or-volunteer, etc.)
- **Modify:** `src/worker/durable-objects/settings-do.ts` — custom field context, report categories
- **Modify:** `src/worker/durable-objects/records-do.ts` — audit logging for report events
- **Modify:** `src/worker/app.ts` — mount report/upload/file routes
- **Modify:** `src/client/routes/__root.tsx` — conditional nav items based on role
- **Modify:** `wrangler.jsonc` — add R2 bucket binding

## Dependencies

- Epic 42 (Messaging Architecture — for conversation/thread model)

## Testing

- E2E: Admin creates reporter invite → reporter onboards → submits report with text + custom fields
- E2E: Reporter uploads file (small) → encrypted → stored in R2 → reporter can view
- E2E: Reporter uploads large file (>10MB) → chunked upload → resumable after simulated interruption
- E2E: Admin views report → decrypts content → assigns volunteer → re-encrypts file key for volunteer
- E2E: Volunteer opens assigned report → decrypts content + files → replies in thread
- E2E: Reporter sees volunteer reply in thread → responds
- E2E: Role enforcement: reporter cannot access call records, notes, settings, other reports
- E2E: File integrity check — downloaded file SHA-256 matches original
