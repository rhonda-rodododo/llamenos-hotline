/**
 * Platform abstraction types — shared interfaces that both
 * Cloudflare Workers and Node.js implementations satisfy.
 */

/**
 * Key-value storage API matching the subset of CF DurableObjectStorage
 * that our DOs actually use.
 */
export interface StorageApi {
  get<T = unknown>(key: string): Promise<T | undefined>
  put<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean | undefined>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  setAlarm(scheduledTime: number | Date): Promise<void>
  getAlarm(): Promise<number | null>
  deleteAlarm(): Promise<void>
  transaction<T>(closure: (txn: StorageApi) => Promise<T>): Promise<T>
}

/**
 * Durable Object context — wraps storage and WebSocket APIs.
 * Matches the subset of DurableObjectState we use.
 */
export interface DOContext {
  storage: StorageApi
  // WebSocket methods (only used by CallRouterDO)
  acceptWebSocket(ws: WebSocket, tags: string[]): void
  getWebSockets(tag?: string): WebSocket[]
  getTags(ws: WebSocket): string[]
}

/**
 * S3-compatible blob storage (R2 / MinIO).
 */
export interface BlobStorage {
  put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array | string): Promise<void>
  get(
    key: string
  ): Promise<{ body: ReadableStream; size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>
  delete(key: string): Promise<void>
}

