import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { generateKeyPair } from './crypto'
import { generateHubKey, wrapHubKeyForMember } from './hub-key-manager'

// ── Mock setup ────────────────────────────────────────────────────────────────
// We must mock './api' before importing the module under test so the module
// resolver picks up the mock at load time.
// IMPORTANT: Spread all real exports so other modules that import from './api'
// still get their exports (e.g. getWebRtcToken used by webrtc/manager.ts).

type EnvelopeResult = {
  wrappedKey: string
  ephemeralPubkey: string
  ephemeralPk?: string
} | null

let mockGetMyHubKeyEnvelope: (hubId: string) => Promise<EnvelopeResult>

const realApi = await import('./api')
mock.module('./api', () => ({
  ...realApi,
  getMyHubKeyEnvelope: (hubId: string) => mockGetMyHubKeyEnvelope(hubId),
}))

// Import after mock is registered
const { clearHubKeyCache, getHubKeyForId, loadHubKeysForUser } = await import('./hub-key-cache')

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a valid ECIES envelope for the given secret key and hub key. */
function makeEnvelope(
  hubKey: Uint8Array,
  secretKey: Uint8Array,
  publicKey: string
): EnvelopeResult {
  const envelope = wrapHubKeyForMember(hubKey, publicKey)
  return {
    wrappedKey: envelope.wrappedKey,
    ephemeralPubkey: envelope.ephemeralPubkey,
  }
}

// ── Reset cache between tests ─────────────────────────────────────────────────

beforeEach(() => {
  clearHubKeyCache()
})

afterEach(() => {
  clearHubKeyCache()
})

// ── D1: getHubKeyForId / clearHubKeyCache ─────────────────────────────────────

describe('getHubKeyForId', () => {
  test('returns null when cache is empty', () => {
    expect(getHubKeyForId('hub-1')).toBeNull()
    expect(getHubKeyForId('nonexistent')).toBeNull()
  })

  test('returns valid key after loadHubKeysForUser', async () => {
    const { secretKey, publicKey } = generateKeyPair()
    const hubKey = generateHubKey()
    const envelope = makeEnvelope(hubKey, secretKey, publicKey)

    mockGetMyHubKeyEnvelope = async () => envelope
    await loadHubKeysForUser(['hub-1'], secretKey)

    const cached = getHubKeyForId('hub-1')
    expect(cached).not.toBeNull()
    expect(cached).toBeInstanceOf(Uint8Array)
    expect(bytesToHex(cached as Uint8Array)).toBe(bytesToHex(hubKey))
  })

  test('returns null after clearHubKeyCache', async () => {
    const { secretKey, publicKey } = generateKeyPair()
    const hubKey = generateHubKey()
    const envelope = makeEnvelope(hubKey, secretKey, publicKey)

    mockGetMyHubKeyEnvelope = async () => envelope
    await loadHubKeysForUser(['hub-1'], secretKey)

    // Verify it's cached
    expect(getHubKeyForId('hub-1')).not.toBeNull()

    clearHubKeyCache()

    // Should be gone now
    expect(getHubKeyForId('hub-1')).toBeNull()
  })
})

// ── D2: loadHubKeysForUser ────────────────────────────────────────────────────

describe('loadHubKeysForUser', () => {
  test('loads and caches keys for multiple hub IDs', async () => {
    const { secretKey, publicKey } = generateKeyPair()
    const hubKey1 = generateHubKey()
    const hubKey2 = generateHubKey()

    mockGetMyHubKeyEnvelope = async (hubId: string) => {
      if (hubId === 'hub-a') return makeEnvelope(hubKey1, secretKey, publicKey)
      if (hubId === 'hub-b') return makeEnvelope(hubKey2, secretKey, publicKey)
      return null
    }

    await loadHubKeysForUser(['hub-a', 'hub-b'], secretKey)

    const cached1 = getHubKeyForId('hub-a')
    const cached2 = getHubKeyForId('hub-b')

    expect(cached1).not.toBeNull()
    expect(cached2).not.toBeNull()
    expect(bytesToHex(cached1 as Uint8Array)).toBe(bytesToHex(hubKey1))
    expect(bytesToHex(cached2 as Uint8Array)).toBe(bytesToHex(hubKey2))
  })

  test('handles API failure gracefully — one hub fails, other still cached', async () => {
    const { secretKey, publicKey } = generateKeyPair()
    const hubKey = generateHubKey()

    mockGetMyHubKeyEnvelope = async (hubId: string) => {
      if (hubId === 'hub-ok') return makeEnvelope(hubKey, secretKey, publicKey)
      // hub-fail throws
      throw new Error('Network error')
    }

    // Should not throw even though one hub fails
    await expect(loadHubKeysForUser(['hub-ok', 'hub-fail'], secretKey)).resolves.toBeUndefined()

    // hub-ok should still be cached
    expect(getHubKeyForId('hub-ok')).not.toBeNull()
    expect(bytesToHex(getHubKeyForId('hub-ok') as Uint8Array)).toBe(bytesToHex(hubKey))

    // hub-fail should be absent
    expect(getHubKeyForId('hub-fail')).toBeNull()
  })

  test('no-ops when hubIds array is empty', async () => {
    const { secretKey } = generateKeyPair()
    let called = false
    mockGetMyHubKeyEnvelope = async () => {
      called = true
      return null
    }

    await loadHubKeysForUser([], secretKey)
    expect(called).toBe(false)
  })
})

// ── D3: Generation counter — stale prevention ─────────────────────────────────

describe('generation counter (stale prevention)', () => {
  test('keys are NOT cached when clearHubKeyCache is called during an in-flight fetch', async () => {
    const { secretKey, publicKey } = generateKeyPair()
    const hubKey = generateHubKey()

    let resolveEnvelope!: (value: EnvelopeResult) => void

    mockGetMyHubKeyEnvelope = () =>
      new Promise<EnvelopeResult>((resolve) => {
        resolveEnvelope = resolve
      })

    // Start the load but do NOT await it yet
    const loadPromise = loadHubKeysForUser(['hub-stale'], secretKey)

    // Clear the cache while the fetch is in-flight — this bumps the generation
    clearHubKeyCache()

    // Now resolve the pending fetch with a valid envelope
    resolveEnvelope(makeEnvelope(hubKey, secretKey, publicKey))

    // Wait for the load to finish
    await loadPromise

    // The key should NOT have been cached because the generation changed
    expect(getHubKeyForId('hub-stale')).toBeNull()
  })
})
