import { afterEach, describe, expect, test } from 'bun:test'
import { clearHubKeyCache, getHubKeyForId } from './hub-key-cache'

describe('hub-key-cache', () => {
  afterEach(() => {
    clearHubKeyCache()
  })

  test('getHubKeyForId returns null for unknown hub', () => {
    expect(getHubKeyForId('hub-unknown')).toBeNull()
  })

  test('clearHubKeyCache resets to empty', () => {
    // Cache is module-level — clearHubKeyCache should bring it to empty
    clearHubKeyCache()
    expect(getHubKeyForId('hub-1')).toBeNull()
  })

  // loadHubKeysForUser is async and depends on API + crypto worker.
  // It's tested via API integration tests (tests/api/) rather than unit tests,
  // since it requires a running server with real hub key envelopes.
})
