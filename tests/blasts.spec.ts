import { test, expect, type Page } from '@playwright/test'
import {
  loginAsAdmin,
  loginAsVolunteer,
  createVolunteerAndGetNsec,
  dismissNsecCard,
  completeProfileSetup,
  navigateAfterLogin,
  resetTestState,
  uniquePhone,
  Timeouts,
} from './helpers'

// Window type augmentation for authed fetch helper
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

function injectAuthedFetch(page: Page) {
  return page.evaluate(() => {
    window.__authedFetch = async (url: string, options: RequestInit = {}) => {
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
}

test.describe('Blasts — access control, validation, deletion', () => {
  test.describe.configure({ mode: 'serial' })

  let volunteerNsec: string

  test.beforeAll(async ({ browser, request }) => {
    await resetTestState(request)

    // Create a volunteer for access control tests
    const page = await browser.newPage()
    await loginAsAdmin(page)
    volunteerNsec = await createVolunteerAndGetNsec(page, 'Blast Test Vol', uniquePhone())
    await dismissNsecCard(page)
    await page.close()
  })

  test('volunteer cannot access the blasts page (redirected or denied)', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    // Try to navigate to the blasts page
    await page.goto('/blasts')
    await page.waitForTimeout(Timeouts.ASYNC_SETTLE)

    // Volunteer should NOT see the Message Blasts heading — they should be
    // redirected away or shown an access denied state
    const blastsHeading = page.getByRole('heading', { name: 'Message Blasts' })
    const isVisible = await blastsHeading.isVisible().catch(() => false)
    expect(isVisible).toBe(false)

    // Confirm the URL changed away from /blasts (redirected) OR an error/forbidden is shown
    const currentUrl = page.url()
    const onBlastsPage = currentUrl.includes('/blasts')
    if (onBlastsPage) {
      // If still on blasts page, there should be a forbidden/access denied indicator
      const forbiddenIndicator = page.getByText(/forbidden|access denied|not authorized|permission/i)
      await expect(forbiddenIndicator).toBeVisible({ timeout: Timeouts.ELEMENT })
    }
    // If redirected away, that's the expected behavior — test passes
  })

  test('volunteer cannot access blasts API endpoint', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)
    await injectAuthedFetch(page)

    const result = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/blasts')
      return { status: res.status, ok: res.ok }
    })

    // Should get 403 Forbidden
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
  })

  test('blast composer validates empty name field', async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Open the blast composer
    await page.getByRole('button', { name: /new blast/i }).click()
    await expect(page.getByTestId('blast-name')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Leave name empty but fill text
    await page.getByTestId('blast-text').fill('Some blast content')

    // The save button should be disabled when name is empty
    const saveButton = page.getByRole('button', { name: /save|create/i })
    await expect(saveButton).toBeDisabled()
  })

  test('blast composer validates empty content field', async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Open the blast composer
    await page.getByRole('button', { name: /new blast/i }).click()
    await expect(page.getByTestId('blast-name')).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Fill name but leave text empty
    await page.getByTestId('blast-name').fill('Validation Test Blast')

    // Save button should be disabled when text is empty
    const saveButton = page.getByRole('button', { name: /save|create/i })
    await expect(saveButton).toBeDisabled()
  })

  test('blast composer save button enables only when both fields are filled', async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({ timeout: Timeouts.ELEMENT })

    await page.getByRole('button', { name: /new blast/i }).click()
    await expect(page.getByTestId('blast-name')).toBeVisible({ timeout: Timeouts.ELEMENT })

    const saveButton = page.getByRole('button', { name: /save|create/i })

    // Both empty — disabled
    await expect(saveButton).toBeDisabled()

    // Only name — still disabled
    await page.getByTestId('blast-name').fill('Test')
    await expect(saveButton).toBeDisabled()

    // Clear name, fill text — still disabled
    await page.getByTestId('blast-name').fill('')
    await page.getByTestId('blast-text').fill('Content')
    await expect(saveButton).toBeDisabled()

    // Both filled — enabled
    await page.getByTestId('blast-name').fill('Test')
    await expect(saveButton).toBeEnabled()
  })

  test('blast can be deleted after creation', async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({ timeout: Timeouts.ELEMENT })

    // Create a blast first
    const blastName = `Delete Test ${Date.now()}`
    await page.getByRole('button', { name: /new blast/i }).click()
    await expect(page.getByTestId('blast-name')).toBeVisible({ timeout: Timeouts.ELEMENT })
    await page.getByTestId('blast-name').fill(blastName)
    await page.getByTestId('blast-text').fill('This blast will be deleted')
    await page.getByRole('button', { name: /save|create/i }).click()

    // Blast should appear in the list
    await expect(page.getByText(blastName)).toBeVisible({ timeout: Timeouts.API })

    // Click on the blast to select it and see its details
    await page.getByText(blastName).click()

    // Click the delete button in the detail panel
    const deleteButton = page.getByRole('button', { name: /delete/i })
    await expect(deleteButton).toBeVisible({ timeout: Timeouts.ELEMENT })
    await deleteButton.click()

    // The blast should be removed from the list
    await expect(page.getByText(blastName)).not.toBeVisible({ timeout: Timeouts.API })
  })

  test('blast deletion via API removes it from the list', async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)

    // Create a blast via API
    const blastName = `API Delete ${Date.now()}`
    const createResult = await page.evaluate(async (name: string) => {
      const res = await window.__authedFetch('/api/blasts', {
        method: 'POST',
        body: JSON.stringify({
          name,
          channel: 'sms',
          content: 'To be deleted via API',
        }),
      })
      return { status: res.status, data: await res.json() }
    }, blastName)
    expect(createResult.status).toBe(200)
    const blastId = (createResult.data as { id: string }).id
    expect(blastId).toBeTruthy()

    // Delete via API
    const deleteResult = await page.evaluate(async (id: string) => {
      const res = await window.__authedFetch(`/api/blasts/${id}`, { method: 'DELETE' })
      return { status: res.status, data: await res.json() }
    }, blastId)
    expect(deleteResult.status).toBe(200)

    // Verify it's gone from the list API
    const listResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/blasts')
      return { status: res.status, data: await res.json() }
    })
    expect(listResult.status).toBe(200)
    const blasts = (listResult.data as { blasts: Array<{ id: string }> }).blasts
    const deletedBlast = blasts.find((b) => b.id === blastId)
    expect(deletedBlast).toBeUndefined()
  })
})
