import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Tags API', () => {
  test.describe.configure({ mode: 'serial' })

  let tagId: string

  function adminApi(request: import('@playwright/test').APIRequestContext) {
    return createAuthedRequestFromNsec(request, ADMIN_NSEC)
  }

  test('list tags returns array', async ({ request }) => {
    const res = await adminApi(request).get('/api/tags')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('tags')
    expect(Array.isArray(data.tags)).toBe(true)
  })

  test('create tag', async ({ request }) => {
    const res = await adminApi(request).post('/api/tags', {
      name: 'test-tag',
      encryptedLabel: 'encrypted-test-tag',
      color: '#ef4444',
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data.tag).toHaveProperty('id')
    expect(data.tag.name).toBe('test-tag')
    expect(data.tag.color).toBe('#ef4444')
    tagId = data.tag.id
  })

  test('duplicate tag returns 409', async ({ request }) => {
    const res = await adminApi(request).post('/api/tags', {
      name: 'test-tag',
      encryptedLabel: 'encrypted-test-tag',
    })
    expect(res.status()).toBe(409)
  })

  test('update tag', async ({ request }) => {
    const res = await adminApi(request).patch(`/api/tags/${tagId}`, {
      color: '#3b82f6',
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.tag.color).toBe('#3b82f6')
  })

  test('delete tag', async ({ request }) => {
    const res = await adminApi(request).delete(`/api/tags/${tagId}`)
    expect(res.status()).toBe(200)
  })

  test('unauthenticated request returns 401', async ({ request }) => {
    const res = await request.get('/api/tags')
    expect(res.status()).toBe(401)
  })

  test('POST /api/tags with empty body rejects with 400 (schema refinement)', async ({
    request,
  }) => {
    // Neither name nor encryptedLabel — must be rejected by CreateTagSchema.refine
    const res = await adminApi(request).post('/api/tags', {})
    expect(res.status()).toBe(400)
  })

  test('POST /api/tags with only name succeeds via encryptedLabel fallback', async ({
    request,
  }) => {
    const uniqueName = `fallback-only-name-${Date.now()}`
    const res = await adminApi(request).post('/api/tags', {
      name: uniqueName,
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data.tag).toHaveProperty('id')
    expect(data.tag.name).toBe(uniqueName)
    // cleanup
    await adminApi(request).delete(`/api/tags/${data.tag.id}`)
  })
})
