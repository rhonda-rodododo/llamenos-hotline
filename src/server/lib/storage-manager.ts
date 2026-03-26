/**
 * Hub-aware S3-compatible storage manager for RustFS / MinIO.
 *
 * Each hub gets per-namespace buckets: `{hubId}-{namespace}`.
 * Supports provisioning, teardown, lifecycle/retention, and health checks.
 *
 * Credential priority:
 *   1. STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY  (new RustFS convention)
 *   2. MINIO_APP_USER / MINIO_APP_PASSWORD      (dedicated app IAM user)
 *   3. MINIO_ACCESS_KEY / MINIO_SECRET_KEY      (root credentials, dev fallback)
 */
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  type BlobResult,
  STORAGE_NAMESPACES,
  type StorageManager,
  type StorageNamespace,
} from '../types'

export interface StorageManagerOptions {
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  region?: string
}

function resolveCredentials(opts?: StorageManagerOptions): {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  region: string
} {
  const endpoint =
    opts?.endpoint ||
    process.env.STORAGE_ENDPOINT ||
    process.env.MINIO_ENDPOINT ||
    'http://localhost:9000'
  const region = opts?.region || process.env.STORAGE_REGION || 'us-east-1'

  // Priority 1: STORAGE_* env vars
  let accessKeyId = opts?.accessKeyId || process.env.STORAGE_ACCESS_KEY
  let secretAccessKey = opts?.secretAccessKey || process.env.STORAGE_SECRET_KEY

  // Priority 2: MINIO_APP_* (dedicated app IAM user)
  if (!accessKeyId || !secretAccessKey) {
    if (process.env.MINIO_APP_USER && process.env.MINIO_APP_PASSWORD) {
      if (!opts?.accessKeyId) {
        console.warn(
          '[storage] MINIO_APP_USER/MINIO_APP_PASSWORD is deprecated — migrate to STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY'
        )
      }
      accessKeyId = accessKeyId || process.env.MINIO_APP_USER
      secretAccessKey = secretAccessKey || process.env.MINIO_APP_PASSWORD
    }
  }

  // Priority 3: MINIO_ACCESS_KEY/MINIO_SECRET_KEY (root, dev fallback)
  if (!accessKeyId || !secretAccessKey) {
    if (process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY) {
      if (!opts?.accessKeyId) {
        console.warn(
          '[storage] MINIO_ACCESS_KEY/MINIO_SECRET_KEY is deprecated — migrate to STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY'
        )
      }
      accessKeyId = accessKeyId || process.env.MINIO_ACCESS_KEY
      secretAccessKey = secretAccessKey || process.env.MINIO_SECRET_KEY
    }
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Storage credentials required: set STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY ' +
        '(or MINIO_APP_USER/MINIO_APP_PASSWORD for backwards compatibility)'
    )
  }

  return { endpoint, accessKeyId, secretAccessKey, region }
}

function bucketName(hubId: string, namespace: StorageNamespace): string {
  return `${hubId}-${namespace}`
}

/**
 * Collect a ReadableStream | ArrayBuffer | Uint8Array | string into bytes
 * suitable for S3 PutObjectCommand.
 */
async function toBytes(
  body: ReadableStream | ArrayBuffer | Uint8Array | string
): Promise<Uint8Array | string> {
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (body instanceof Uint8Array) return body
  if (typeof body === 'string') return body

  // ReadableStream — collect into buffer
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

export function createStorageManager(opts?: StorageManagerOptions): StorageManager {
  const { endpoint, accessKeyId, secretAccessKey, region } = resolveCredentials(opts)

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // Required for S3-compatible stores (RustFS, MinIO)
  })

  const namespaces = Object.keys(STORAGE_NAMESPACES) as StorageNamespace[]

  return {
    async put(
      hubId: string,
      namespace: StorageNamespace,
      key: string,
      body: ReadableStream | ArrayBuffer | Uint8Array | string
    ): Promise<void> {
      const bodyBytes = await toBytes(body)
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName(hubId, namespace),
          Key: key,
          Body: bodyBytes,
        })
      )
    },

    async get(hubId: string, namespace: StorageNamespace, key: string): Promise<BlobResult | null> {
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

    async delete(hubId: string, namespace: StorageNamespace, key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucketName(hubId, namespace),
          Key: key,
        })
      )
    },

    async provisionHub(hubId: string): Promise<void> {
      for (const ns of namespaces) {
        const bucket = bucketName(hubId, ns)

        // Create the bucket
        await client.send(new CreateBucketCommand({ Bucket: bucket }))

        // Enable SSE-S3 (AES256) server-side encryption
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
        const retention = STORAGE_NAMESPACES[ns].defaultRetentionDays
        if (retention !== null) {
          await client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: bucket,
              LifecycleConfiguration: {
                Rules: [
                  {
                    ID: `${ns}-retention`,
                    Status: 'Enabled',
                    Filter: { Prefix: '' },
                    Expiration: { Days: retention },
                  },
                ],
              },
            })
          )
        }
      }
    },

    async destroyHub(hubId: string): Promise<void> {
      for (const ns of namespaces) {
        const bucket = bucketName(hubId, ns)

        // List and delete all objects (paginated)
        let continuationToken: string | undefined
        do {
          const list = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              ContinuationToken: continuationToken,
            })
          )
          if (list.Contents) {
            await Promise.all(
              list.Contents.map((obj) =>
                client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key! }))
              )
            )
          }
          continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
        } while (continuationToken)

        // Delete the bucket
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
        // Remove lifecycle rules (empty configuration)
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
                  ID: `${namespace}-retention`,
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
        const url = `${endpoint}/minio/health/live`
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) })
        return resp.ok
      } catch {
        return false
      }
    },
  }
}
