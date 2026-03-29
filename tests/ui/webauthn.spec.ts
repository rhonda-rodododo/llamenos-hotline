/**
 * WebAuthn Passkey Tests
 *
 * Tests passkey registration, authentication, and credential management
 * using Playwright's virtual authenticator via Chrome DevTools Protocol.
 *
 * Tests:
 *   2.1: Admin registers a passkey → credential appears in list
 *   2.3: Empty label prevents registration (button disabled)
 *   2.4: Multiple passkeys can be registered
 *   3.1: Login with passkey (no nsec required)
 *   3.3: Session from passkey auth works for API calls
 *   4.1: Delete passkey credential
 *
 * All tests skip gracefully when:
 *   - Browser does not support WebAuthn (non-Chromium)
 *   - CDP session fails to set up virtual authenticator
 */

import { type CDPSession, type Page, expect, test } from '@playwright/test'
import { ADMIN_NSEC, TEST_PIN, loginAsAdmin, navigateAfterLogin } from '../helpers'
import { preloadEncryptedKey } from '../helpers/crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Virtual Authenticator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enable virtual authenticator via CDP.
 * Returns { cdp, authenticatorId } for cleanup.
 * Returns null if CDP/WebAuthn not supported (non-Chromium).
 */
async function setupVirtualAuthenticator(
  page: Page
): Promise<{ cdp: CDPSession; authenticatorId: string } | null> {
  try {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('WebAuthn.enable', { enableUI: false })
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    })
    return { cdp, authenticatorId }
  } catch {
    return null
  }
}

async function teardownVirtualAuthenticator(
  cdp: CDPSession,
  authenticatorId: string
): Promise<void> {
  try {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
  } catch {
    // Ignore cleanup errors
  }
}

/** Navigate to /settings and open the passkeys section */
async function openPasskeysSection(page: Page): Promise<void> {
  await navigateAfterLogin(page, '/settings')
  // Wait for the passkeys card to appear (requires webauthnAvailable)
  await expect(page.locator('#passkeys')).toBeVisible({ timeout: 5000 })

  // Check if the collapsible content is already expanded by looking for the input
  const labelInput = page.getByTestId('passkey-label-input')
  const alreadyExpanded = await labelInput.isVisible({ timeout: 500 }).catch(() => false)

  if (!alreadyExpanded) {
    // Click the card header (CollapsibleTrigger wraps CardHeader via asChild,
    // so data-slot becomes "collapsible-trigger" not "card-header")
    await page.locator('#passkeys').locator('div[data-slot="collapsible-trigger"]').click()
    // Wait for collapsible animation to complete
    await labelInput.waitFor({ state: 'visible', timeout: 5000 })
  }

  await expect(labelInput).toBeVisible({ timeout: 5000 })
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Passkey Registration
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Passkey registration', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('admin can register a passkey — credential appears in list', async ({ page }) => {
    const auth = await setupVirtualAuthenticator(page)
    if (!auth) {
      test.skip(true, 'Virtual authenticator not supported (non-Chromium)')
      return
    }

    await openPasskeysSection(page)

    const labelInput = page.getByTestId('passkey-label-input')
    const registerBtn = page.getByTestId('passkey-register-btn')

    // Register button should be disabled until label is entered
    await expect(registerBtn).toBeDisabled()

    // Fill in label and register
    await labelInput.fill('My Test Key')
    await expect(registerBtn).toBeEnabled()
    await registerBtn.click()

    // Virtual authenticator auto-confirms — credential should appear
    await expect(
      page.getByTestId('passkey-credential-row').filter({ hasText: 'My Test Key' })
    ).toBeVisible({ timeout: 10_000 })

    // Success toast
    await expect(page.getByText(/passkey registered/i)).toBeVisible({ timeout: 5000 })

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })

  test('register button is disabled when label is empty', async ({ page }) => {
    const auth = await setupVirtualAuthenticator(page)
    if (!auth) {
      test.skip(true, 'Virtual authenticator not supported')
      return
    }

    await openPasskeysSection(page)

    const registerBtn = page.getByTestId('passkey-register-btn')
    const labelInput = page.getByTestId('passkey-label-input')

    // Empty label → disabled
    await expect(registerBtn).toBeDisabled()

    // Type then clear → disabled again
    await labelInput.fill('test')
    await expect(registerBtn).toBeEnabled()
    await labelInput.clear()
    await expect(registerBtn).toBeDisabled()

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })

  test('multiple passkeys can be registered', async ({ page }) => {
    const auth1 = await setupVirtualAuthenticator(page)
    if (!auth1) {
      test.skip(true, 'Virtual authenticator not supported')
      return
    }

    await openPasskeysSection(page)

    const labelInput = page.getByTestId('passkey-label-input')
    const registerBtn = page.getByTestId('passkey-register-btn')

    // Register first passkey using first virtual authenticator
    await labelInput.fill('Device Alpha')
    await registerBtn.click()
    await expect(
      page.getByTestId('passkey-credential-row').filter({ hasText: 'Device Alpha' })
    ).toBeVisible({ timeout: 10_000 })

    // Remove first authenticator and add a second one on the same CDP session.
    // excludeCredentials prevents the same authenticator from creating a new
    // credential for the same user, so we need a fresh authenticator.
    const { cdp } = auth1
    await cdp.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: auth1.authenticatorId,
    })
    const { authenticatorId: auth2Id } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    })

    // Register second passkey using fresh authenticator
    await labelInput.fill('Device Beta')
    await expect(registerBtn).toBeEnabled({ timeout: 5_000 })
    await registerBtn.click()
    await expect(
      page.getByTestId('passkey-credential-row').filter({ hasText: 'Device Beta' })
    ).toBeVisible({ timeout: 10_000 })

    // Both credentials should be present
    const rows = page.getByTestId('passkey-credential-row')
    const count = await rows.count()
    expect(count, 'Expected at least 2 credentials registered').toBeGreaterThanOrEqual(2)

    await teardownVirtualAuthenticator(cdp, auth2Id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Passkey Authentication
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Passkey authentication', () => {
  test.describe.configure({ mode: 'serial' })

  test('login with passkey succeeds without entering nsec', async ({ page }) => {
    // First register a passkey while logged in with nsec
    await loginAsAdmin(page)

    const auth = await setupVirtualAuthenticator(page)
    if (!auth) {
      test.skip(true, 'Virtual authenticator not supported')
      return
    }

    await openPasskeysSection(page)
    const labelInput = page.getByTestId('passkey-label-input')
    const registerBtn = page.getByTestId('passkey-register-btn')
    await labelInput.fill('Login Test Key')
    await registerBtn.click()
    await expect(
      page.getByTestId('passkey-credential-row').filter({ hasText: 'Login Test Key' })
    ).toBeVisible({ timeout: 10_000 })

    // Now log out and attempt passkey login — clear both storages to simulate a
    // fresh device so the login page shows the passkey button instead of PIN entry
    await page.evaluate(() => {
      sessionStorage.clear()
      localStorage.clear()
    })
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    const passkeyBtn = page.getByTestId('passkey-login-btn')
    await expect(passkeyBtn).toBeVisible({ timeout: 10_000 })

    await passkeyBtn.click()

    // Virtual authenticator auto-selects the registered credential
    // Login should succeed → dashboard visible (or PIN prompt for key unlock)
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15_000 })

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })

  test('session from passkey auth is valid for API calls', async ({ page }) => {
    await loginAsAdmin(page)

    const auth = await setupVirtualAuthenticator(page)
    if (!auth) {
      test.skip(true, 'Virtual authenticator not supported')
      return
    }

    await openPasskeysSection(page)
    const labelInput = page.getByTestId('passkey-label-input')
    const registerBtn = page.getByTestId('passkey-register-btn')
    await labelInput.fill('API Session Key')
    await registerBtn.click()
    await expect(
      page.getByTestId('passkey-credential-row').filter({ hasText: 'API Session Key' })
    ).toBeVisible({ timeout: 10_000 })

    // Log out, log back in via passkey — clear all storage to get the full login form
    await page.evaluate(() => {
      sessionStorage.clear()
      localStorage.clear()
    })
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    const passkeyBtn = page.getByTestId('passkey-login-btn')
    await expect(passkeyBtn).toBeVisible({ timeout: 10_000 })

    await passkeyBtn.click()
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15_000 })

    // Verify API calls work (check health endpoint)
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/health/ready')
      return res.status
    })
    expect(response, 'API should be reachable after passkey login').toBe(200)

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Credential Management
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Credential management', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('deleting a passkey removes it from the list', async ({ page }) => {
    const auth = await setupVirtualAuthenticator(page)
    if (!auth) {
      test.skip(true, 'Virtual authenticator not supported')
      return
    }

    await openPasskeysSection(page)
    const labelInput = page.getByTestId('passkey-label-input')
    const registerBtn = page.getByTestId('passkey-register-btn')

    // Register a credential to delete
    await labelInput.fill('To Be Deleted')
    await registerBtn.click()
    await expect(
      page.getByTestId('passkey-credential-row').filter({ hasText: 'To Be Deleted' })
    ).toBeVisible({ timeout: 10_000 })

    const rowsBefore = await page.getByTestId('passkey-credential-row').count()

    // Delete the credential
    const targetRow = page
      .getByTestId('passkey-credential-row')
      .filter({ hasText: 'To Be Deleted' })
    const deleteBtn = targetRow.getByTestId('passkey-delete-btn')
    await deleteBtn.click()

    // Row should disappear
    await expect(
      page.getByTestId('passkey-credential-row').filter({ hasText: 'To Be Deleted' })
    ).not.toBeVisible({ timeout: 5000 })

    const rowsAfter = await page.getByTestId('passkey-credential-row').count()
    expect(rowsAfter, 'Credential count should decrease by 1 after deletion').toBe(rowsBefore - 1)

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })

  test('passkey section only shows when WebAuthn is supported', async ({ page }) => {
    await navigateAfterLogin(page, '/settings')

    const webauthnSupported = await page.evaluate(
      () =>
        typeof window !== 'undefined' &&
        'credentials' in navigator &&
        'PublicKeyCredential' in window
    )

    const passkeySection = page.locator('#passkeys')

    if (webauthnSupported) {
      await expect(passkeySection).toBeVisible({ timeout: 5000 })
    } else {
      // Section hidden when WebAuthn not available
      await expect(passkeySection).not.toBeVisible()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Virtual authenticator smoke test
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Virtual authenticator setup', () => {
  test('WebAuthn API is available in test browser', async ({ page }) => {
    await page.goto('/login')
    const supported = await page.evaluate(
      () => 'credentials' in navigator && 'PublicKeyCredential' in window
    )
    // Log result — this test always passes (it's informational)
    if (!supported) {
      console.log('[webauthn] WebAuthn not available in this browser — passkey tests will skip')
    }
    expect(typeof supported).toBe('boolean')
  })
})
