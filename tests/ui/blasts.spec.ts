import { expect, test } from '@playwright/test'
import {
  Timeouts,
  completeProfileSetup,
  createUserAndGetNsec,
  dismissNsecCard,
  loginAsAdmin,
  loginAsUser,
  navigateAfterLogin,
  uniquePhone,
} from '../helpers'

test.describe('Blasts — UI', () => {
  // Global setup handles initial reset; tests use unique data for isolation

  /** Helper: create a user and return nsec (logs in as admin, creates vol, closes admin page) */
  async function setupUser(page: import('@playwright/test').Page): Promise<string> {
    await loginAsAdmin(page)
    const nsec = await createUserAndGetNsec(page, `Blast Vol ${Date.now()}`, uniquePhone())
    await dismissNsecCard(page)
    return nsec
  }

  test('user cannot access the blasts page (redirected or denied)', async ({ page }) => {
    const userNsec = await setupUser(page)

    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)

    // Try to navigate to the blasts page
    await page.goto('/blasts')
    await page.waitForTimeout(Timeouts.ASYNC_SETTLE)

    // User should NOT see the Message Blasts heading — they should be
    // redirected away or shown an access denied state
    const blastsHeading = page.getByRole('heading', { name: 'Message Blasts' })
    const isVisible = await blastsHeading.isVisible().catch(() => false)
    expect(isVisible).toBe(false)

    // Confirm the URL changed away from /blasts (redirected) OR an error/forbidden is shown
    const currentUrl = page.url()
    const onBlastsPage = currentUrl.includes('/blasts')
    if (onBlastsPage) {
      // If still on blasts page, there should be a forbidden/access denied indicator
      const forbiddenIndicator = page.getByText(
        /forbidden|access denied|not authorized|permission/i
      )
      await expect(forbiddenIndicator).toBeVisible({ timeout: Timeouts.ELEMENT })
    }
    // If redirected away, that's the expected behavior — test passes
  })

  test('user cannot access blasts API endpoint', async ({ page }) => {
    const userNsec = await setupUser(page)

    await loginAsUser(page, userNsec)
    await completeProfileSetup(page)

    // Inject authed fetch helper that uses keyManager for auth headers
    await page.evaluate(() => {
      ;(window as any).__authedFetch = async (url: string, options: RequestInit = {}) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...((options.headers as Record<string, string>) || {}),
        }
        const token = sessionStorage.getItem('__TEST_JWT')
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }
        return fetch(url, { ...options, headers })
      }
    })

    const result = await page.evaluate(async () => {
      const res = await (window as any).__authedFetch('/api/blasts')
      return { status: res.status, ok: res.ok }
    })

    // Should get 400 (hub context required) or 403 (permission denied)
    expect(result.ok).toBe(false)
    expect([400, 403]).toContain(result.status)
  })

  test('blast composer validates empty name field', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

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
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

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
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

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
    await navigateAfterLogin(page, '/blasts')
    await expect(page.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    // Create a blast first
    const blastName = `Delete Test ${Date.now()}`
    await page.getByRole('button', { name: /new blast/i }).click()
    await expect(page.getByTestId('blast-name')).toBeVisible({ timeout: Timeouts.ELEMENT })
    await page.getByTestId('blast-name').fill(blastName)
    await page.getByTestId('blast-text').fill('This blast will be deleted')
    // Save/create the blast and wait for the API response
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/blasts') && res.request().method() === 'POST' && res.status() < 400
      ),
      page.getByRole('button', { name: /save|create/i }).click(),
    ])

    // Blast should appear in the list (may also appear in detail panel if auto-selected)
    await expect(page.getByText(blastName).first()).toBeVisible({ timeout: Timeouts.API })

    // Click on the blast in the list to select it and see its details
    await page.getByText(blastName).first().click()

    // Wait for the detail panel to fully render before clicking delete
    const deleteButton = page.getByRole('button', { name: 'Delete', exact: true })
    await expect(deleteButton).toBeVisible({ timeout: Timeouts.ELEMENT })
    await expect(deleteButton).toBeEnabled()
    await deleteButton.click()

    // The blast should be removed from the list
    await expect(page.getByText(blastName).first()).not.toBeVisible({ timeout: Timeouts.API })
  })
})
