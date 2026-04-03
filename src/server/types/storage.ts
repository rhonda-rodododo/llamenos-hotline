/**
 * Storage namespace definitions with default retention policies.
 * Each namespace maps to a per-hub bucket: `{hubId}-{namespace}`.
 */
export const STORAGE_NAMESPACES = {
  voicemails: { defaultRetentionDays: 365 },
  attachments: { defaultRetentionDays: null },
} satisfies Record<string, { defaultRetentionDays: number | null }>

export type StorageNamespace = keyof typeof STORAGE_NAMESPACES

/**
 * Result returned by StorageManager.get().
 */
export interface BlobResult {
  body: ReadableStream
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Per-hub IAM credentials returned by provisionHub when an admin client is available.
 * The caller encrypts the secretAccessKey and stores in hub_storage_credentials.
 */
export interface HubStorageCredentialResult {
  accessKeyId: string
  secretAccessKey: string
  policyName: string
  userName: string
}

/**
 * Hub-aware, namespace-scoped object storage manager.
 * Replaces the flat BlobStorage interface with per-hub bucket isolation.
 */
export interface StorageManager {
  put(
    hubId: string,
    namespace: StorageNamespace,
    key: string,
    body: ReadableStream | ArrayBuffer | Uint8Array | string
  ): Promise<void>
  get(hubId: string, namespace: StorageNamespace, key: string): Promise<BlobResult | null>
  delete(hubId: string, namespace: StorageNamespace, key: string): Promise<void>
  /** Provision hub buckets. Returns IAM credentials if admin client is available. */
  provisionHub(hubId: string): Promise<HubStorageCredentialResult | undefined>
  /** Destroy hub buckets and IAM resources. Pass userName to also delete the IAM user. */
  destroyHub(hubId: string, userName?: string): Promise<void>
  setRetention(hubId: string, namespace: StorageNamespace, days: number | null): Promise<void>
  healthy(): Promise<boolean>
  /** Create a new StorageManager bound to specific credentials (per-hub S3Client). */
  withCredentials(accessKeyId: string, secretAccessKey: string): StorageManager
}
