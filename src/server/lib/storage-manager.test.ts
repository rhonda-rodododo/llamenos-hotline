import { describe, expect, it } from 'bun:test'
import { createStorageManager } from './storage-manager'

describe('createStorageManager', () => {
  it('throws when no credentials are configured', () => {
    // Clear all credential env vars to ensure no fallback
    const envKeys = [
      'STORAGE_ACCESS_KEY',
      'STORAGE_SECRET_KEY',
      'MINIO_APP_USER',
      'MINIO_APP_PASSWORD',
      'MINIO_ACCESS_KEY',
      'MINIO_SECRET_KEY',
    ] as const
    const saved: Record<string, string | undefined> = {}
    for (const k of envKeys) {
      saved[k] = process.env[k]
      process.env[k] = ''
    }
    try {
      expect(() => createStorageManager()).toThrow('Storage credentials required')
    } finally {
      for (const k of envKeys) {
        if (saved[k] !== undefined) process.env[k] = saved[k]
        else process.env[k] = ''
      }
    }
  })

  it('creates a StorageManager with all required methods', () => {
    const sm = createStorageManager({
      endpoint: 'http://localhost:9999',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    })

    expect(typeof sm.put).toBe('function')
    expect(typeof sm.get).toBe('function')
    expect(typeof sm.delete).toBe('function')
    expect(typeof sm.provisionHub).toBe('function')
    expect(typeof sm.destroyHub).toBe('function')
    expect(typeof sm.setRetention).toBe('function')
    expect(typeof sm.healthy).toBe('function')
  })

  it('healthy() returns false for unreachable endpoint', async () => {
    const sm = createStorageManager({
      endpoint: 'http://localhost:19999',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    })

    const result = await sm.healthy()
    expect(result).toBe(false)
  })
})
