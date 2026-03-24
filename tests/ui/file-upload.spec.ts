import { test, expect } from '@playwright/test'
import { loginAsAdmin, resetTestState } from '../helpers'

// Extend window type for the authed fetch helper injected by loginAsAdmin tests
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

test.describe('File upload lifecycle', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    // Inject authed fetch helper using keyManager auth tokens — same pattern as multi-hub.spec.ts
    await page.evaluate(() => {
      window.__authedFetch = async (url: string, options: RequestInit = {}) => {
        // biome-ignore lint/suspicious/noExplicitAny: test helper
        const km = (window as any).__TEST_KEY_MANAGER
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...((options.headers as Record<string, string>) || {}),
        }
        if (km?.isUnlocked()) {
          const reqMethod = (options.method || 'GET').toUpperCase()
          const reqPath = new URL(url, location.origin).pathname
          const token = km.createAuthToken(Date.now(), reqMethod, reqPath)
          headers['Authorization'] = `Bearer ${token}`
        }
        return fetch(url, { ...options, headers })
      }
    })
  })

  test('full upload flow: init → chunks → complete → download', async ({ page }) => {
    // Create a conversation to attach the file to
    const conversationId = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ channelType: 'web', contactIdentifierHash: 'test-hash-file-upload' }),
      })
      const data = await res.json()
      return data.id as string
    })
    expect(typeof conversationId).toBe('string')

    // Get the admin pubkey from keyManager for envelope construction
    const adminPubkey = await page.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      return (window as any).__TEST_KEY_MANAGER?.getPublicKey() as string
    })
    expect(typeof adminPubkey).toBe('string')

    // Init upload
    const uploadId = await page.evaluate(
      async ([conversationId, adminPubkey]: [string, string]) => {
        const res = await window.__authedFetch('/api/uploads/init', {
          method: 'POST',
          body: JSON.stringify({
            totalSize: 10,
            totalChunks: 2,
            conversationId,
            recipientEnvelopes: [
              {
                pubkey: adminPubkey,
                encryptedFileKey: 'test-key-hex',
                ephemeralPubkey: 'test-ephem-hex',
              },
            ],
            encryptedMetadata: [
              {
                pubkey: adminPubkey,
                encryptedContent: 'test-meta-hex',
                ephemeralPubkey: 'test-ephem-hex',
              },
            ],
          }),
        })
        if (!res.ok) throw new Error(`Init failed: ${res.status} ${await res.text()}`)
        const data = await res.json()
        return data.uploadId as string
      },
      [conversationId, adminPubkey] as [string, string],
    )
    expect(typeof uploadId).toBe('string')

    // Upload chunk 0
    const chunk0Result = await page.evaluate(async (uploadId: string) => {
      const body = new Uint8Array([1, 2, 3, 4, 5]).buffer
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
      if (km?.isUnlocked()) {
        const token = km.createAuthToken(Date.now(), 'PUT', `/api/uploads/${uploadId}/chunks/0`)
        headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch(`/api/uploads/${uploadId}/chunks/0`, { method: 'PUT', headers, body })
      if (!res.ok) return { ok: false, status: res.status, text: await res.text() }
      return { ok: true, ...(await res.json()) }
    }, uploadId)
    expect(chunk0Result.ok).toBe(true)
    expect(chunk0Result.completedChunks).toBe(1)
    expect(chunk0Result.totalChunks).toBe(2)

    // Upload chunk 1
    const chunk1Result = await page.evaluate(async (uploadId: string) => {
      const body = new Uint8Array([6, 7, 8, 9, 10]).buffer
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
      if (km?.isUnlocked()) {
        const token = km.createAuthToken(Date.now(), 'PUT', `/api/uploads/${uploadId}/chunks/1`)
        headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch(`/api/uploads/${uploadId}/chunks/1`, { method: 'PUT', headers, body })
      return { ok: res.ok, status: res.status }
    }, uploadId)
    expect(chunk1Result.ok).toBe(true)

    // Check status before completing
    const statusData = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/status`)
      return res.json()
    }, uploadId)
    expect(statusData.completedChunks).toBe(2)
    expect(statusData.totalChunks).toBe(2)
    expect(statusData.status).toBe('uploading')

    // Complete the upload
    const completeData = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/complete`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`Complete failed: ${res.status} ${await res.text()}`)
      return res.json()
    }, uploadId)
    expect(completeData.fileId).toBe(uploadId)
    expect(completeData.status).toBe('complete')

    // Download content — use __authedFetch and read as ArrayBuffer
    const downloadedBytes = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/files/${uploadId}/content`)
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const buf = await res.arrayBuffer()
      return Array.from(new Uint8Array(buf))
    }, uploadId)
    expect(downloadedBytes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    // Get envelopes from DB
    const envelopes = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/files/${uploadId}/envelopes`)
      return res.json()
    }, uploadId)
    expect(Array.isArray(envelopes)).toBe(true)
    expect(envelopes[0].pubkey).toBe(adminPubkey)

    // Get metadata from DB
    const meta = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/files/${uploadId}/metadata`)
      return res.json()
    }, uploadId)
    expect(Array.isArray(meta)).toBe(true)
    expect(meta[0].pubkey).toBe(adminPubkey)
  })

  test('cannot complete upload with missing chunks', async ({ page }) => {
    const conversationId = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
          channelType: 'web',
          contactIdentifierHash: 'test-hash-missing-chunks',
        }),
      })
      const data = await res.json()
      return data.id as string
    })

    const adminPubkey = await page.evaluate(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      return (window as any).__TEST_KEY_MANAGER?.getPublicKey() as string
    })

    const uploadId = await page.evaluate(
      async ([conversationId, adminPubkey]: [string, string]) => {
        const res = await window.__authedFetch('/api/uploads/init', {
          method: 'POST',
          body: JSON.stringify({
            totalSize: 100,
            totalChunks: 3,
            conversationId,
            recipientEnvelopes: [
              { pubkey: adminPubkey, encryptedFileKey: 'k', ephemeralPubkey: 'e' },
            ],
            encryptedMetadata: [
              { pubkey: adminPubkey, encryptedContent: 'm', ephemeralPubkey: 'e' },
            ],
          }),
        })
        const data = await res.json()
        return data.uploadId as string
      },
      [conversationId, adminPubkey] as [string, string],
    )

    // Only upload 1 of 3 chunks
    await page.evaluate(async (uploadId: string) => {
      const body = new Uint8Array([1, 2, 3]).buffer
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
      if (km?.isUnlocked()) {
        const token = km.createAuthToken(Date.now(), 'PUT', `/api/uploads/${uploadId}/chunks/0`)
        headers['Authorization'] = `Bearer ${token}`
      }
      await fetch(`/api/uploads/${uploadId}/chunks/0`, { method: 'PUT', headers, body })
    }, uploadId)

    const completeResult = await page.evaluate(async (uploadId: string) => {
      const res = await window.__authedFetch(`/api/uploads/${uploadId}/complete`, {
        method: 'POST',
      })
      return { status: res.status, body: await res.json() }
    }, uploadId)
    expect(completeResult.status).toBe(400)
    expect(completeResult.body.completedChunks).toBe(1)
    expect(completeResult.body.totalChunks).toBe(3)
  })
})
