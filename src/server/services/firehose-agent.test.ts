import { describe, expect, it } from 'bun:test'
import { FirehoseAgentService } from './firehose-agent'
import type { DecryptedFirehoseMessage } from './firehose-inference'

// heuristicCluster is a pure method that uses no injected dependencies,
// so we can construct the service with nulls for all args.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service = new FirehoseAgentService(
  null as any,
  null as any,
  null as any,
  null as any,
  null as any,
  null as any,
  null as any,
  '',
  {}
)

function makeMsg(id: string, timestamp: string): DecryptedFirehoseMessage {
  return { id, senderUsername: 'user', content: 'test', timestamp }
}

describe('heuristicCluster', () => {
  it('returns empty array for empty input', () => {
    const result = service.heuristicCluster([])
    expect(result).toEqual([])
  })

  it('handles single message', () => {
    const msg = makeMsg('1', '2026-01-01T00:00:00.000Z')
    const result = service.heuristicCluster([msg])
    expect(result).toHaveLength(1)
    expect(result[0].messages).toHaveLength(1)
    expect(result[0].messages[0].id).toBe('1')
  })

  it('groups messages within 5-minute window', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z')
    const t1 = new Date(t0.getTime() + 2 * 60 * 1000) // +2 min
    const t2 = new Date(t0.getTime() + 4 * 60 * 1000) // +4 min
    const msgs = [
      makeMsg('a', t0.toISOString()),
      makeMsg('b', t1.toISOString()),
      makeMsg('c', t2.toISOString()),
    ]
    const result = service.heuristicCluster(msgs)
    expect(result).toHaveLength(1)
    expect(result[0].messages).toHaveLength(3)
  })

  it('splits messages with >5-minute gap', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z')
    const t1 = new Date(t0.getTime() + 6 * 60 * 1000) // +6 min — new cluster
    const msgs = [makeMsg('a', t0.toISOString()), makeMsg('b', t1.toISOString())]
    const result = service.heuristicCluster(msgs)
    expect(result).toHaveLength(2)
    expect(result[0].messages[0].id).toBe('a')
    expect(result[1].messages[0].id).toBe('b')
  })

  it('handles exact boundary (5 min = same cluster)', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z')
    const t1 = new Date(t0.getTime() + 5 * 60 * 1000) // exactly 5 min
    const msgs = [makeMsg('a', t0.toISOString()), makeMsg('b', t1.toISOString())]
    const result = service.heuristicCluster(msgs)
    expect(result).toHaveLength(1)
    expect(result[0].messages).toHaveLength(2)
  })

  it('sorts messages by timestamp before clustering', () => {
    // Provide messages out of order — should still cluster correctly
    const t0 = new Date('2026-01-01T00:00:00.000Z')
    const t1 = new Date(t0.getTime() + 2 * 60 * 1000)
    const t2 = new Date(t0.getTime() + 10 * 60 * 1000) // new cluster
    // Pass out of order: t2, t0, t1
    const msgs = [
      makeMsg('c', t2.toISOString()),
      makeMsg('a', t0.toISOString()),
      makeMsg('b', t1.toISOString()),
    ]
    const result = service.heuristicCluster(msgs)
    expect(result).toHaveLength(2)
    // First cluster should contain a and b (sorted by time)
    const firstIds = result[0].messages.map((m) => m.id).sort()
    expect(firstIds).toEqual(['a', 'b'])
    // Second cluster should contain c
    expect(result[1].messages[0].id).toBe('c')
  })

  it('assigns baseline confidence of 0.7 to each cluster', () => {
    const msg = makeMsg('1', '2026-01-01T00:00:00.000Z')
    const result = service.heuristicCluster([msg])
    expect(result[0].confidence).toBe(0.7)
  })
})
