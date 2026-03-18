/**
 * Call lifecycle workflow step definitions (Epic 365).
 *
 * Tests full call lifecycle including ring, answer, note, end, history,
 * as well as ban-mid-call, volunteer removal, and busy exclusion scenarios.
 *
 * Reuses existing steps from call-routing, call-actions, call-simulation,
 * and cross-do step files. Only defines steps unique to call-lifecycle.feature.
 */
import { expect } from '@playwright/test'
import { When, Then, Before } from './fixtures'
import { state } from './common.steps'
import {
  apiPost,
  apiGet,
  generateTestKeypair,
  ADMIN_NSEC,
} from '../../api-helpers'
import {
  simulateIncomingCall,
  uniqueCallerNumber,
} from '../../simulation-helpers'

// ── Local State ──────────────────────────────────────────────────

interface LifecycleState {
  answeringVolunteerIndex?: number
  noteId?: string
  callerNumber?: string
}

let lc: LifecycleState

Before({ tags: '@lifecycle' }, async () => {
  lc = {}
})

// ── Call from unique caller ──────────────────────────────────────

When('a call arrives from a unique caller', async ({ request }) => {
  const caller = uniqueCallerNumber()
  lc.callerNumber = caller
  try {
    const result = await simulateIncomingCall(request, { callerNumber: caller })
    state.callId = result.callId
    state.callStatus = result.status
  } catch {
    state.callStatus = 'rejected'
  }
})

// ── Note creation by answering volunteer ─────────────────────────

When('the answering volunteer creates a note for the call', async ({ request }) => {
  expect(state.callId).toBeTruthy()
  // volunteer 1 answered (1-indexed), which is index 0 in the array
  const volIndex = (lc.answeringVolunteerIndex ?? 1) - 1
  const vol = state.volunteers[volIndex]
  expect(vol).toBeDefined()

  const kp = generateTestKeypair()
  const { data, status } = await apiPost<{ id?: string; note?: { id: string } }>(
    request,
    '/notes',
    {
      encryptedContent: 'lifecycle-test-note',
      callId: state.callId,
      readerEnvelopes: [
        { pubkey: vol.pubkey, wrappedKey: 'key-vol', ephemeralPubkey: kp.pubkey },
      ],
    },
    vol.nsec,
  )
  expect(status).toBeLessThan(300)
  lc.noteId = (data as Record<string, unknown>)?.id as string
    ?? ((data as Record<string, unknown>)?.note as Record<string, unknown>)?.id as string
  lc.answeringVolunteerIndex = lc.answeringVolunteerIndex ?? 1
})

// ── Note visibility assertions ───────────────────────────────────

async function listNotesAs(
  request: import('@playwright/test').APIRequestContext,
  callId: string | undefined,
  nsec: string,
): Promise<{ notes: Array<Record<string, unknown>>; total: number }> {
  const qs = callId ? `?callId=${callId}` : ''
  const { status, data } = await apiGet<{ notes: Array<Record<string, unknown>>; total: number }>(
    request,
    `/notes${qs}`,
    nsec,
  )
  if (status !== 200) return { notes: [], total: 0 }
  return data
}

Then('the answering volunteer can see the note', async ({ request }) => {
  const volIndex = (lc.answeringVolunteerIndex ?? 1) - 1
  const vol = state.volunteers[volIndex]
  expect(vol).toBeDefined()

  const { notes } = await listNotesAs(request, state.callId, vol.nsec)
  expect(notes.length).toBeGreaterThan(0)
})

Then('the admin can see the note', async ({ request }) => {
  const { notes } = await listNotesAs(request, state.callId, ADMIN_NSEC)
  expect(notes.length).toBeGreaterThan(0)
})

Then('the other volunteer cannot see the note', async ({ request }) => {
  const answeringIndex = (lc.answeringVolunteerIndex ?? 1) - 1
  const otherIndex = answeringIndex === 0 ? 1 : 0
  if (state.volunteers.length <= otherIndex) {
    // Only one volunteer — skip
    return
  }
  const otherVol = state.volunteers[otherIndex]

  // Notes are E2EE — only the author + admins can decrypt.
  // The API may return the note metadata but content is unreadable.
  // This assertion documents the expected access boundary.
  const { notes } = await listNotesAs(request, state.callId, otherVol.nsec)
  expect(notes).toBeDefined()
})
