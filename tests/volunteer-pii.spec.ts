/**
 * Volunteer PII Enforcement — E2E Tests
 *
 * Verifies that phone numbers and real names are visible only to:
 *   - The volunteer themselves (self-view, phone always masked)
 *   - Admins (admin-view, phone masked by default, unmasked via ?unmask=true)
 *
 * Other volunteers must NOT see name or phone of their peers.
 */

import { test, expect } from '@playwright/test'
import { loginAsAdmin, loginAsVolunteer, resetTestState, uniquePhone } from './helpers'

// Window type augmentation for authed fetch helper
declare global {
  interface Window {
    __authedFetch: (url: string, options?: RequestInit) => Promise<Response>
  }
}

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
        headers['Authorization'] = `Bearer ${token}`
      }
      return fetch(url, { ...options, headers })
    }
  })
}

test.describe('Volunteer PII enforcement', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await injectAuthedFetch(page)
  })

  // ─── Test 1: Volunteer list hides other volunteers' names ──────────────────

  test('Volunteer list hides other volunteers name from peer volunteers', async ({ page }) => {
    const targetPhone = uniquePhone()
    const targetName = 'Alice PII Test'

    // Admin creates Volunteer A (the target whose PII we test)
    const { targetPubkey, volBNsec } = await page.evaluate(
      async ({ name, phone, phoneB }: { name: string; phone: string; phoneB: string }) => {
        const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
        const { nip19 } = await import('nostr-tools')

        const skA = generateSecretKey()
        const pubkeyA = getPublicKey(skA)
        await window.__authedFetch('/api/volunteers', {
          method: 'POST',
          body: JSON.stringify({ name, phone, roleIds: ['role-volunteer'], pubkey: pubkeyA }),
        })

        const skB = generateSecretKey()
        const pubkeyB = getPublicKey(skB)
        const nsecB = nip19.nsecEncode(skB)
        await window.__authedFetch('/api/volunteers', {
          method: 'POST',
          body: JSON.stringify({ name: 'PII Peer B', phone: phoneB, roleIds: ['role-volunteer'], pubkey: pubkeyB }),
        })

        return { targetPubkey: pubkeyA, volBNsec: nsecB }
      },
      { name: targetName, phone: targetPhone, phoneB: uniquePhone() }
    )

    // Login as Volunteer B
    await loginAsVolunteer(page, volBNsec)
    await injectAuthedFetch(page)

    // Volunteer B fetches the volunteer list
    const listResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/volunteers')
      return res.json()
    })

    const targetEntry = listResult.volunteers.find((v: { pubkey: string }) => v.pubkey === targetPubkey)
    expect(targetEntry).toBeDefined()

    // Name must NOT be visible to peer volunteer
    expect(targetEntry).not.toHaveProperty('name')
    // Phone must NOT be visible to peer volunteer
    expect(targetEntry).not.toHaveProperty('phone')
    // Public fields are still available
    expect(targetEntry).toHaveProperty('pubkey')
    expect(targetEntry).toHaveProperty('roles')
    expect(targetEntry).toHaveProperty('spokenLanguages')
    expect(targetEntry).toHaveProperty('onBreak')
    // View discriminant
    expect(targetEntry.view).toBe('public')
  })

  // ─── Test 2: Volunteer list hides phone numbers from peers ────────────────

  test('Volunteer list does not expose phone number to peer volunteers', async ({ page }) => {
    const alicePhone = uniquePhone()

    const { alicePubkey, bobNsec } = await page.evaluate(
      async ({ phone, phoneB }: { phone: string; phoneB: string }) => {
        const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
        const { nip19 } = await import('nostr-tools')

        const skA = generateSecretKey()
        const pubA = getPublicKey(skA)
        await window.__authedFetch('/api/volunteers', {
          method: 'POST',
          body: JSON.stringify({ name: 'Alice Phone Test', phone, roleIds: ['role-volunteer'], pubkey: pubA }),
        })

        const skB = generateSecretKey()
        const pubB = getPublicKey(skB)
        const nsecB = nip19.nsecEncode(skB)
        await window.__authedFetch('/api/volunteers', {
          method: 'POST',
          body: JSON.stringify({ name: 'Bob Phone Test', phone: phoneB, roleIds: ['role-volunteer'], pubkey: pubB }),
        })

        return { alicePubkey: pubA, bobNsec: nsecB }
      },
      { phone: alicePhone, phoneB: uniquePhone() }
    )

    await loginAsVolunteer(page, bobNsec)
    await injectAuthedFetch(page)

    const listResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/volunteers')
      return res.json()
    })

    const aliceEntry = listResult.volunteers.find((v: { pubkey: string }) => v.pubkey === alicePubkey)
    expect(aliceEntry).toBeDefined()

    // Full phone must NOT appear anywhere in the entry
    const aliceEntryJson = JSON.stringify(aliceEntry)
    expect(aliceEntryJson).not.toContain(alicePhone)
    expect(aliceEntry).not.toHaveProperty('phone')
  })

  // ─── Test 3: Volunteer can see own masked phone via /auth/me ───────────────

  test('Volunteer sees own masked phone in /auth/me', async ({ page }) => {
    const myPhone = uniquePhone()
    const myName = 'Carol Self View'

    const { myNsec } = await page.evaluate(
      async ({ name, phone }: { name: string; phone: string }) => {
        const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
        const { nip19 } = await import('nostr-tools')

        const sk = generateSecretKey()
        const pubkey = getPublicKey(sk)
        const nsec = nip19.nsecEncode(sk)
        await window.__authedFetch('/api/volunteers', {
          method: 'POST',
          body: JSON.stringify({ name, phone, roleIds: ['role-volunteer'], pubkey }),
        })
        return { myNsec: nsec }
      },
      { name: myName, phone: myPhone }
    )

    await loginAsVolunteer(page, myNsec)
    await injectAuthedFetch(page)

    const me = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/auth/me')
      return res.json()
    })

    // Own name is visible
    expect(me.name).toBe(myName)
    // Own phone is present but masked (not plaintext)
    expect(me).toHaveProperty('phone')
    expect(me.phone).not.toBe(myPhone)
    // Masked phone should not contain the full digits
    expect(me.phone).toContain('•')
    // Last 2 digits should still be visible
    expect(me.phone).toContain(myPhone.slice(-2))
  })

  // ─── Test 4: Admin sees all volunteer names (phones masked) ───────────────

  test('Admin sees volunteer names in list with phones masked', async ({ page }) => {
    const volPhone = uniquePhone()
    const volName = 'Dave Admin View'

    const volPubkey = await page.evaluate(
      async ({ name, phone }: { name: string; phone: string }) => {
        const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')

        const sk = generateSecretKey()
        const pub = getPublicKey(sk)
        await window.__authedFetch('/api/volunteers', {
          method: 'POST',
          body: JSON.stringify({ name, phone, roleIds: ['role-volunteer'], pubkey: pub }),
        })
        return pub
      },
      { name: volName, phone: volPhone }
    )

    // Admin is already logged in (beforeEach)
    const listResult = await page.evaluate(async () => {
      const res = await window.__authedFetch('/api/volunteers')
      return res.json()
    })

    const volEntry = listResult.volunteers.find((v: { pubkey: string }) => v.pubkey === volPubkey)
    expect(volEntry).toBeDefined()

    // Admin can see the name
    expect(volEntry.name).toBe(volName)
    // Admin view discriminant
    expect(volEntry.view).toBe('admin')
    // Phone is present but masked
    expect(volEntry).toHaveProperty('phone')
    expect(volEntry.phone).not.toBe(volPhone)
    expect(volEntry.phone).not.toContain(volPhone.slice(3, -2))
  })

  // ─── Test 5: Admin can unmask phone via ?unmask=true ──────────────────────

  test('Admin can unmask phone via GET /api/volunteers/:pubkey?unmask=true', async ({ page }) => {
    const volPhone = uniquePhone()

    const volPubkey = await page.evaluate(
      async ({ phone }: { phone: string }) => {
        const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')

        const sk = generateSecretKey()
        const pub = getPublicKey(sk)
        await window.__authedFetch('/api/volunteers', {
          method: 'POST',
          body: JSON.stringify({ name: 'Eve Unmask', phone, roleIds: ['role-volunteer'], pubkey: pub }),
        })
        return pub
      },
      { phone: volPhone }
    )

    // Admin requests with ?unmask=true
    const unmasked = await page.evaluate(async (pubkey: string) => {
      const res = await window.__authedFetch(`/api/volunteers/${pubkey}?unmask=true`)
      return res.json()
    }, volPubkey)

    expect(unmasked.phone).toBe(volPhone)
    expect(unmasked.view).toBe('admin')
  })

  // ─── Test 6: Non-admin cannot unmask phone ────────────────────────────────

  test('Volunteer cannot unmask another volunteers phone via ?unmask=true', async ({ page }) => {
    const alicePhone = uniquePhone()

    const { alicePubkey, bobNsec } = await page.evaluate(
      async ({ phone, phoneB }: { phone: string; phoneB: string }) => {
        const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
        const { nip19 } = await import('nostr-tools')

        const skA = generateSecretKey()
        const pubA = getPublicKey(skA)
        await window.__authedFetch('/api/volunteers', {
          method: 'POST',
          body: JSON.stringify({ name: 'Alice Unmask Target', phone, roleIds: ['role-volunteer'], pubkey: pubA }),
        })

        const skB = generateSecretKey()
        const pubB = getPublicKey(skB)
        const nsecB = nip19.nsecEncode(skB)
        await window.__authedFetch('/api/volunteers', {
          method: 'POST',
          body: JSON.stringify({ name: 'Bob Unmask Attacker', phone: phoneB, roleIds: ['role-volunteer'], pubkey: pubB }),
        })

        return { alicePubkey: pubA, bobNsec: nsecB }
      },
      { phone: alicePhone, phoneB: uniquePhone() }
    )

    // Login as Bob (non-admin)
    await loginAsVolunteer(page, bobNsec)
    await injectAuthedFetch(page)

    // Bob tries to unmask Alice's phone — should get public view (unmask ignored for non-admin)
    const result = await page.evaluate(async (pubkey: string) => {
      const res = await window.__authedFetch(`/api/volunteers/${pubkey}?unmask=true`)
      return res.json()
    }, alicePubkey)

    // Should get public view, not admin view
    expect(result.view).toBe('public')
    // Full phone must not be exposed
    const resultJson = JSON.stringify(result)
    expect(resultJson).not.toContain(alicePhone)
    expect(result).not.toHaveProperty('phone')
  })
})
