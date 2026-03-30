import { type APIRequestContext, type Page, expect } from '@playwright/test'
import { TestIds } from '../test-ids'

export const ADMIN_NSEC = 'nsec174zsa94n3e7t0ugfldh9tgkkzmaxhalr78uxt9phjq3mmn6d6xas5jdffh'
export const TEST_PIN = '123456'
const TEST_JWT_SECRET =
  process.env.JWT_SECRET || '0000000000000000000000000000000000000000000000000000000000000003'

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
  /** Time to wait for auth-related operations (60s for parallel execution with PBKDF2) */
  AUTH: 60000,
  /** Short delay for UI settling after login/navigation */
  UI_SETTLE: 500,
  /** Medium delay for route component mount and initial API calls */
  ASYNC_SETTLE: 1500,
} as const

// Re-export TestIds for convenience
export { TestIds } from '../test-ids'

// Re-export page object utilities
export * from '../pages/index'

/**
 * Encrypt an nsec with a PIN and store in the browser's localStorage.
 *
 * Runs the PBKDF2 key derivation + XChaCha20-Poly1305 encryption inside
 * the browser via the app's own key-manager module. This avoids cross-platform
 * crypto divergence between Node.js and Chromium's WebCrypto implementations
 * (which caused test failures on macOS ARM64).
 */
async function preloadEncryptedKey(page: Page, nsec: string, pin: string): Promise<void> {
  // Wait for the key-manager module to be loaded (page must already be on the app)
  await page.waitForFunction(() => window.__TEST_KEY_MANAGER, { timeout: 10000 })

  // Derive pubkey and hex secret key from nsec in Node so we can pass them to the browser
  const { nip19, getPublicKey } = await import('nostr-tools')
  const { bytesToHex } = await import('@noble/hashes/utils.js')
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('Expected nsec')
  const pubkey = getPublicKey(decoded.data)
  const nsecHex = bytesToHex(decoded.data)

  // Run encryption entirely in the browser using the app's own crypto.
  // This avoids cross-platform divergence between Node.js and Chromium PBKDF2.
  // importKey requires IdP value — use synthetic 'device-link' value (same as recovery flow).
  // Real IdP value rotation happens on first unlock.
  await page.evaluate(
    async ({ nsecHex, pin, pubkey }) => {
      // Derive synthetic IdP value in-browser using SubtleCrypto (same as key-store-v2.syntheticIdpValue)
      const encoder = new TextEncoder()
      const data = encoder.encode('llamenos:synthetic:device-link')
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const syntheticValue = new Uint8Array(hashBuffer)
      await window.__TEST_KEY_MANAGER.importKey(
        nsecHex,
        pin,
        pubkey,
        syntheticValue,
        undefined,
        'device-link'
      )
    },
    { nsecHex, pin, pubkey }
  )

  // Verify the key was actually stored before allowing reload.
  // Under load, the localStorage write from importKey can be lost if the page
  // reloads too quickly after evaluate() resolves.
  await page.waitForFunction(() => localStorage.getItem('llamenos-encrypted-key-v2') !== null, {
    timeout: 5000,
  })
}

/**
 * Enter a PIN into the PinInput component.
 * Uses keyboard typing since the component auto-advances focus on each digit.
 */
export async function enterPin(page: Page, pin: string) {
  // Focus the first PIN digit input
  const firstDigit = page.locator('input[aria-label="PIN digit 1"]')
  await firstDigit.waitFor({ state: 'visible', timeout: 10000 })
  // Use focus() instead of click() to avoid Playwright stability check failures
  // caused by CSS transition-colors on the input during page load
  await firstDigit.focus()
  // Type each digit — PinInput handles focus advance automatically
  await page.keyboard.type(pin, { delay: 80 })
  // If PIN is shorter than the input length (e.g., 6 digits in 8-box input),
  // press Enter to submit early (supported when >= minLength)
  await page.keyboard.press('Enter')
}

/**
 * Navigate to a URL after the user has already logged in.
 * If already authenticated (sidebar visible), does SPA navigation directly.
 * Otherwise, re-authenticates via PIN entry first.
 */
export async function navigateAfterLogin(page: Page, url: string): Promise<void> {
  // Check if we're already authenticated (sidebar Dashboard link visible)
  const dashboardLink = page.getByRole('link', { name: 'Dashboard' })
  const isAuthenticated = await dashboardLink.isVisible({ timeout: 1000 }).catch(() => false)

  if (!isAuthenticated) {
    // Handle profile-setup page (no sidebar, need to complete first)
    if (page.url().includes('profile-setup')) {
      await completeProfileSetup(page)
    } else {
      // Need to re-authenticate — full page load clears in-memory keyManager
      await page.goto('/login')
      await page.waitForLoadState('domcontentloaded')

      const pinInput = page.locator('input[aria-label="PIN digit 1"]')
      const pinVisible = await pinInput.isVisible({ timeout: 5000 }).catch(() => false)

      if (pinVisible) {
        await enterPin(page, TEST_PIN)
      }

      // Wait for the authenticated layout (may redirect to profile-setup first)
      const dashOrSetup = await Promise.race([
        dashboardLink
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'dashboard' as const),
        page
          .waitForURL((u) => u.toString().includes('profile-setup'), { timeout: 30000 })
          .then(() => 'profile-setup' as const),
      ])

      if (dashOrSetup === 'profile-setup') {
        await completeProfileSetup(page)
      }
    }
  }

  // SPA navigation via TanStack Router (no page reload, keeps auth state)
  const parsed = new URL(url, 'http://localhost')
  const searchParams = Object.fromEntries(parsed.searchParams.entries())
  await page.evaluate(
    ({ pathname, search }) => {
      const router = (window as any).__TEST_ROUTER
      if (!router) return
      if (Object.keys(search).length > 0) {
        router.navigate({ to: pathname, search })
      } else {
        router.navigate({ to: pathname })
      }
    },
    { pathname: parsed.pathname, search: searchParams }
  )
  await page.waitForURL(
    (u) => {
      const p = new URL(u.toString()).pathname
      return p === parsed.pathname || p === `${parsed.pathname}/`
    },
    { timeout: Timeouts.NAVIGATION }
  )

  // Allow route component to mount and initial API calls to complete
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
}

/**
 * Re-enter PIN after a page.reload() when user is already authenticated.
 * The reload clears keyManager, so the encrypted key in localStorage triggers
 * the PIN screen. After entering PIN the app redirects to /.
 * If currentPath is provided, the helper then navigates back to that path
 * via the sidebar or page.goto as appropriate.
 */
export async function reenterPinAfterReload(page: Page): Promise<void> {
  // After reload, wait for the page to settle — Session Expired modal may flash
  await page.waitForLoadState('domcontentloaded')

  // Dismiss Session Expired modal if it appears before PIN input
  const sessionExpired = page.getByText('Session Expired')
  if (await sessionExpired.isVisible({ timeout: 1000 }).catch(() => false)) {
    const reconnectBtn = page.getByRole('button', { name: /reconnect/i })
    if (await reconnectBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await reconnectBtn.click({ timeout: 3000 }).catch(() => {})
    }
  }

  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  const pinVisible = await pinInput.isVisible({ timeout: 5000 }).catch(() => false)

  if (pinVisible) {
    await enterPin(page, TEST_PIN)
    await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 15000 })
  }
}

/**
 * Login as admin: pre-loads encrypted key into localStorage, then enters PIN.
 * Also installs a handler to auto-dismiss the session expired modal if it appears.
 */
export async function loginAsAdmin(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => sessionStorage.clear())
  await preloadEncryptedKey(page, ADMIN_NSEC, TEST_PIN)

  // Generate JWT for the admin and inject into the auth facade client.
  // The PIN unlock flow calls getMe() which requires a valid JWT.
  const { signAccessToken } = await import('../../src/server/lib/jwt')
  const { nip19, getPublicKey } = await import('nostr-tools')
  const decoded = nip19.decode(ADMIN_NSEC) as { type: 'nsec'; data: Uint8Array }
  const adminPubkey = getPublicKey(decoded.data)
  const jwtSecret = TEST_JWT_SECRET
  const jwt = await signAccessToken({ pubkey: adminPubkey, permissions: ['*'] }, jwtSecret)

  await page.reload({ waitUntil: 'domcontentloaded' })

  // Store JWT in sessionStorage (survives reloads) and inject into facade client
  await page.waitForFunction(() => window.__TEST_AUTH_FACADE, { timeout: 10000 })
  await page.evaluate((token) => {
    sessionStorage.setItem('__TEST_JWT', token)
    window.__TEST_AUTH_FACADE.setAccessToken(token)
  }, jwt)

  await enterPin(page, TEST_PIN)
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
    timeout: 60000,
  })

  // Auto-dismiss session expired modal if it appears during the test.
  // The modal overlays the entire page and blocks all pointer events.
  // Use noWaitAfter to prevent Playwright from waiting for navigations triggered by the click.
  await page.addLocatorHandler(page.getByText('Session Expired'), async () => {
    const reconnectBtn = page.getByRole('button', { name: /reconnect/i })
    if (await reconnectBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await reconnectBtn.click({ timeout: 3000 }).catch(() => {
        // If click fails (e.g., modal dismissed by another action), ignore
      })
    }
  })
}

/**
 * Login as volunteer: pre-loads encrypted key into localStorage, then enters PIN.
 */
export async function loginAsVolunteer(page: Page, nsec: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => sessionStorage.clear())
  await preloadEncryptedKey(page, nsec, TEST_PIN)

  // Generate JWT for the volunteer and inject into the auth facade client
  const { signAccessToken } = await import('../../src/server/lib/jwt')
  const { nip19, getPublicKey } = await import('nostr-tools')
  const decoded = nip19.decode(nsec) as { type: 'nsec'; data: Uint8Array }
  const volPubkey = getPublicKey(decoded.data)
  const jwtSecret = TEST_JWT_SECRET
  const jwt = await signAccessToken({ pubkey: volPubkey, permissions: [] }, jwtSecret)

  await page.reload({ waitUntil: 'domcontentloaded' })

  await page.waitForFunction(() => window.__TEST_AUTH_FACADE, { timeout: 10000 })
  await page.evaluate((token) => {
    sessionStorage.setItem('__TEST_JWT', token)
    window.__TEST_AUTH_FACADE.setAccessToken(token)
  }, jwt)

  await enterPin(page, TEST_PIN)
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: Timeouts.AUTH })
  // Wait for potential client-side redirect to profile-setup (async auth guard)
  await page.waitForTimeout(1500)
  // Complete profile setup if redirected there (first-time volunteer login)
  if (page.url().includes('profile-setup')) {
    await completeProfileSetup(page)
  }
  // Short delay for initial API calls to complete
  await page.waitForTimeout(Timeouts.UI_SETTLE)
}

/**
 * Login using direct nsec entry (recovery path).
 * Useful for first-time login tests when no stored key exists.
 */
export async function loginWithNsec(page: Page, nsec: string) {
  await page.goto('/login')
  await page.evaluate(() => sessionStorage.clear())
  await page.locator('#nsec').fill(nsec)
  await page.getByRole('button', { name: /log in/i }).click()
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 })
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /log out/i }).click()
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
}

export async function createVolunteerAndGetNsec(
  page: Page,
  name: string,
  phone: string
): Promise<string> {
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
    await page.waitForURL((u) => !u.toString().includes('profile-setup'), { timeout: 15000 })
  }
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
    timeout: 10000,
  })
}

export function uniquePhone(): string {
  const suffix = Date.now().toString().slice(-7)
  return `+1555${suffix}`
}

const TEST_RESET_SECRET = process.env.DEV_RESET_SECRET || 'test-reset-secret'

export async function resetTestState(request: APIRequestContext) {
  const res = await request.post('/api/test-reset', {
    headers: { 'X-Test-Secret': TEST_RESET_SECRET },
  })
  if (!res.ok()) {
    throw new Error(`test-reset failed with status ${res.status()}: ${await res.text()}`)
  }
}
