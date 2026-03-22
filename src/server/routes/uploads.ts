import { Hono } from 'hono'
import type { UploadInit } from '../../shared/types'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024 // 100 MB
const MAX_CHUNK_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_CHUNKS = 10000

const uploads = new Hono<AppEnv>()
uploads.use('*', requirePermission('files:upload'))

// Initialize an upload — creates a file record and returns uploadId
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

// Upload a chunk
uploads.put('/:id/chunks/:chunkIndex', async (c) => {
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')
  const uploadId = c.req.param('id')
  const chunkIndex = Number.parseInt(c.req.param('chunkIndex'), 10)

  if (Number.isNaN(chunkIndex) || chunkIndex < 0) {
    return c.json({ error: 'Invalid chunk index' }, 400)
  }

  const record = await services.files.getFileRecord(uploadId)
  if (!record) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  if (record.uploadedBy !== pubkey && !checkPermission(permissions, 'files:download-all')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (chunkIndex >= record.totalChunks) {
    return c.json({ error: `Chunk index out of range (total: ${record.totalChunks})` }, 400)
  }

  const body = await c.req.arrayBuffer()
  if (!body || body.byteLength === 0) {
    return c.json({ error: 'Empty chunk' }, 400)
  }

  if (body.byteLength > MAX_CHUNK_SIZE) {
    return c.json({ error: `Chunk too large (max ${MAX_CHUNK_SIZE / 1024 / 1024}MB)` }, 400)
  }

  await services.files.putChunk(uploadId, chunkIndex, body)
  const { completedChunks, totalChunks } = await services.files.incrementChunk(uploadId)

  return c.json({ chunkIndex, completedChunks, totalChunks })
})

// Complete an upload — assembles chunks
uploads.post('/:id/complete', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const uploadId = c.req.param('id')

  const record = await services.files.getFileRecord(uploadId)
  if (!record) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  if (record.uploadedBy !== pubkey && !checkPermission(permissions, 'files:download-all')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (record.completedChunks < record.totalChunks) {
    return c.json(
      {
        error: 'Not all chunks uploaded',
        completedChunks: record.completedChunks,
        totalChunks: record.totalChunks,
      },
      400,
    )
  }

  // Assemble chunks into a single buffer
  const chunkArrays: Uint8Array[] = []
  for (let i = 0; i < record.totalChunks; i++) {
    const chunkData = await services.files.getChunk(uploadId, i)
    if (!chunkData) {
      await services.files.failUpload(uploadId)
      return c.json({ error: `Missing chunk ${i}` }, 500)
    }
    chunkArrays.push(new Uint8Array(chunkData))
  }

  const totalLen = chunkArrays.reduce((s, chunk) => s + chunk.length, 0)
  const assembled = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunkArrays) {
    assembled.set(chunk, offset)
    offset += chunk.length
  }

  // Store assembled content
  await services.files.putAssembled(uploadId, assembled)

  // Write blob copies of envelopes and metadata for backward compat
  await services.files.storeEnvelopesBlob(uploadId, record.recipientEnvelopes)
  await services.files.storeMetadataBlob(uploadId, record.encryptedMetadata)

  // Mark DB record as complete FIRST — chunks remain in blob storage and are
  // recoverable if this DB call fails. Never destroy source data before committing.
  await services.files.completeUpload(uploadId)

  // Delete individual chunks only after the record is durably marked complete
  await services.files.deleteAllChunks(uploadId, record.totalChunks)

  await services.records.addAuditEntry(hubId ?? 'global', 'fileUploadCompleted', pubkey, {
    uploadId,
  })

  return c.json({ fileId: uploadId, status: 'complete' })
})

// Get upload status (for resume)
uploads.get('/:id/status', async (c) => {
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const services = c.get('services')
  const uploadId = c.req.param('id')

  const record = await services.files.getFileRecord(uploadId)
  if (!record) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  // Only allow the uploader or users with download-all to check status
  if (record.uploadedBy !== pubkey && !checkPermission(permissions, 'files:download-all')) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  return c.json({
    uploadId: record.id,
    status: record.status,
    completedChunks: record.completedChunks,
    totalChunks: record.totalChunks,
    totalSize: record.totalSize,
  })
})

export default uploads
