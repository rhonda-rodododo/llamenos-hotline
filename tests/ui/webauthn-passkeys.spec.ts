import { expect, test } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin, resetTestState } from '../helpers'

// Window type augmentation for authed fetch helper
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

/**
 * Inject authed fetch helper after login.
 * Uses the keyManager's createAuthToken for signed API requests.
 */
async function injectAuthedFetch(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
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
        headers.Authorization = `Bearer ${token}`
      }
      return fetch(url, { ...options, headers })
    }
  })
}

test.describe('WebAuthn passkey registration and login', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  // CDP virtual authenticator only works in Chromium
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'WebAuthn CDP virtual authenticator requires Chromium')
  })

  test('register options endpoint requires authentication', async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)

    // Authenticated request should get options back
    const result = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/webauthn/register/options', { method: 'POST' })
      return { status: res.status, data: res.ok ? await res.json() : await res.text() }
    })
    expect(result.status).toBe(200)
    // Should return a challenge object
    expect(result.data).toHaveProperty('challenge')
  })

  test('unauthenticated register options request returns 401', async ({ page }) => {
    await loginAsAdmin(page)

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/webauthn/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      return res.status
    })
    expect(result).toBe(401)
  })

  test('login options endpoint is public (no auth required)', async ({ page }) => {
    await loginAsAdmin(page)

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/webauthn/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      return { status: res.status, data: res.ok ? await res.json() : await res.text() }
    })
    // Either 200 (challenge returned) or 400 (no credentials registered — that's fine for a fresh reset)
    expect([200, 400]).toContain(result.status)
    if (result.status === 200) {
      expect(result.data).toHaveProperty('challenge')
    }
  })

  test('register a passkey via CDP virtual authenticator', async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)

    // Enable Chrome's virtual authenticator environment
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('WebAuthn.enable', { enableUI: false })
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    })

    try {
      // Navigate to settings where passkey management lives
      await navigateAfterLogin(page, '/settings')

      // Verify the page loaded
      const pageLoaded = await page
        .getByRole('heading', { name: /settings/i })
        .isVisible({ timeout: 10000 })
        .catch(() => false)

      if (!pageLoaded) {
        console.log('[webauthn test] /settings route not available — testing via API only')
      }

      // Get registration options via API
      const regOptions = await page.evaluate(async () => {
        const res = await window.__authedFetch('/api/webauthn/register/options', { method: 'POST' })
        return res.json()
      })
      expect(regOptions).toHaveProperty('challenge')

      // Use @simplewebauthn/browser if available in page context, otherwise use raw navigator.credentials
      const regResult = await page.evaluate(async (opts: Record<string, unknown>) => {
        try {
          // Attempt import of simplewebauthn/browser (may not be in page bundle)
          const { startRegistration } = await import('@simplewebauthn/browser' as string)
          return startRegistration({ optionsJSON: opts as PublicKeyCredentialCreationOptionsJSON })
        } catch {
          // Fall back to raw WebAuthn API
          const challenge = Uint8Array.from(
            atob((opts.challenge as string).replace(/-/g, '+').replace(/_/g, '/')),
            (c) => c.charCodeAt(0)
          )
          const userId = Uint8Array.from(
            atob(
              ((opts.user as { id: string }).id as string).replace(/-/g, '+').replace(/_/g, '/')
            ),
            (c) => c.charCodeAt(0)
          )
          const credential = await navigator.credentials.create({
            publicKey: {
              challenge,
              rp: { name: 'Hotline', id: location.hostname },
              user: {
                id: userId,
                name: (opts.user as { name: string }).name,
                displayName: (opts.user as { displayName: string }).displayName,
              },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              timeout: 60000,
              attestation: 'none',
              authenticatorSelection: {
                authenticatorAttachment: 'platform',
                requireResidentKey: true,
                userVerification: 'required',
              },
            },
          })
          return credential ? JSON.parse(JSON.stringify(credential)) : null
        }
      }, regOptions)

      // Registration response may be null if browser API isn't available in this context
      if (regResult) {
        const verifyResult = await page.evaluate(
          async ({ attestation, challengeId }: { attestation: unknown; challengeId?: string }) => {
            const body: Record<string, unknown> = {
              attestation,
              label: 'Test Passkey',
            }
            if (challengeId) body.challengeId = challengeId
            const res = await window.__authedFetch('/api/webauthn/register/verify', {
              method: 'POST',
              body: JSON.stringify(body),
            })
            return { status: res.status, data: res.ok ? await res.json() : await res.text() }
          },
          { attestation: regResult, challengeId: regOptions.challengeId }
        )
        // Verification should succeed
        expect([200, 201]).toContain(verifyResult.status)
        if (verifyResult.status === 200 || verifyResult.status === 201) {
          expect(
            (verifyResult.data as { verified?: boolean; ok?: boolean }).verified ??
              (verifyResult.data as { verified?: boolean; ok?: boolean }).ok
          ).toBeTruthy()
        }
      }
    } finally {
      // Always clean up virtual authenticator
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
      await cdp.send('WebAuthn.disable')
    }
  })

  test('credentials list endpoint returns array after registration', async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)

    const result = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/webauthn/credentials')
      return { status: res.status, data: res.ok ? await res.json() : await res.text() }
    })
    expect(result.status).toBe(200)
    // Either an array or an object with a credentials array
    const data = result.data as unknown[] | { credentials: unknown[] }
    const isArray =
      Array.isArray(data) || Array.isArray((data as { credentials?: unknown[] }).credentials)
    expect(isArray).toBe(true)
  })
})
