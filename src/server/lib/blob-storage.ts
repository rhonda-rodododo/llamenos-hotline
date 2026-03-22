/**
 * S3-compatible blob storage adapter for MinIO.
 * Implements the BlobStorage interface using @aws-sdk/client-s3.
 *
 * Credential priority (production uses least-privilege IAM user):
 *   1. MINIO_APP_USER / MINIO_APP_PASSWORD — dedicated app IAM user (created by init-minio.sh)
 *   2. MINIO_ACCESS_KEY / MINIO_SECRET_KEY — root credentials (dev fallback only)
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { BlobStorage } from '../types'

export function createBlobStorage(opts?: {
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  bucket?: string
  region?: string
}): BlobStorage {
  const endpoint = opts?.endpoint || process.env.MINIO_ENDPOINT || 'http://localhost:9000'
  // Prefer dedicated app IAM user; fall back to root credentials in dev
  const accessKeyId =
    opts?.accessKeyId ||
    process.env.MINIO_APP_USER ||
    process.env.MINIO_ACCESS_KEY
  const secretAccessKey =
    opts?.secretAccessKey ||
    process.env.MINIO_APP_PASSWORD ||
    process.env.MINIO_SECRET_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'MinIO credentials required: set MINIO_APP_USER/MINIO_APP_PASSWORD (or MINIO_ACCESS_KEY/MINIO_SECRET_KEY for dev)'
    )
  }
  const bucket = opts?.bucket || process.env.MINIO_BUCKET || 'llamenos-files'
  const region = opts?.region || 'us-east-1'

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // Required for MinIO
  })

  return {
    async put(
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
        // ReadableStream — collect into buffer
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
          Bucket: bucket,
          Key: key,
          Body: bodyBytes,
        })
      )
    },

    async get(
      key: string
    ): Promise<{ body: ReadableStream; size: number; arrayBuffer(): Promise<ArrayBuffer> } | null> {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        )

        if (!result.Body) return null

        const size = result.ContentLength ?? 0
        // Convert the SDK stream to a web ReadableStream
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

    async delete(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      )
    },
  }
}
