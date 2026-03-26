import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { resolveStorageCredentials } from './storage-manager'

describe('resolveStorageCredentials', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear all storage-related env vars
    process.env.STORAGE_ACCESS_KEY = undefined
    process.env.STORAGE_SECRET_KEY = undefined
    process.env.STORAGE_ENDPOINT = undefined
    process.env.MINIO_APP_USER = undefined
    process.env.MINIO_APP_PASSWORD = undefined
    process.env.MINIO_ACCESS_KEY = undefined
    process.env.MINIO_SECRET_KEY = undefined
    process.env.MINIO_ENDPOINT = undefined
  })

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) process.env[key] = undefined
    }
    Object.assign(process.env, originalEnv)
  })

  it('uses STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY as highest priority', () => {
    process.env.STORAGE_ACCESS_KEY = 'storage-key'
    process.env.STORAGE_SECRET_KEY = 'storage-secret'
    process.env.MINIO_APP_USER = 'minio-user'
    process.env.MINIO_APP_PASSWORD = 'minio-pass'

    const result = resolveStorageCredentials()
    expect(result.accessKeyId).toBe('storage-key')
    expect(result.secretAccessKey).toBe('storage-secret')
  })

  it('falls back to MINIO_APP_USER/MINIO_APP_PASSWORD', () => {
    process.env.MINIO_APP_USER = 'app-user'
    process.env.MINIO_APP_PASSWORD = 'app-pass'

    const warnSpy = mock(() => {})
    const origWarn = console.warn
    console.warn = warnSpy

    const result = resolveStorageCredentials()
    expect(result.accessKeyId).toBe('app-user')
    expect(result.secretAccessKey).toBe('app-pass')
    expect(warnSpy).toHaveBeenCalled()

    console.warn = origWarn
  })

  it('falls back to MINIO_ACCESS_KEY/MINIO_SECRET_KEY', () => {
    process.env.MINIO_ACCESS_KEY = 'root-key'
    process.env.MINIO_SECRET_KEY = 'root-secret'

    const warnSpy = mock(() => {})
    const origWarn = console.warn
    console.warn = warnSpy

    const result = resolveStorageCredentials()
    expect(result.accessKeyId).toBe('root-key')
    expect(result.secretAccessKey).toBe('root-secret')
    expect(warnSpy).toHaveBeenCalled()

    console.warn = origWarn
  })

  it('throws if no credentials are found', () => {
    expect(() => resolveStorageCredentials()).toThrow('Storage credentials required')
  })

  it('uses STORAGE_ENDPOINT as highest priority', () => {
    process.env.STORAGE_ACCESS_KEY = 'key'
    process.env.STORAGE_SECRET_KEY = 'secret'
    process.env.STORAGE_ENDPOINT = 'http://rustfs:9000'
    process.env.MINIO_ENDPOINT = 'http://minio:9000'

    const result = resolveStorageCredentials()
    expect(result.endpoint).toBe('http://rustfs:9000')
  })

  it('falls back to MINIO_ENDPOINT', () => {
    process.env.STORAGE_ACCESS_KEY = 'key'
    process.env.STORAGE_SECRET_KEY = 'secret'
    process.env.MINIO_ENDPOINT = 'http://minio:9000'

    const result = resolveStorageCredentials()
    expect(result.endpoint).toBe('http://minio:9000')
  })

  it('defaults endpoint to http://localhost:9000', () => {
    process.env.STORAGE_ACCESS_KEY = 'key'
    process.env.STORAGE_SECRET_KEY = 'secret'

    const result = resolveStorageCredentials()
    expect(result.endpoint).toBe('http://localhost:9000')
  })
})

describe('StorageManager interface compliance', () => {
  it('STORAGE_NAMESPACES has expected shape', async () => {
    const { STORAGE_NAMESPACES } = await import('../types')
    expect(STORAGE_NAMESPACES.voicemails.defaultRetentionDays).toBe(365)
    expect(STORAGE_NAMESPACES.attachments.defaultRetentionDays).toBeNull()
    expect(Object.keys(STORAGE_NAMESPACES)).toEqual(['voicemails', 'attachments'])
  })

  it('createStorageManager returns object with all required methods', async () => {
    const { createStorageManager } = await import('./storage-manager')
    const manager = createStorageManager({
      endpoint: 'http://localhost:9999',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    })

    expect(typeof manager.put).toBe('function')
    expect(typeof manager.get).toBe('function')
    expect(typeof manager.delete).toBe('function')
    expect(typeof manager.provisionHub).toBe('function')
    expect(typeof manager.destroyHub).toBe('function')
    expect(typeof manager.setRetention).toBe('function')
    expect(typeof manager.healthy).toBe('function')
  })

  it('healthy returns false when endpoint is unreachable', async () => {
    const { createStorageManager } = await import('./storage-manager')
    const manager = createStorageManager({
      endpoint: 'http://localhost:1', // unreachable port
      accessKeyId: 'test',
      secretAccessKey: 'test',
    })

    const result = await manager.healthy()
    expect(result).toBe(false)
  })
})
