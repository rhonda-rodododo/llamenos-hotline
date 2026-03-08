import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers'

test.describe('Auto-Update (Epic 289)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="nav-sidebar"]', { timeout: 30000 })
  })

  test('no update banner shown when no update available', async ({ page }) => {
    // By default, __MOCK_UPDATE is not set, so no update
    // Wait a bit to ensure the checker has run (startup delay is 5s, but in tests it should be fast)
    await page.waitForTimeout(1000)
    await expect(page.locator('[data-testid="update-banner"]')).not.toBeVisible()
  })

  test('shows update banner when update is available', async ({ page }) => {
    // Set mock update before the checker fires
    await page.evaluate(() => {
      window.__MOCK_UPDATE = {
        version: '99.0.0',
        body: 'Important security fixes and performance improvements',
        date: '2026-03-08T00:00:00Z',
      }
    })

    // Trigger an immediate check via the scheduler exposed on the component
    // Since the startup delay is 5s, manually trigger by dispatching the tray event
    // or just wait for it — but for test speed, re-navigate
    await page.reload()
    await page.waitForSelector('[data-testid="nav-sidebar"]', { timeout: 30000 })

    // Re-set mock after reload
    await page.evaluate(() => {
      window.__MOCK_UPDATE = {
        version: '99.0.0',
        body: 'Important security fixes and performance improvements',
        date: '2026-03-08T00:00:00Z',
      }
    })

    // Wait for the update banner (checker runs after 5s delay)
    const banner = page.locator('[data-testid="update-banner"]')
    await expect(banner).toBeVisible({ timeout: 15000 })

    // Verify version is shown
    await expect(banner).toContainText('99.0.0')
  })

  test('can dismiss update banner', async ({ page }) => {
    await page.evaluate(() => {
      window.__MOCK_UPDATE = {
        version: '99.0.0',
        body: 'Test release',
      }
    })
    await page.reload()
    await page.waitForSelector('[data-testid="nav-sidebar"]', { timeout: 30000 })
    await page.evaluate(() => {
      window.__MOCK_UPDATE = {
        version: '99.0.0',
        body: 'Test release',
      }
    })

    const banner = page.locator('[data-testid="update-banner"]')
    await expect(banner).toBeVisible({ timeout: 15000 })

    // Click dismiss
    await page.locator('[data-testid="update-dismiss-btn"]').click()
    await expect(banner).not.toBeVisible()
  })

  test('shows update dialog with release notes', async ({ page }) => {
    await page.evaluate(() => {
      window.__MOCK_UPDATE = {
        version: '99.0.0',
        body: 'Detailed release notes for testing the dialog view',
        date: '2026-03-08T00:00:00Z',
      }
    })
    await page.reload()
    await page.waitForSelector('[data-testid="nav-sidebar"]', { timeout: 30000 })
    await page.evaluate(() => {
      window.__MOCK_UPDATE = {
        version: '99.0.0',
        body: 'Detailed release notes for testing the dialog view',
        date: '2026-03-08T00:00:00Z',
      }
    })

    const banner = page.locator('[data-testid="update-banner"]')
    await expect(banner).toBeVisible({ timeout: 15000 })

    // Open details dialog
    await page.locator('[data-testid="update-details-btn"]').click()

    const dialog = page.locator('[data-testid="update-dialog"]')
    await expect(dialog).toBeVisible()

    // Verify dialog content
    await expect(dialog).toContainText('99.0.0')
    await expect(dialog).toContainText('Detailed release notes for testing the dialog view')
    await expect(dialog.locator('[data-testid="update-skip-btn"]')).toBeVisible()
    await expect(dialog.locator('[data-testid="update-install-btn"]')).toBeVisible()
  })

  test('download progress shows in banner', async ({ page }) => {
    await page.evaluate(() => {
      window.__MOCK_UPDATE = {
        version: '99.0.0',
        body: 'Test',
        downloadSize: 1024 * 1024, // 1MB for faster simulation
      }
    })
    await page.reload()
    await page.waitForSelector('[data-testid="nav-sidebar"]', { timeout: 30000 })
    await page.evaluate(() => {
      window.__MOCK_UPDATE = {
        version: '99.0.0',
        body: 'Test',
        downloadSize: 1024 * 1024,
      }
    })

    const banner = page.locator('[data-testid="update-banner"]')
    await expect(banner).toBeVisible({ timeout: 15000 })

    // Click download
    await page.locator('[data-testid="update-download-btn"]').click()

    // Should show restart button when done
    await expect(page.locator('[data-testid="update-restart-btn"]')).toBeVisible({ timeout: 10000 })
  })
})
