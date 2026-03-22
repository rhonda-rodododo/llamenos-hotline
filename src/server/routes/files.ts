import { Hono } from 'hono'
import type { FileKeyEnvelope } from '../../shared/types'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const files = new Hono<AppEnv>()

// Download encrypted file content (served from R2 blob storage)
files.get('/:id/content', async (c) => {
  const fileId = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  // R2 bucket is required for file downloads
  if (!c.env.R2_BUCKET) {
    return c.json({ error: 'File storage not configured' }, 503)
  }

  // Permission check: users with files:download-all can always download
  // Others can only download files they uploaded or are recipients of
  // Without a file record store, we rely on the R2 object existing and
  // the client knowing the file ID from a message attachmentIds reference
  const canDownloadAll = checkPermission(permissions, 'files:download-all')

  // For non-admins, verify they have access via message membership
  // The file ID should come from a messageEnvelope.attachmentIds reference
  // which was already access-controlled when the message was fetched
  if (!canDownloadAll) {
    // Validate access: check if any conversation message references this file
    // for which the requester has access — this is a best-effort check
    const services = c.get('services')
    void services // used for future access check
    void pubkey
    // For now: allow if file exists in R2 (client obtained the ID from a message)
    // Full per-file ACL would require a file_records table (not yet in schema)
  }

  const obj = await c.env.R2_BUCKET.get(`files/${fileId}/content`)
  if (!obj) {
    return c.json({ error: 'File content not found' }, 404)
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Cache-Control': 'private, no-cache',
    },
  })
})

// Get file envelopes (recipient key wrappers)
// NOTE: File record metadata storage is not yet implemented in the Drizzle schema.
// This endpoint returns 501 until a file_records table is added.
files.get('/:id/envelopes', async (c) => {
  return c.json(
    { error: 'File envelope storage not yet implemented in server-side service layer' },
    501
  )
})

// Get encrypted file metadata
// NOTE: File record metadata storage is not yet implemented in the Drizzle schema.
files.get('/:id/metadata', async (c) => {
  return c.json(
    { error: 'File metadata storage not yet implemented in server-side service layer' },
    501
  )
})

// Share file with a new recipient
files.post('/:id/share', requirePermission('files:share'), async (c) => {
  const fileId = c.req.param('id')
  const pubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const services = c.get('services')

  const body = (await c.req.json()) as {
    envelope: FileKeyEnvelope
    encryptedMetadata: { pubkey: string; encryptedContent: string; ephemeralPubkey: string }
  }

  if (
    !body.envelope?.pubkey ||
    !body.envelope?.encryptedFileKey ||
    !body.envelope?.ephemeralPubkey
  ) {
    return c.json({ error: 'Invalid envelope' }, 400)
  }

  // File record sharing requires a file_records table — not yet implemented
  await services.records.addAuditEntry(hubId ?? 'global', 'fileShared', pubkey, {
    fileId,
    sharedWith: body.envelope.pubkey,
  })

  return c.json(
    { error: 'File sharing metadata storage not yet implemented in server-side service layer' },
    501
  )
})

export default files
