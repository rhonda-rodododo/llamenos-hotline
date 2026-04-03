import { describe, expect, mock, test } from 'bun:test'
import type { Services } from '../services'
import { runRetentionPurge } from './retention-purge'

interface MockServices extends Services {
  gdpr: Services['gdpr'] & {
    getRetentionSettings: ReturnType<typeof mock>
    purgeExpiredData: ReturnType<typeof mock>
  }
  records: Services['records'] & { addAuditEntry: ReturnType<typeof mock> }
}

describe('runRetentionPurge', () => {
  function mockServices(purgeResult: {
    callRecordsDeleted: number
    notesDeleted: number
    messagesDeleted: number
    auditLogDeleted: number
  }): MockServices {
    return {
      gdpr: {
        getRetentionSettings: mock(() =>
          Promise.resolve({
            callRecordsDays: 365,
            notesDays: 365,
            messagesDays: 365,
            auditLogDays: 730,
          })
        ),
        purgeExpiredData: mock(() => Promise.resolve(purgeResult)),
      },
      records: { addAuditEntry: mock(() => Promise.resolve()) },
    } as unknown as MockServices
  }

  test('logs audit when items deleted', async () => {
    const s = mockServices({
      callRecordsDeleted: 5,
      notesDeleted: 3,
      messagesDeleted: 0,
      auditLogDeleted: 0,
    })
    await runRetentionPurge(s)
    expect(s.records.addAuditEntry).toHaveBeenCalledTimes(1)
  })

  test('skips audit when nothing deleted', async () => {
    const s = mockServices({
      callRecordsDeleted: 0,
      notesDeleted: 0,
      messagesDeleted: 0,
      auditLogDeleted: 0,
    })
    await runRetentionPurge(s)
    expect(s.records.addAuditEntry).not.toHaveBeenCalled()
  })

  test('single deletion triggers audit', async () => {
    const s = mockServices({
      callRecordsDeleted: 0,
      notesDeleted: 0,
      messagesDeleted: 0,
      auditLogDeleted: 1,
    })
    await runRetentionPurge(s)
    expect(s.records.addAuditEntry).toHaveBeenCalledTimes(1)
  })
})
