/**
 * Mock @tauri-apps/plugin-store for Playwright test builds.
 * Uses localStorage as the backing store with a key prefix per store name.
 */

class MockStore {
  private prefix: string

  constructor(name: string) {
    this.prefix = `tauri-store:${name}:`
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = localStorage.getItem(this.prefix + key)
    if (raw === null) return null
    return JSON.parse(raw) as T
  }

  async set(key: string, value: unknown): Promise<void> {
    localStorage.setItem(this.prefix + key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key)
  }

  async clear(): Promise<void> {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(this.prefix)) toRemove.push(k)
    }
    toRemove.forEach(k => localStorage.removeItem(k))
  }

  async save(): Promise<void> {
    // No-op — localStorage persists automatically
  }
}

const storeCache = new Map<string, MockStore>()

export const Store = {
  async load(name: string): Promise<MockStore> {
    let store = storeCache.get(name)
    if (!store) {
      store = new MockStore(name)
      storeCache.set(name, store)
    }
    return store
  },
}
