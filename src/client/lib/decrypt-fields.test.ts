import { describe, expect, test } from 'bun:test'
import { DecryptCache, resolveEncryptedFields } from './decrypt-fields'

describe('DecryptCache', () => {
  test('returns null for unknown keys', () => {
    const cache = new DecryptCache()
    expect(cache.get('abc', 'label')).toBeNull()
  })

  test('stores and retrieves decrypted values', () => {
    const cache = new DecryptCache()
    cache.set('abc', 'label', 'hello')
    expect(cache.get('abc', 'label')).toBe('hello')
  })

  test('clear removes all entries', () => {
    const cache = new DecryptCache()
    cache.set('abc', 'label', 'hello')
    cache.clear()
    expect(cache.get('abc', 'label')).toBeNull()
  })
})

describe('resolveEncryptedFields', () => {
  test('identifies encrypted field pairs from object', () => {
    const obj = {
      name: '[encrypted]',
      encryptedName: 'deadbeef',
      nameEnvelopes: [{ pubkey: 'pk1', wrappedKey: 'wk1', ephemeralPubkey: 'ep1' }],
      id: 'vol-1',
    }
    const fields = resolveEncryptedFields(obj, 'pk1')
    expect(fields).toHaveLength(1)
    expect(fields[0]).toEqual({
      plaintextKey: 'name',
      ciphertext: 'deadbeef',
      envelope: { pubkey: 'pk1', wrappedKey: 'wk1', ephemeralPubkey: 'ep1' },
    })
  })

  test('skips fields without envelopes', () => {
    const obj = { encryptedName: 'deadbeef' }
    expect(resolveEncryptedFields(obj)).toHaveLength(0)
  })

  test('finds multiple encrypted field pairs', () => {
    const obj = {
      encryptedPhone: 'aabb',
      phoneEnvelopes: [{ pubkey: 'pk1', wrappedKey: 'w1', ephemeralPubkey: 'e1' }],
      encryptedReason: 'ccdd',
      reasonEnvelopes: [{ pubkey: 'pk1', wrappedKey: 'w2', ephemeralPubkey: 'e2' }],
    }
    expect(resolveEncryptedFields(obj)).toHaveLength(2)
  })

  test('filters by readerPubkey when provided', () => {
    const obj = {
      encryptedName: 'deadbeef',
      nameEnvelopes: [
        { pubkey: 'pk1', wrappedKey: 'wk1', ephemeralPubkey: 'ep1' },
        { pubkey: 'pk2', wrappedKey: 'wk2', ephemeralPubkey: 'ep2' },
      ],
    }
    const fields = resolveEncryptedFields(obj, 'pk2')
    expect(fields).toHaveLength(1)
    expect(fields[0].envelope.pubkey).toBe('pk2')
  })

  test('returns empty when readerPubkey has no matching envelope', () => {
    const obj = {
      encryptedName: 'deadbeef',
      nameEnvelopes: [{ pubkey: 'pk1', wrappedKey: 'wk1', ephemeralPubkey: 'ep1' }],
    }
    expect(resolveEncryptedFields(obj, 'pk999')).toHaveLength(0)
  })
})
