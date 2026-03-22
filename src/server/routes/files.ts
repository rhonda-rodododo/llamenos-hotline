import { Hono } from 'hono'
import type { EncryptedMetaItem, FileKeyEnvelope } from '../../shared/types'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const files = new Hono<AppEnv>()

// Download encrypted file content
files.get('/:id/content', requirePermission('files:download-own'), async (c) => {
  const fileId = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')

  if (!services.files.hasBlob) {
    return c.json({ error: 'File storage not configured' }, 503)
  }

  const record = await services.files.getFileRecord(fileId)
  if (!record) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canDownloadAll = checkPermission(permissions, 'files:download-all')
  const isRecipient = record.recipientEnvelopes.some((e) => e.pubkey === pubkey)

  if (!canDownloadAll && !isRecipient) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const obj = await services.files.getAssembled(fileId)
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
files.get('/:id/envelopes', requirePermission('files:download-own'), async (c) => {
  const fileId = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')

  const record = await services.files.getFileRecord(fileId)
  if (!record) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canDownloadAll = checkPermission(permissions, 'files:download-all')
  const isRecipient = record.recipientEnvelopes.some((e) => e.pubkey === pubkey)

  if (!canDownloadAll && !isRecipient) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json(record.recipientEnvelopes)
})

// Get encrypted file metadata
files.get('/:id/metadata', requirePermission('files:download-own'), async (c) => {
  const fileId = c.req.param('id')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')

  const record = await services.files.getFileRecord(fileId)
  if (!record) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canDownloadAll = checkPermission(permissions, 'files:download-all')
  const isRecipient = record.recipientEnvelopes.some((e) => e.pubkey === pubkey)

  if (!canDownloadAll && !isRecipient) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json(record.encryptedMetadata)
})

// Share file with a new recipient
files.post('/:id/share', requirePermission('files:share'), async (c) => {
  const fileId = c.req.param('id')
  const pubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const services = c.get('services')

  const body = (await c.req.json()) as {
    envelope: FileKeyEnvelope
    encryptedMetadata: EncryptedMetaItem
  }

  if (
    !body.envelope?.pubkey ||
    !body.envelope?.encryptedFileKey ||
    !body.envelope?.ephemeralPubkey
  ) {
    return c.json({ error: 'Invalid envelope' }, 400)
  }

  if (!body.encryptedMetadata?.pubkey || !body.encryptedMetadata?.encryptedContent) {
    return c.json({ error: 'Invalid encryptedMetadata' }, 400)
  }

  const record = await services.files.getFileRecord(fileId)
  if (!record) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canDownloadAll = checkPermission(permissions, 'files:download-all')
  const isUploader = record.uploadedBy === pubkey

  if (!canDownloadAll && !isUploader) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await services.files.addRecipientEnvelope(fileId, body.envelope, body.encryptedMetadata)

  await services.records.addAuditEntry(hubId ?? 'global', 'fileShared', pubkey, {
    fileId,
    sharedWith: body.envelope.pubkey,
  })

  return c.json({ success: true })
})

export default files
