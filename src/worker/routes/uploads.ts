import { Hono } from 'hono'
import type { UploadInit } from '../../shared/types'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024 // 100 MB
const MAX_CHUNK_SIZE = 10 * 1024 * 1024 // 10 MB

const uploads = new Hono<AppEnv>()
uploads.use('*', requirePermission('files:upload'))

// Initialize an upload — returns uploadId and chunk upload URLs
// NOTE: File record tracking (completedChunks etc.) is stored in R2 object metadata
// since the file_records table has not yet been added to the Drizzle schema.
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

  if (body.totalChunks > 10000) {
    return c.json({ error: 'Too many chunks (max 10000)' }, 400)
  }

  if (!c.env.R2_BUCKET) {
    return c.json({ error: 'File storage not configured' }, 503)
  }

  const uploadId = crypto.randomUUID()

  // Store upload manifest in R2 as a JSON object (no DB file_records table yet)
  const manifest = {
    id: uploadId,
    conversationId: body.conversationId,
    uploadedBy: pubkey,
    recipientEnvelopes: body.recipientEnvelopes || [],
    encryptedMetadata: body.encryptedMetadata || [],
    totalSize: body.totalSize,
    totalChunks: body.totalChunks,
    status: 'uploading',
    completedChunks: 0,
    createdAt: new Date().toISOString(),
  }

  await c.env.R2_BUCKET.put(`files/${uploadId}/manifest`, JSON.stringify(manifest))

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
  const uploadId = c.req.param('id')
  const chunkIndex = Number.parseInt(c.req.param('chunkIndex'), 10)

  if (Number.isNaN(chunkIndex) || chunkIndex < 0) {
    return c.json({ error: 'Invalid chunk index' }, 400)
  }

  if (!c.env.R2_BUCKET) {
    return c.json({ error: 'File storage not configured' }, 503)
  }

  // Verify ownership before accepting chunk
  const manifestObj = await c.env.R2_BUCKET.get(`files/${uploadId}/manifest`)
  if (!manifestObj) {
    return c.json({ error: 'Upload not found' }, 404)
  }
  const manifest = JSON.parse(new TextDecoder().decode(await manifestObj.arrayBuffer())) as {
    uploadedBy: string
    totalChunks: number
    completedChunks: number
  }
  if (manifest.uploadedBy !== pubkey && !checkPermission(permissions, 'files:download-all')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Store chunk directly in R2
  const body = await c.req.arrayBuffer()
  if (!body || body.byteLength === 0) {
    return c.json({ error: 'Empty chunk' }, 400)
  }

  if (body.byteLength > MAX_CHUNK_SIZE) {
    return c.json({ error: `Chunk too large (max ${MAX_CHUNK_SIZE / 1024 / 1024}MB)` }, 400)
  }

  const r2Key = `files/${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
  await c.env.R2_BUCKET.put(r2Key, body)

  // Update manifest with incremented chunk count
  const updatedManifest = { ...manifest, completedChunks: manifest.completedChunks + 1 }
  await c.env.R2_BUCKET.put(`files/${uploadId}/manifest`, JSON.stringify(updatedManifest))

  return c.json({
    chunkIndex,
    completedChunks: updatedManifest.completedChunks,
    totalChunks: manifest.totalChunks,
  })
})

// Complete an upload — assembles chunks
uploads.post('/:id/complete', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const uploadId = c.req.param('id')

  if (!c.env.R2_BUCKET) {
    return c.json({ error: 'File storage not configured' }, 503)
  }

  // Verify all chunks are uploaded
  const manifestObj = await c.env.R2_BUCKET.get(`files/${uploadId}/manifest`)
  if (!manifestObj) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  const manifest = JSON.parse(new TextDecoder().decode(await manifestObj.arrayBuffer())) as {
    uploadedBy: string
    totalChunks: number
    completedChunks: number
    recipientEnvelopes: unknown[]
    encryptedMetadata: unknown[]
  }

  if (manifest.uploadedBy !== pubkey && !checkPermission(permissions, 'files:download-all')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (manifest.completedChunks < manifest.totalChunks) {
    return c.json(
      {
        error: 'Not all chunks uploaded',
        completedChunks: manifest.completedChunks,
        totalChunks: manifest.totalChunks,
      },
      400
    )
  }

  // Concatenate chunks into a single R2 object
  const chunks: Uint8Array[] = []
  for (let i = 0; i < manifest.totalChunks; i++) {
    const r2Key = `files/${uploadId}/chunk-${String(i).padStart(6, '0')}`
    const obj = await c.env.R2_BUCKET.get(r2Key)
    if (!obj) {
      return c.json({ error: `Missing chunk ${i}` }, 500)
    }
    chunks.push(new Uint8Array(await obj.arrayBuffer()))
  }

  // Write assembled file
  const totalLen = chunks.reduce((s, chunk) => s + chunk.length, 0)
  const assembled = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunks) {
    assembled.set(chunk, offset)
    offset += chunk.length
  }

  await c.env.R2_BUCKET.put(`files/${uploadId}/content`, assembled)

  // Store envelopes and metadata in R2
  await c.env.R2_BUCKET.put(
    `files/${uploadId}/envelopes`,
    JSON.stringify(manifest.recipientEnvelopes)
  )
  await c.env.R2_BUCKET.put(
    `files/${uploadId}/metadata`,
    JSON.stringify(manifest.encryptedMetadata)
  )

  // Clean up individual chunks
  for (let i = 0; i < manifest.totalChunks; i++) {
    const r2Key = `files/${uploadId}/chunk-${String(i).padStart(6, '0')}`
    await c.env.R2_BUCKET.delete(r2Key)
  }

  // Mark manifest as complete
  await c.env.R2_BUCKET.put(
    `files/${uploadId}/manifest`,
    JSON.stringify({ ...manifest, status: 'complete' })
  )

  await services.records.addAuditEntry(hubId ?? 'global', 'fileUploadCompleted', pubkey, {
    uploadId,
  })

  return c.json({ fileId: uploadId, status: 'complete' })
})

// Get upload status (for resume)
uploads.get('/:id/status', async (c) => {
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const uploadId = c.req.param('id')

  if (!c.env.R2_BUCKET) {
    return c.json({ error: 'File storage not configured' }, 503)
  }

  const manifestObj = await c.env.R2_BUCKET.get(`files/${uploadId}/manifest`)
  if (!manifestObj) {
    return c.json({ error: 'Upload not found' }, 404)
  }

  const manifest = JSON.parse(new TextDecoder().decode(await manifestObj.arrayBuffer())) as {
    id: string
    uploadedBy: string
    status: string
    completedChunks: number
    totalChunks: number
    totalSize: number
  }

  // Only allow the uploader or users with download-all to check status
  if (manifest.uploadedBy !== pubkey && !checkPermission(permissions, 'files:download-all')) {
    return c.json({ error: 'Upload not found' }, 404)
  }
  return c.json({
    uploadId: manifest.id,
    status: manifest.status,
    completedChunks: manifest.completedChunks,
    totalChunks: manifest.totalChunks,
    totalSize: manifest.totalSize,
  })
})

export default uploads
