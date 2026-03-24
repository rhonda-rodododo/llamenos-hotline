/**
 * E2EE Note Encryption Verification Tests
 *
 * Verifies that call notes are genuinely encrypted at rest — not just UI assertions.
 *
 * Tests:
 *   1.1: Note content is encrypted at rest (plaintext never in raw API response)
 *   1.2: Admin can decrypt their own note via authorEnvelope
 *   1.3: Per-note forward secrecy — two notes have different envelopes
 *   1.4: Unauthorized volunteer cannot decrypt another volunteer's note
 *
 * Requires window.__llamenos_test_crypto (exposed in dev builds via main.tsx).
 */

import { test, expect } from '@playwright/test'
import { getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import {
  ADMIN_NSEC,
  loginAsAdmin,
  navigateAfterLogin,
  resetTestState,
  createVolunteerAndGetNsec,
} from '../helpers'

// Build admin secret key bytes and pubkey from test nsec
const { data: adminSkBytes } = nip19.decode(ADMIN_NSEC) as { type: 'nsec'; data: Uint8Array }
const ADMIN_PUBKEY = getPublicKey(adminSkBytes)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Inject window.__authedFetch using the active key manager session. */
function injectAuthedFetch(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
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

/** Wait for window.__llamenos_test_crypto to be available. */
async function waitForTestCrypto(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => typeof (window as any).__llamenos_test_crypto !== 'undefined',
    { timeout: 10_000 }
  )
}

/**
 * Create an encrypted note via the API and return its ID.
 * Uses page.evaluate() to run the encryption client-side.
 */
async function createEncryptedNote(
  page: import('@playwright/test').Page,
  noteText: string,
  callId: string
): Promise<string> {
  return page.evaluate(
    async ({ text, cid, authorPk }) => {
      const crypto = (window as any).__llamenos_test_crypto
      // Admin is both author and sole admin recipient for simplicity
      const { encryptedContent, authorEnvelope, adminEnvelopes } = crypto.encryptNoteV2(
        { text },
        authorPk,
        [authorPk]
      )
      const res = await window.__authedFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ callId: cid, encryptedContent, authorEnvelope, adminEnvelopes }),
      })
      if (!res.ok) throw new Error(`createNote failed: ${res.status} ${await res.text()}`)
      const note = await res.json()
      return note.id as string
    },
    { text: noteText, cid: callId, authorPk: ADMIN_PUBKEY }
  )
}

/** Fetch raw note list for a callId, returning the notes array. */
async function fetchRawNotes(
  page: import('@playwright/test').Page,
  callId: string
): Promise<Array<{
  id: string
  encryptedContent?: string
  authorEnvelope?: unknown
  adminEnvelopes?: unknown[]
}>> {
  return page.evaluate(async (cid) => {
    const res = await window.__authedFetch(`/api/notes?callId=${encodeURIComponent(cid)}`)
    if (!res.ok) throw new Error(`fetchNotes failed: ${res.status}`)
    const data = await res.json()
    return data.notes ?? data
  }, callId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('E2EE note encryption', () => {
  test.describe.configure({ mode: 'serial' })

  const CALL_ID = `test-call-e2ee-${Date.now()}`
  const NOTE_PLAINTEXT = 'Secret note content for E2EE verification'
  let noteId: string

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/')
    await injectAuthedFetch(page)
    await waitForTestCrypto(page)
  })

  // ── Test 1.1: Note content is encrypted at rest ───────────────────────────

  test('note content is encrypted at rest (plaintext not in raw API response)', async ({ page }) => {
    noteId = await createEncryptedNote(page, NOTE_PLAINTEXT, CALL_ID)
    expect(noteId).toBeTruthy()

    const notes = await fetchRawNotes(page, CALL_ID)
    const note = notes.find((n) => n.id === noteId)
    expect(note).toBeTruthy()

    // Raw API response must NOT contain the plaintext
    const noteJson = JSON.stringify(note)
    expect(noteJson).not.toContain(NOTE_PLAINTEXT)

    // Raw response MUST contain encrypted fields
    expect(note?.encryptedContent).toBeTruthy()
    expect(note?.authorEnvelope).toBeTruthy()
    expect(note?.adminEnvelopes).toBeTruthy()
    expect(Array.isArray(note?.adminEnvelopes)).toBe(true)
  })

  // ── Test 1.2: Admin can decrypt their note via authorEnvelope ─────────────

  test('admin can decrypt their own note using authorEnvelope', async ({ page }) => {
    // Ensure note exists from previous test
    if (!noteId) {
      noteId = await createEncryptedNote(page, NOTE_PLAINTEXT, CALL_ID)
    }

    const notes = await fetchRawNotes(page, CALL_ID)
    const note = notes.find((n) => n.id === noteId)
    expect(note).toBeTruthy()

    // Decrypt in browser context using admin's secret key
    const decrypted = await page.evaluate(
      ({ rawNote }) => {
        const crypto = (window as any).__llamenos_test_crypto
        const km = (window as any).__TEST_KEY_MANAGER
        const secretKey = km.getSecretKey()
        const payload = crypto.decryptNoteV2(
          rawNote.encryptedContent,
          rawNote.authorEnvelope,
          secretKey
        )
        return payload ? payload.text : null
      },
      { rawNote: note as { encryptedContent: string; authorEnvelope: unknown } }
    )

    expect(decrypted).toBe(NOTE_PLAINTEXT)
  })

  // ── Test 1.3: Per-note forward secrecy (unique envelope per note) ─────────

  test('two notes have different authorEnvelopes (per-note forward secrecy)', async ({ page }) => {
    const callId2 = `${CALL_ID}-b`
    const noteId2 = await createEncryptedNote(page, 'Second note for secrecy test', callId2)

    const notes1 = await fetchRawNotes(page, CALL_ID)
    const notes2 = await fetchRawNotes(page, callId2)

    const note1 = notes1.find((n) => n.id === noteId)
    const note2 = notes2.find((n) => n.id === noteId2)

    expect(note1?.authorEnvelope).toBeTruthy()
    expect(note2?.authorEnvelope).toBeTruthy()

    // Envelopes must differ — they wrap different per-note keys
    const env1 = JSON.stringify(note1?.authorEnvelope)
    const env2 = JSON.stringify(note2?.authorEnvelope)
    expect(env1).not.toBe(env2)
  })

  // ── Test 1.4: Unauthorized volunteer cannot decrypt admin's note ──────────

  test('unauthorized volunteer cannot decrypt note (wrong envelope)', async ({ page, request }) => {
    // Create a volunteer — their secret key is different from admin's
    const { nsec: volNsec } = await createVolunteerAndGetNsec(page, request)

    // Fetch raw notes as admin
    const notes = await fetchRawNotes(page, CALL_ID)
    const note = notes.find((n) => n.id === noteId)
    expect(note).toBeTruthy()

    // Attempt decryption using the volunteer's secret key directly in page context
    // (no need to switch sessions — we compute their key from their nsec)
    const decrypted = await page.evaluate(
      async ({ rawNote, volunteerNsec }) => {
        const crypto = (window as any).__llamenos_test_crypto
        // Decode volunteer's nsec to get their secret key bytes
        const { nip19 } = await import('nostr-tools')
        const decoded = nip19.decode(volunteerNsec) as { type: string; data: Uint8Array }
        const volSecretKey = decoded.data
        // Try to decrypt admin's note with volunteer's key — should fail
        const payload = crypto.decryptNoteV2(
          rawNote.encryptedContent,
          rawNote.authorEnvelope,
          volSecretKey
        )
        return payload ? 'DECRYPTED' : 'FAILED_AS_EXPECTED'
      },
      { rawNote: note as { encryptedContent: string; authorEnvelope: unknown }, volunteerNsec: volNsec }
    )

    // The volunteer's key is not in this note's envelopes — decryption must fail
    expect(decrypted).toBe('FAILED_AS_EXPECTED')
  })
})
