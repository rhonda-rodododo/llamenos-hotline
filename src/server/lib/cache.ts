/**
 * Simple TTL cache — stores values with expiration timestamps.
 * Used for caching hub keys, roles, configs, and other expensive lookups.
 *
 * NOT request-scoped — values persist across requests until TTL expires.
 * Thread-safe for single-threaded Bun runtime.
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>()

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  async getOrSet(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) return cached
    const value = await factory()
    this.set(key, value)
    return value
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}
