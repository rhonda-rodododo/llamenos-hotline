import { expect, test } from '@playwright/test'
import { ADMIN_NSEC, uniquePhone } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Blast campaign API', () => {
  test.describe.configure({ mode: 'serial' })

  test('create a blast via API', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await authedApi.post('/api/blasts', {
      name: 'API Test Campaign',
      channel: 'sms',
      content: 'Hello from API blast test',
    })
    expect([200, 201]).toContain(res.status())
    const data = await res.json()
    expect(data).toHaveProperty('blast')
    expect(data.blast).toHaveProperty('id')
    expect(data.blast.status).toBe('draft')
  })

  test('import subscribers via API', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const phone1 = uniquePhone()
    const phone2 = uniquePhone()

    // Server expects identifierHash + channels array (privacy: never send raw phone)
    const hash = async (phone: string) => {
      const enc = new TextEncoder().encode(phone)
      const buf = await crypto.subtle.digest('SHA-256', enc)
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }

    const res = await authedApi.post('/api/blasts/subscribers/import', [
      { identifierHash: await hash(phone1), channels: [{ type: 'sms', verified: true }] },
      { identifierHash: await hash(phone2), channels: [{ type: 'sms', verified: true }] },
    ])
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.imported).toBe(2)
    expect(data.failed).toBe(0)
  })

  test('send a blast and verify status transitions to sending', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create blast
    const createRes = await authedApi.post('/api/blasts', {
      name: 'Send Test Blast',
      channel: 'sms',
      content: 'This is an E2E send test blast',
    })
    const blastData = await createRes.json()
    expect(blastData.blast).toHaveProperty('id')
    expect(blastData.blast.status).toBe('draft')

    // Send the blast
    const sendRes = await authedApi.post(`/api/blasts/${blastData.blast.id}/send`)
    expect(sendRes.status()).toBe(200)

    // After the send request, poll for status transition
    let currentStatus = 'draft'
    for (let attempt = 0; attempt < 10; attempt++) {
      const checkRes = await authedApi.get(`/api/blasts/${blastData.blast.id}`)
      const checkData = await checkRes.json()
      currentStatus = checkData.blast.status
      if (currentStatus === 'sending' || currentStatus === 'sent') break
      await new Promise((r) => setTimeout(r, 200))
    }
    expect(['sending', 'sent']).toContain(currentStatus)

    // Verify via API that the blast status is now 'sending' or 'sent'
    const verifyRes = await authedApi.get(`/api/blasts/${blastData.blast.id}`)
    expect(verifyRes.ok()).toBe(true)
    const verify = await verifyRes.json()
    expect(['sending', 'sent']).toContain(verify.blast.status)
  })

  test('cannot send a blast that is already in sending state', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a blast
    const createRes = await authedApi.post('/api/blasts', {
      name: 'Double Send Blast',
      channel: 'sms',
      content: 'Test content',
    })
    const blastRes = await createRes.json()
    const blastId = blastRes.blast.id

    // First send -- should succeed
    await authedApi.post(`/api/blasts/${blastId}/send`)

    // Second send -- should fail with 400 (already sending)
    const secondSend = await authedApi.post(`/api/blasts/${blastId}/send`)
    expect(secondSend.ok()).toBe(false)
    expect(secondSend.status()).toBe(400)
  })

  test('list blasts API returns all created blasts', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await authedApi.get('/api/blasts')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('blasts')
    expect(Array.isArray(data.blasts)).toBe(true)
    // Should have at least the blasts created in earlier tests
    expect(data.blasts.length).toBeGreaterThan(0)
  })

  test('subscriber list API returns imported subscribers', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await authedApi.get('/api/blasts/subscribers')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('subscribers')
    expect(Array.isArray(data.subscribers)).toBe(true)
    // Should have at least the 2 subscribers imported in the import test
    expect(data.subscribers.length).toBeGreaterThanOrEqual(2)
  })
})
