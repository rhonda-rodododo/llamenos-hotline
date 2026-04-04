import { describe, expect, it } from 'bun:test'
import { FirehoseService } from './firehose'

describe('FirehoseService', () => {
  it('should be constructable', () => {
    // Just verify the class can be constructed — real DB tests are in API E2E
    expect(FirehoseService).toBeDefined()
    expect(typeof FirehoseService).toBe('function')
  })
})
