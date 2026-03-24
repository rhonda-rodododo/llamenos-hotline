import { test, expect } from '@playwright/test'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'
import { ADMIN_NSEC, resetTestState } from '../helpers'

test.describe('Blasts — API', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test('blast deletion via API removes it from the list', async ({ request }) => {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a blast via API
    const blastName = `API Delete ${Date.now()}`
    const createRes = await authedApi.post('/api/blasts', {
      name: blastName,
      channel: 'sms',
      content: 'To be deleted via API',
    })
    expect(createRes.status()).toBe(201)
    const createData = await createRes.json() as { id: string }
    const blastId = createData.id
    expect(blastId).toBeTruthy()

    // Delete via API
    const deleteRes = await authedApi.delete(`/api/blasts/${blastId}`)
    expect(deleteRes.status()).toBe(200)

    // Verify it's gone from the list API
    const listRes = await authedApi.get('/api/blasts')
    expect(listRes.status()).toBe(200)
    const listData = await listRes.json() as { blasts: Array<{ id: string }> }
    const deletedBlast = listData.blasts.find((b) => b.id === blastId)
    expect(deletedBlast).toBeUndefined()
  })
})
