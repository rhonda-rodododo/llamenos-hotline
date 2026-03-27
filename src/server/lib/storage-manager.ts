/**
 * Hub-aware, namespace-scoped object storage manager.
 * Uses S3-compatible API (RustFS / MinIO) with per-hub bucket isolation.
 *
 * Bucket naming: `{hubId}-{namespace}` (e.g., `hub-abc123-voicemails`)
 *
 * Credential priority:
 *   1. STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY — preferred (provider-agnostic)
 *   2. MINIO_APP_USER / MINIO_APP_PASSWORD — dedicated app IAM user (legacy)
 *   3. MINIO_ACCESS_KEY / MINIO_SECRET_KEY — root credentials (legacy dev fallback)
 */
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
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

function bucketName(hubId: string, namespace: StorageNamespace): string {
  return `${hubId}-${namespace}`
}

/**
 * Collect a ReadableStream | ArrayBuffer | Uint8Array | string into bytes for S3 PutObject.
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

export interface StorageManagerOptions {
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  region?: string
}

export function resolveStorageCredentials(): {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
} {
  // Endpoint priority
  const endpoint =
    process.env.STORAGE_ENDPOINT || process.env.MINIO_ENDPOINT || 'http://localhost:9000'

  // Access key priority with deprecation warnings
  let accessKeyId = process.env.STORAGE_ACCESS_KEY
  if (!accessKeyId) {
    if (process.env.MINIO_APP_USER) {
      console.warn('[storage] MINIO_APP_USER is deprecated, use STORAGE_ACCESS_KEY instead')
      accessKeyId = process.env.MINIO_APP_USER
    } else if (process.env.MINIO_ACCESS_KEY) {
      console.warn('[storage] MINIO_ACCESS_KEY is deprecated, use STORAGE_ACCESS_KEY instead')
      accessKeyId = process.env.MINIO_ACCESS_KEY
    }
  }

  // Secret key priority with deprecation warnings
  let secretAccessKey = process.env.STORAGE_SECRET_KEY
  if (!secretAccessKey) {
    if (process.env.MINIO_APP_PASSWORD) {
      console.warn('[storage] MINIO_APP_PASSWORD is deprecated, use STORAGE_SECRET_KEY instead')
      secretAccessKey = process.env.MINIO_APP_PASSWORD
    } else if (process.env.MINIO_SECRET_KEY) {
      console.warn('[storage] MINIO_SECRET_KEY is deprecated, use STORAGE_SECRET_KEY instead')
      secretAccessKey = process.env.MINIO_SECRET_KEY
    }
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Storage credentials required: set STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY ' +
        '(or legacy MINIO_APP_USER/MINIO_APP_PASSWORD, MINIO_ACCESS_KEY/MINIO_SECRET_KEY)'
    )
  }

  return { endpoint, accessKeyId, secretAccessKey }
}

export function createStorageManager(opts?: StorageManagerOptions): StorageManager {
  const resolved =
    opts?.accessKeyId && opts?.secretAccessKey
      ? {
          endpoint: opts.endpoint || 'http://localhost:9000',
          accessKeyId: opts.accessKeyId,
          secretAccessKey: opts.secretAccessKey,
        }
      : resolveStorageCredentials()

  const endpoint = opts?.endpoint || resolved.endpoint
  const region = opts?.region || 'us-east-1'

  const client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
    },
    forcePathStyle: true, // Required for S3-compatible stores (RustFS, MinIO)
  })

  const namespaces = Object.keys(STORAGE_NAMESPACES) as StorageNamespace[]

  return {
    async put(hubId, namespace, key, body) {
      const bodyBytes = await toBytes(body)
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName(hubId, namespace),
          Key: key,
          Body: bodyBytes,
        })
      )
    },

    async get(hubId, namespace, key): Promise<BlobResult | null> {
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
        if ((err as { name?: string }).name === 'NoSuchBucket') return null
        throw err
      }
    },

    async delete(hubId, namespace, key) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucketName(hubId, namespace),
            Key: key,
          })
        )
      } catch (err: unknown) {
        // Deleting from a non-existent bucket is not an error
        if ((err as { name?: string }).name === 'NoSuchBucket') return
        throw err
      }
    },

    async provisionHub(hubId) {
      for (const ns of namespaces) {
        const bucket = bucketName(hubId, ns)

        // Create the bucket
        try {
          await client.send(new CreateBucketCommand({ Bucket: bucket }))
        } catch (err: unknown) {
          // Bucket already exists — safe to continue
          const name = (err as { name?: string }).name
          if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
            throw err
          }
        }

        // SSE-S3 (AES256) encryption at rest requires KES/KMS to be configured in RustFS.
        // When available, enable it. When not (e.g., dev without KES), skip gracefully.
        // Data is already E2EE at the application level — SSE is defense-in-depth.
        if (process.env.STORAGE_SSE_ENABLED === 'true') {
          try {
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
          } catch (err) {
            console.warn(
              `[storage] SSE-S3 failed for ${bucket} — KMS may not be configured:`,
              (err as Error).message
            )
          }
        }

        // Set lifecycle policy for namespaces with default retention
        const retentionDays = STORAGE_NAMESPACES[ns].defaultRetentionDays
        if (retentionDays !== null) {
          await client.send(
            new PutBucketLifecycleConfigurationCommand({
              Bucket: bucket,
              LifecycleConfiguration: {
                Rules: [
                  {
                    ID: `${ns}-retention`,
                    Status: 'Enabled',
                    Expiration: { Days: retentionDays },
                    Filter: { Prefix: '' },
                  },
                ],
              },
            })
          )
        }
      }
    },

    async destroyHub(hubId) {
      for (const ns of namespaces) {
        const bucket = bucketName(hubId, ns)

        // Paginated delete of all objects
        let continuationToken: string | undefined
        do {
          let response: ListObjectsV2CommandOutput
          try {
            response = await client.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                ContinuationToken: continuationToken,
                MaxKeys: 1000,
              })
            )
          } catch (err: unknown) {
            if ((err as { name?: string }).name === 'NoSuchBucket') break
            throw err
          }

          const objects = response.Contents
          if (objects && objects.length > 0) {
            await client.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: {
                  Objects: objects.map((o: { Key?: string }) => ({ Key: o.Key })),
                  Quiet: true,
                },
              })
            )
          }

          continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
        } while (continuationToken)

        // Delete the bucket
        try {
          await client.send(new DeleteBucketCommand({ Bucket: bucket }))
        } catch (err: unknown) {
          if ((err as { name?: string }).name === 'NoSuchBucket') continue
          throw err
        }
      }
    },

    async setRetention(hubId, namespace, days) {
      const bucket = bucketName(hubId, namespace)
      if (days === null) {
        // Remove lifecycle rules by setting empty configuration
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
                  Expiration: { Days: days },
                  Filter: { Prefix: '' },
                },
              ],
            },
          })
        )
      }
    },

    async healthy(): Promise<boolean> {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const healthUrl = `${endpoint}/health`
        const response = await fetch(healthUrl, { signal: controller.signal })
        clearTimeout(timeout)
        return response.ok
      } catch {
        return false
      }
    },
  }
}
