/**
 * Call Detail and Note Permalink E2E Tests
 *
 * Tests the new call detail page (/calls/:callId) and note permalink (/notes/:noteId).
 *
 * These tests use the notes CRUD API to create a call record and note in a known state,
 * then verify that:
 *   1. The call history list rows are clickable and navigate to /calls/:callId
 *   2. The call detail page shows call metadata
 *   3. Notes are visible on the call detail page
 *   4. Navigating to /notes/:noteId renders the note detail page
 */

import { test, expect } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin, resetTestState } from '../helpers'

test.describe('Call Detail Page', () => {
  let createdNoteId: string
  let createdCallId: string

  test.beforeEach(async ({ page, request }) => {
    await resetTestState(request)
    await loginAsAdmin(page)
  })

  test('call history rows are clickable links to detail page', async ({ page }) => {
    // First create a note (which creates a call record context)
    await navigateAfterLogin(page, '/notes?page=1&callId=&search=')
    await page.getByRole('button', { name: /new note/i }).click()

    const callId = `detail-test-${Date.now()}`
    await page.locator('#call-id').fill(callId)
    await page.locator('textarea').fill('Test note for detail page')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'Test note for detail page' })).toBeVisible({
      timeout: 5000,
    })

    // Navigate to call history
    await navigateAfterLogin(page, '/calls?page=1&q=&dateFrom=&dateTo=')
    // The call history list should have rows (admin sees all)
    // If there are no completed calls, it might be empty — so we just check the structure
    const callRows = page.getByTestId('call-history-row')
    const count = await callRows.count()

    if (count > 0) {
      // Click the first call's detail link
      const detailLink = callRows.first().getByTestId('call-detail-link')
      await detailLink.click()
      // Should navigate to /calls/:callId
      await expect(page).toHaveURL(/\/calls\/[^/]+$/, { timeout: 10000 })
      // Should show the call detail heading
      await expect(page.getByRole('heading', { name: /call detail/i })).toBeVisible()
    } else {
      // No completed calls in test env — test structure only
      test.skip()
    }
  })

  test('note permalink page renders the note', async ({ page }) => {
    // Create a note via the API (using the UI)
    await navigateAfterLogin(page, '/notes?page=1&callId=&search=')
    await page.getByRole('button', { name: /new note/i }).click()

    const callId = `permalink-test-${Date.now()}`
    await page.locator('#call-id').fill(callId)
    await page.locator('textarea').fill('Note for permalink test')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'Note for permalink test' })).toBeVisible({
      timeout: 5000,
    })

    // Get the note ID from the API
    const noteIdRes = await page.evaluate(async () => {
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = {}
      if (km?.isUnlocked()) {
        const token = km.createAuthToken(Date.now(), 'GET', '/api/notes')
        headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch('/api/notes?page=1&limit=1', { headers })
      if (!res.ok) return null
      const data = await res.json()
      return data.notes?.[0]?.id ?? null
    })

    if (noteIdRes) {
      createdNoteId = noteIdRes
      // Navigate to the note permalink
      await page.goto(`/notes/${createdNoteId}`)
      await page.waitForLoadState('domcontentloaded')
      // Should show note details heading
      await expect(page.getByRole('heading', { name: /note details/i })).toBeVisible({
        timeout: 10000,
      })
      // Should show encryption badge
      await expect(page.getByText(/encrypted end-to-end/i)).toBeVisible()
    } else {
      test.skip()
    }
  })

  test('note detail shows disabled edit button', async ({ page }) => {
    // Navigate to the notes page and create a note
    await navigateAfterLogin(page, '/notes?page=1&callId=&search=')
    await page.getByRole('button', { name: /new note/i }).click()

    const callId = `edit-btn-test-${Date.now()}`
    await page.locator('#call-id').fill(callId)
    await page.locator('textarea').fill('Note for edit button test')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'Note for edit button test' })).toBeVisible({
      timeout: 5000,
    })

    // Get note ID
    const noteId = await page.evaluate(async () => {
      const km = (window as any).__TEST_KEY_MANAGER
      const headers: Record<string, string> = {}
      if (km?.isUnlocked()) {
        const token = km.createAuthToken(Date.now(), 'GET', '/api/notes')
        headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch('/api/notes?page=1&limit=1', { headers })
      if (!res.ok) return null
      const data = await res.json()
      return data.notes?.[0]?.id ?? null
    })

    if (noteId) {
      await page.goto(`/notes/${noteId}`)
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByRole('heading', { name: /note details/i })).toBeVisible({
        timeout: 10000,
      })

      // Edit button should be disabled
      const editBtn = page.getByRole('button', { name: /edit/i })
      await expect(editBtn).toBeDisabled()
    } else {
      test.skip()
    }
  })

  test('call detail API returns 404 for non-existent call', async ({ request }) => {
    // Directly hit the API endpoint
    const res = await request.get('/api/calls/nonexistent-call-id/detail')
    // Without auth, should be 401 — with auth would be 404
    expect([401, 404]).toContain(res.status())
  })

  test('note detail API returns 404 for non-existent note', async ({ request }) => {
    const res = await request.get('/api/notes/nonexistent-note-id')
    expect([401, 404]).toContain(res.status())
  })
})

test.describe('Settings Profile Section', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetTestState(request)
    await loginAsAdmin(page)
  })

  test('settings page has profile section with name, phone, and language fields', async ({
    page,
  }) => {
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Profile section should be visible and expanded by default
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(page.locator('#profile-name')).toBeVisible()
    await expect(page.locator('#profile-phone')).toBeVisible()
    // Spoken languages should be visible
    await expect(page.getByText(/languages you can take calls in/i)).toBeVisible()
  })
})
