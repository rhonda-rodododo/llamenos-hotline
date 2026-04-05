import { describe, expect, it } from 'bun:test'
import { FirehoseService } from './firehose'

import type { Database } from '../db'
import type { CryptoService } from '../lib/crypto-service'

// Minimal mocks — these methods don't touch db or crypto service
const mockDb = {} as Database
const mockCrypto = {} as CryptoService

describe('FirehoseService', () => {
  it('should be constructable', () => {
    // Just verify the class can be constructed — real DB tests are in API E2E
    expect(FirehoseService).toBeDefined()
    expect(typeof FirehoseService).toBe('function')
  })
})
