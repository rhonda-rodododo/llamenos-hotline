/**
 * Volunteer PII Enforcement — Headless API Tests
 *
 * Verifies that phone numbers and real names are visible only to:
 *   - The volunteer themselves (self-view, phone always masked)
 *   - Admins (admin-view, phone masked by default, unmasked via ?unmask=true)
 *
 * Other volunteers must NOT see name or phone of their peers.
 */

import { expect, test } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { ADMIN_NSEC, uniquePhone } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

/** Create a volunteer via admin API, returning pubkey and nsec. */
async function createVolunteer(
  adminApi: AuthedRequest,
  name: string,
  phone: string
): Promise<{ pubkey: string; nsec: string }> {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const nsec = nip19.nsecEncode(sk)

  const res = await adminApi.post('/api/volunteers', {
    name,
    phone,
    roleIds: ['role-volunteer'],
    pubkey,
  })
  if (!res.ok()) {
    throw new Error(`Failed to create volunteer: ${res.status()} ${await res.text()}`)
  }

  return { pubkey, nsec }
}

test.describe('Volunteer PII enforcement', () => {
  test.describe.configure({ mode: 'serial' })

  let adminApi: AuthedRequest

  test.beforeEach(async ({ request }) => {
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  // ─── Test 1: Volunteer list hides other volunteers' names ──────────────────

  test('Volunteer list hides other volunteers name from peer volunteers', async ({ request }) => {
    const targetPhone = uniquePhone()
    const targetName = 'Alice PII Test'

    // Admin creates Volunteer A (the target whose PII we test)
    const volA = await createVolunteer(adminApi, targetName, targetPhone)

    // Admin creates Volunteer B (the peer who should NOT see A's PII)
    const volB = await createVolunteer(adminApi, 'PII Peer B', uniquePhone())

    // Create authed request as Volunteer B
    const volBApi = createAuthedRequestFromNsec(request, volB.nsec)

    // Volunteer B fetches the volunteer list
    const listRes = await volBApi.get('/api/volunteers')
    const listResult = await listRes.json()

    const targetEntry = listResult.volunteers.find(
      (v: { pubkey: string }) => v.pubkey === volA.pubkey
    )
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

  test('Volunteer list does not expose phone number to peer volunteers', async ({ request }) => {
    const alicePhone = uniquePhone()

    const alice = await createVolunteer(adminApi, 'Alice Phone Test', alicePhone)
    const bob = await createVolunteer(adminApi, 'Bob Phone Test', uniquePhone())

    const bobApi = createAuthedRequestFromNsec(request, bob.nsec)

    const listRes = await bobApi.get('/api/volunteers')
    const listResult = await listRes.json()

    const aliceEntry = listResult.volunteers.find(
      (v: { pubkey: string }) => v.pubkey === alice.pubkey
    )
    expect(aliceEntry).toBeDefined()

    // Full phone must NOT appear anywhere in the entry
    const aliceEntryJson = JSON.stringify(aliceEntry)
    expect(aliceEntryJson).not.toContain(alicePhone)
    expect(aliceEntry).not.toHaveProperty('phone')
  })

  // ─── Test 3: Volunteer can see own masked phone via /auth/me ───────────────

  test('Volunteer sees own masked phone in /auth/me', async ({ request }) => {
    const myPhone = uniquePhone()
    const myName = 'Carol Self View'

    const carol = await createVolunteer(adminApi, myName, myPhone)

    const carolApi = createAuthedRequestFromNsec(request, carol.nsec)

    const meRes = await carolApi.get('/api/auth/me')
    const me = await meRes.json()

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

  test('Admin sees volunteer names in list with phones masked', async () => {
    const volPhone = uniquePhone()
    const volName = 'Dave Admin View'

    const vol = await createVolunteer(adminApi, volName, volPhone)

    // Admin fetches volunteer list
    const listRes = await adminApi.get('/api/volunteers')
    const listResult = await listRes.json()

    const volEntry = listResult.volunteers.find((v: { pubkey: string }) => v.pubkey === vol.pubkey)
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

  test('Admin can unmask phone via GET /api/volunteers/:pubkey?unmask=true', async () => {
    const volPhone = uniquePhone()

    const vol = await createVolunteer(adminApi, 'Eve Unmask', volPhone)

    // Admin requests with ?unmask=true
    const unmaskedRes = await adminApi.get(`/api/volunteers/${vol.pubkey}?unmask=true`)
    const unmasked = await unmaskedRes.json()

    expect(unmasked.phone).toBe(volPhone)
    expect(unmasked.view).toBe('admin')
  })

  // ─── Test 6: Non-admin cannot unmask phone ────────────────────────────────

  test('Volunteer cannot unmask another volunteers phone via ?unmask=true', async ({ request }) => {
    const alicePhone = uniquePhone()

    const alice = await createVolunteer(adminApi, 'Alice Unmask Target', alicePhone)
    const bob = await createVolunteer(adminApi, 'Bob Unmask Attacker', uniquePhone())

    const bobApi = createAuthedRequestFromNsec(request, bob.nsec)

    // Bob tries to unmask Alice's phone — should get public view (unmask ignored for non-admin)
    const resultRes = await bobApi.get(`/api/volunteers/${alice.pubkey}?unmask=true`)
    const result = await resultRes.json()

    // Should get public view, not admin view
    expect(result.view).toBe('public')
    // Full phone must not be exposed
    const resultJson = JSON.stringify(result)
    expect(resultJson).not.toContain(alicePhone)
    expect(result).not.toHaveProperty('phone')
  })
})
