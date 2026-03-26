import { expect, test } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin } from '../helpers'

// Window type augmentation for authed fetch helper
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

/**
 * Inject authed fetch helper after login.
 * Uses the session JWT token stored in localStorage for signed API requests.
 */
async function injectAuthedFetch(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.__authedFetch = async (url: string, options: RequestInit = {}) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      }
      // Use JWT token from localStorage (set during login)
      const token = localStorage.getItem('access_token')
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      return fetch(url, { ...options, headers })
    }
  })
}

test.describe('WebAuthn passkey registration and login', () => {
  test.describe.configure({ mode: 'serial' })

  // CDP virtual authenticator only works in Chromium
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'WebAuthn CDP virtual authenticator requires Chromium')
  })

  test('register options endpoint requires authentication', async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)

    // Authenticated request should get options back
    const result = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/auth/webauthn/register-options', {
        method: 'POST',
        body: JSON.stringify({ label: 'Test Passkey' }),
      })
      return { status: res.status, data: res.ok ? await res.json() : await res.text() }
    })
    expect(result.status).toBe(200)
    // Should return a challenge object
    expect(result.data).toHaveProperty('challenge')
  })

  test('unauthenticated register options request returns 401', async ({ page }) => {
    await loginAsAdmin(page)

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/auth/webauthn/register-options', {
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
      const res = await fetch('/api/auth/webauthn/login-options', {
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
        const res = await window.__authedFetch('/api/auth/webauthn/register-options', {
          method: 'POST',
          body: JSON.stringify({ label: 'Test Passkey' }),
        })
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
            const res = await window.__authedFetch('/api/auth/webauthn/register-verify', {
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
      const res = await window.__authedFetch('/api/auth/devices')
      return { status: res.status, data: res.ok ? await res.json() : await res.text() }
    })
    expect(result.status).toBe(200)
    // Either an array or an object with a credentials array
    const data = result.data as unknown[] | { credentials: unknown[] }
    const isArray =
      Array.isArray(data) || Array.isArray((data as { credentials?: unknown[] }).credentials)
    expect(isArray).toBe(true)
  })

  test('full auth facade flow: register → login-verify returns JWT → userinfo returns nsecSecret', async ({
    page,
  }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)

    // Step 1: Register a passkey via the facade
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
      await navigateAfterLogin(page, '/settings')

      // Get registration options
      const regOptions = await page.evaluate(async () => {
        const res = await window.__authedFetch('/api/auth/webauthn/register-options', {
          method: 'POST',
          body: JSON.stringify({ label: 'Facade Flow Key' }),
        })
        if (!res.ok) throw new Error(`register-options failed: ${res.status}`)
        return res.json()
      })
      expect(regOptions).toHaveProperty('challenge')
      expect(regOptions).toHaveProperty('challengeId')

      // Create credential using raw WebAuthn API (virtual authenticator will auto-confirm)
      const regResult = await page.evaluate(
        async (opts: Record<string, unknown>) => {
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
        },
        regOptions as Record<string, unknown>
      )

      if (!regResult) {
        test.skip(true, 'WebAuthn credential creation unavailable in this context')
        return
      }

      // Step 2: Verify registration
      const verifyRegResult = await page.evaluate(
        async ({ attestation, challengeId }: { attestation: unknown; challengeId: string }) => {
          const res = await window.__authedFetch('/api/auth/webauthn/register-verify', {
            method: 'POST',
            body: JSON.stringify({ attestation, label: 'Facade Flow Key', challengeId }),
          })
          return { status: res.status, data: res.ok ? await res.json() : await res.text() }
        },
        { attestation: regResult, challengeId: regOptions.challengeId as string }
      )
      expect([200, 201]).toContain(verifyRegResult.status)
      expect((verifyRegResult.data as { ok?: boolean }).ok).toBe(true)

      // Step 3: Login via the facade using the registered passkey
      // Get login options (public endpoint)
      const loginOptions = await page.evaluate(async () => {
        const res = await fetch('/api/auth/webauthn/login-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!res.ok) throw new Error(`login-options failed: ${res.status}`)
        return res.json()
      })
      expect(loginOptions).toHaveProperty('challenge')
      expect(loginOptions).toHaveProperty('challengeId')

      // Create assertion (virtual authenticator auto-selects registered credential)
      const assertionResult = await page.evaluate(
        async (opts: Record<string, unknown>) => {
          const challenge = Uint8Array.from(
            atob((opts.challenge as string).replace(/-/g, '+').replace(/_/g, '/')),
            (c) => c.charCodeAt(0)
          )
          const allowCredentials = (
            (opts.allowCredentials as Array<{ id: string; type: string }>) || []
          ).map((cr) => ({
            id: Uint8Array.from(atob(cr.id.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
              c.charCodeAt(0)
            ),
            type: 'public-key' as const,
          }))
          const credential = await navigator.credentials.get({
            publicKey: {
              challenge,
              rpId: location.hostname,
              allowCredentials,
              userVerification: 'required',
              timeout: 60000,
            },
          })
          return credential ? JSON.parse(JSON.stringify(credential)) : null
        },
        loginOptions as Record<string, unknown>
      )

      if (!assertionResult) {
        test.skip(true, 'WebAuthn assertion unavailable in this context')
        return
      }

      // Step 4: Verify login — response must contain a JWT accessToken (not a session token)
      const loginVerifyResult = await page.evaluate(
        async ({ assertion, challengeId }: { assertion: unknown; challengeId: string }) => {
          const res = await fetch('/api/auth/webauthn/login-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assertion, challengeId }),
          })
          return { status: res.status, data: res.ok ? await res.json() : await res.text() }
        },
        { assertion: assertionResult, challengeId: loginOptions.challengeId as string }
      )
      expect(loginVerifyResult.status).toBe(200)

      // Must return a JWT accessToken — not a legacy session token
      const loginData = loginVerifyResult.data as { accessToken?: string; pubkey?: string }
      expect(loginData).toHaveProperty('accessToken')
      expect(loginData).toHaveProperty('pubkey')
      expect(typeof loginData.accessToken).toBe('string')

      // accessToken must be a JWT (3 dot-separated base64url segments)
      const jwtParts = (loginData.accessToken ?? '').split('.')
      expect(jwtParts).toHaveLength(3)

      // Step 5: Use the JWT to call GET /api/auth/userinfo
      const userinfoResult = await page.evaluate(async (token: string) => {
        const res = await fetch('/api/auth/userinfo', {
          headers: { Authorization: `Bearer ${token}` },
        })
        return { status: res.status, data: res.ok ? await res.json() : await res.text() }
      }, loginData.accessToken as string)
      expect(userinfoResult.status).toBe(200)

      // Step 6: Verify nsecSecret is a real 64-char hex string (from Authentik IdP)
      const userinfo = userinfoResult.data as { pubkey?: string; nsecSecret?: string }
      expect(userinfo).toHaveProperty('nsecSecret')
      expect(userinfo).toHaveProperty('pubkey')
      expect(typeof userinfo.nsecSecret).toBe('string')
      expect(userinfo.nsecSecret).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
      await cdp.send('WebAuthn.disable')
    }
  })
})
