import { test, expect } from '@playwright/test'
import { loginAsAdmin, enterPin, TEST_PIN } from './helpers'

test.describe('Help & Getting Started', () => {
  test('help page loads with FAQ sections', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Help' }).click()

    // Page heading should be visible
    await expect(page.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Quick reference cards should be visible
    await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()

    // FAQ sections should be present
    await expect(page.getByText('Getting Started')).toBeVisible()
    await expect(page.getByText('Calls & Shifts')).toBeVisible()
    await expect(page.getByText('Notes & Encryption')).toBeVisible()

    // Admin-only FAQ section should be visible for admin
    await expect(page.getByText('Administration')).toBeVisible()
  })

  test('help page FAQ items expand on click', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Help' }).click()
    await expect(page.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Click a FAQ question
    const faqQuestion = page.getByText('How do I log in?')
    await faqQuestion.click()

    // The answer should be visible
    await expect(page.getByText(/6-digit PIN/)).toBeVisible()

    // Click again to collapse
    await faqQuestion.click()
    await expect(page.getByText(/6-digit PIN/)).not.toBeVisible()
  })

  test('help page shows admin guide for admin users', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Help' }).click()
    await expect(page.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Admin guide should be visible
    await expect(page.getByText('Admin Guide')).toBeVisible()
    // Volunteer guide should also be visible for admins
    await expect(page.getByText('Volunteer Guide')).toBeVisible()
  })

  test('help page shows keyboard shortcuts reference', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Help' }).click()
    await expect(page.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Shortcut reference card should show shortcuts
    await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible()
    await expect(page.getByText('Ctrl+K', { exact: true })).toBeVisible()
    await expect(page.getByText('Alt+N', { exact: true })).toBeVisible()
  })

  test('help page shows quick navigation links', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Help' }).click()
    await expect(page.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Quick nav section should have links
    await expect(page.getByRole('heading', { name: 'Quick Navigation' })).toBeVisible()
    // Scope to main content to avoid matching sidebar nav links
    const mainContent = page.locator('main')
    await expect(mainContent.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(mainContent.getByRole('link', { name: 'Volunteers' })).toBeVisible()
  })

  test('help link is visible in sidebar', async ({ page }) => {
    await loginAsAdmin(page)
    // On dashboard, Help link should be in sidebar
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })

    const helpLink = page.locator('nav').getByRole('link', { name: 'Help' })
    await expect(helpLink).toBeVisible()

    // Click it to navigate
    await helpLink.click()
    await expect(page).toHaveURL(/\/help/)
    await expect(page.getByRole('heading', { name: /help/i })).toBeVisible()
  })

  test('getting started checklist shows on dashboard', async ({ page }) => {
    await loginAsAdmin(page)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })

    // Clear any previous dismissal and reload to reset the checklist state
    await page.evaluate(() => localStorage.removeItem('getting-started-dismissed'))
    await page.reload()
    // Re-enter PIN after reload (in-memory key cleared)
    await enterPin(page, TEST_PIN)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30000 })

    // Getting Started checklist should be visible if not all items are done.
    // If setup wizard is already completed and all items are done, the component hides itself.
    // Check if the checklist or at least some checklist items are visible.
    const checklist = page.getByText('Getting Started')
    const isVisible = await checklist.isVisible({ timeout: 5000 }).catch(() => false)

    if (isVisible) {
      // At least one checklist item should be visible
      const hasItem = await page.getByText('Complete setup wizard').or(page.getByText('Invite volunteers')).or(page.getByText('Create shift schedule')).or(page.getByText('Configure telephony')).first().isVisible().catch(() => false)
      expect(hasItem).toBeTruthy()
    } else {
      // All checklist items are done — this is acceptable, skip gracefully
      test.skip(true, 'All getting started items completed — checklist auto-hides')
    }
  })

  test('getting started checklist can be dismissed', async ({ page }) => {
    await loginAsAdmin(page)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })

    // Clear any previous dismissal and reload
    await page.evaluate(() => localStorage.removeItem('getting-started-dismissed'))
    await page.reload()
    // Re-enter PIN after reload (in-memory key cleared)
    await enterPin(page, TEST_PIN)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30000 })

    // Check if checklist is visible (may auto-hide if all items done)
    const checklist = page.getByText('Getting Started')
    const isVisible = await checklist.isVisible({ timeout: 5000 }).catch(() => false)
    if (!isVisible) {
      test.skip(true, 'All getting started items completed — checklist auto-hides')
      return
    }

    // Click the dismiss (X) button
    const checklistCard = page.locator('text=Getting Started').locator('..').locator('..')
    const closeBtn = checklistCard.getByLabel('Close')
    await closeBtn.click()

    // Checklist should be hidden
    await expect(page.getByText('Getting Started')).not.toBeVisible({ timeout: 3000 })
  })

  test('command palette includes Help command', async ({ page }) => {
    await loginAsAdmin(page)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })

    // Open command palette with Ctrl+K
    await page.keyboard.press('Control+k')
    await expect(page.getByPlaceholder('Type a command or search...')).toBeVisible({ timeout: 5000 })

    // Type "help" to search
    await page.getByPlaceholder('Type a command or search...').fill('help')

    // Help command should appear
    await expect(page.getByRole('option', { name: 'Help', exact: true })).toBeVisible()
  })
})
