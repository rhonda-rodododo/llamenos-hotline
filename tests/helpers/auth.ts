import { type Page, expect } from '@playwright/test'
import { TestIds } from '../test-ids'
import { preloadEncryptedKey } from './crypto'

export const ADMIN_NSEC = 'nsec174zsa94n3e7t0ugfldh9tgkkzmaxhalr78uxt9phjq3mmn6d6xas5jdffh'
export const TEST_PIN = '123456'

/**
 * Default timeout values for common operations.
 * Centralized here for easy tuning during test optimization.
 */
export const Timeouts = {
  /** Time to wait for page navigation */
  NAVIGATION: 10000,
  /** Time to wait for API responses */
  API: 15000,
  /** Time to wait for elements to appear */
  ELEMENT: 10000,
  /** Time to wait for auth-related operations */
  AUTH: 30000,
  /** Short delay for UI settling after login/navigation */
  UI_SETTLE: 500,
  /** Medium delay for route component mount and initial API calls */
  ASYNC_SETTLE: 1500,
} as const

/**
 * Enter a PIN into the PinInput component.
 * Uses keyboard typing since the component auto-advances focus on each digit.
 */
export async function enterPin(page: Page, pin: string) {
  const firstDigit = page.locator('input[aria-label="PIN digit 1"]')
  await firstDigit.waitFor({ state: 'visible', timeout: 10000 })
  await firstDigit.click()
  await page.keyboard.type(pin, { delay: 50 })
  await page.keyboard.press('Enter')
}

/**
 * Navigate to a URL after the user has already logged in.
 * If already authenticated (sidebar visible), does SPA navigation directly.
 * Otherwise, re-authenticates via PIN entry first.
 */
export async function navigateAfterLogin(page: Page, url: string): Promise<void> {
  const dashboardLink = page.getByRole('link', { name: 'Dashboard' })
  const isAuthenticated = await dashboardLink.isVisible({ timeout: 1000 }).catch(() => false)

  if (!isAuthenticated) {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    const pinInput = page.locator('input[aria-label="PIN digit 1"]')
    const pinVisible = await pinInput.isVisible({ timeout: 5000 }).catch(() => false)

    if (pinVisible) {
      await enterPin(page, TEST_PIN)
    }

    await dashboardLink.waitFor({ state: 'visible', timeout: 30000 })
  }

  const parsed = new URL(url, 'http://localhost')
  const searchParams = Object.fromEntries(parsed.searchParams.entries())
  await page.evaluate(({ pathname, search }) => {
    const router = (window as any).__TEST_ROUTER
    if (!router) return
    if (Object.keys(search).length > 0) {
      router.navigate({ to: pathname, search })
    } else {
      router.navigate({ to: pathname })
    }
  }, { pathname: parsed.pathname, search: searchParams })
  await page.waitForURL(u => u.toString().includes(parsed.pathname), { timeout: Timeouts.NAVIGATION })
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
}

/**
 * Re-enter PIN after a page.reload() when user is already authenticated.
 */
export async function reenterPinAfterReload(page: Page): Promise<void> {
  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  const pinVisible = await pinInput.isVisible({ timeout: 3000 }).catch(() => false)

  if (pinVisible) {
    await enterPin(page, TEST_PIN)
    await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15000 })
  }
}

/**
 * Login as admin: pre-loads encrypted key into localStorage, then enters PIN.
 */
export async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.evaluate(() => sessionStorage.clear())
  await preloadEncryptedKey(page, ADMIN_NSEC, TEST_PIN)
  await page.reload()
  await enterPin(page, TEST_PIN)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30000 })
}

/**
 * Login as volunteer: pre-loads encrypted key into localStorage, then enters PIN.
 */
export async function loginAsVolunteer(page: Page, nsec: string) {
  await page.goto('/login')
  await page.evaluate(() => sessionStorage.clear())
  await preloadEncryptedKey(page, nsec, TEST_PIN)
  await page.reload()
  await enterPin(page, TEST_PIN)
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: Timeouts.API })
  await page.waitForTimeout(Timeouts.UI_SETTLE)
}

/**
 * Login using direct nsec entry (recovery path).
 */
export async function loginWithNsec(page: Page, nsec: string) {
  await page.goto('/login')
  await page.evaluate(() => sessionStorage.clear())
  await page.locator('#nsec').fill(nsec)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 })
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /log out/i }).click()
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
}

export async function createVolunteerAndGetNsec(page: Page, name: string, phone: string): Promise<string> {
  await page.getByRole('link', { name: 'Volunteers' }).click()
  await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()

  await page.getByTestId(TestIds.VOLUNTEER_ADD_BTN).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Phone Number').fill(phone)
  await page.getByLabel('Phone Number').blur()
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()

  const nsecCode = page.getByTestId(TestIds.VOLUNTEER_NSEC_CODE)
  await expect(nsecCode).toBeVisible({ timeout: Timeouts.API })
  const nsec = await nsecCode.textContent()
  if (!nsec) throw new Error('Failed to get nsec')
  return nsec
}

/** Dismiss the nsec card shown after volunteer creation. */
export async function dismissNsecCard(page: Page): Promise<void> {
  await page.getByTestId('dismiss-nsec').click()
  await expect(page.getByTestId('dismiss-nsec')).not.toBeVisible()
}

export async function completeProfileSetup(page: Page) {
  if (page.url().includes('profile-setup')) {
    await page.getByRole('button', { name: /complete setup/i }).click()
    await page.waitForURL(u => !u.toString().includes('profile-setup'), { timeout: 15000 })
  }
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })
}

export function uniquePhone(): string {
  const suffix = Date.now().toString().slice(-7)
  return `+1555${suffix}`
}
