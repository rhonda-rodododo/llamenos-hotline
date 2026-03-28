import { expect, test } from '@playwright/test'
import { TEST_PIN, loginAsAdmin } from '../helpers'

test.describe('Panic Wipe (L-9)', () => {
  test('triple-Escape wipes storage and redirects to login', async ({ page }) => {
    await loginAsAdmin(page)

    // Verify we're on the dashboard and storage has data
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
    const hasKeyBefore = await page.evaluate(() => !!localStorage.getItem('llamenos-encrypted-key'))
    expect(hasKeyBefore).toBe(true)

    // Triple-tap Escape within 1 second
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    await page.keyboard.press('Escape')

    // Should see the red flash overlay briefly
    const overlay = page.getByTestId('panic-wipe-overlay')
    await expect(overlay).toBeVisible({ timeout: 2000 })

    // The wipe does window.location.href = '/login' (full page reload after 200ms).
    // This destroys the JS execution context entirely. We must wait for the new
    // page to fully load before running page.evaluate(). Use waitForURL + the
    // login heading to confirm the fresh page has rendered its React tree.
    await page.waitForURL('**/login', { timeout: 15000 })
    // Wait for the heading — it renders for both PIN-entry and nsec-import modes
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 15000 })

    // Verify storage was cleared
    const storageState = await page.evaluate(() => ({
      hasKey: !!localStorage.getItem('llamenos-encrypted-key'),
      localStorageLength: localStorage.length,
      sessionStorageLength: sessionStorage.length,
    }))
    expect(storageState.hasKey).toBe(false)
    expect(storageState.localStorageLength).toBe(0)
    expect(storageState.sessionStorageLength).toBe(0)
  })

  test('two Escapes then pause does not trigger wipe', async ({ page }) => {
    await loginAsAdmin(page)
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // Two Escapes, then wait > 1 second
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1200) // Wait > 1 second window

    // Third Escape after window expired — should NOT trigger wipe
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    // Should still be on the dashboard
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // Storage should still have the key
    const hasKey = await page.evaluate(() => !!localStorage.getItem('llamenos-encrypted-key'))
    expect(hasKey).toBe(true)
  })
})
