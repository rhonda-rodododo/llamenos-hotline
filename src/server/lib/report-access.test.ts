import { describe, expect, test } from 'bun:test'
import { isReport, isReportOwner, verifyReportAccess } from './report-access'

describe('verifyReportAccess', () => {
  const report = {
    contactIdentifierHash: 'hash-abc',
    assignedTo: 'volunteer-pubkey',
    metadata: { reporterPubkey: 'reporter-pubkey' },
  }

  test('grants access with reports:read-all permission', () => {
    expect(verifyReportAccess(report, 'anyone', ['reports:read-all'])).toBe(true)
  })

  test('grants access with wildcard permission', () => {
    expect(verifyReportAccess(report, 'anyone', ['*'])).toBe(true)
  })

  test('grants access with reports:read-assigned when assigned to user', () => {
    expect(verifyReportAccess(report, 'volunteer-pubkey', ['reports:read-assigned'])).toBe(true)
  })

  test('denies access with reports:read-assigned when not assigned to user', () => {
    expect(verifyReportAccess(report, 'other-pubkey', ['reports:read-assigned'])).toBe(false)
  })

  test('grants access when user is reporter (metadata.reporterPubkey)', () => {
    expect(verifyReportAccess(report, 'reporter-pubkey', [])).toBe(true)
  })

  test('grants access when user matches contactIdentifierHash (legacy)', () => {
    expect(verifyReportAccess(report, 'hash-abc', [])).toBe(true)
  })

  test('denies access with no matching permission or ownership', () => {
    expect(verifyReportAccess(report, 'stranger', [])).toBe(false)
  })

  test('denies access with unrelated permissions', () => {
    expect(verifyReportAccess(report, 'stranger', ['shifts:read', 'calls:answer'])).toBe(false)
  })

  test('handles report with no assignedTo', () => {
    const noAssign = { contactIdentifierHash: 'hash', metadata: {} }
    expect(verifyReportAccess(noAssign, 'someone', ['reports:read-assigned'])).toBe(false)
  })

  test('handles report with no metadata', () => {
    const noMeta = { contactIdentifierHash: 'hash' }
    expect(verifyReportAccess(noMeta, 'hash', [])).toBe(true)
    expect(verifyReportAccess(noMeta, 'other', [])).toBe(false)
  })
})

describe('isReportOwner', () => {
  test('returns true when reporterPubkey matches', () => {
    const report = {
      contactIdentifierHash: 'different',
      metadata: { reporterPubkey: 'my-key' },
    }
    expect(isReportOwner(report, 'my-key')).toBe(true)
  })

  test('returns true when contactIdentifierHash matches (legacy)', () => {
    const report = { contactIdentifierHash: 'my-key', metadata: {} }
    expect(isReportOwner(report, 'my-key')).toBe(true)
  })

  test('returns false when neither matches', () => {
    const report = {
      contactIdentifierHash: 'hash-a',
      metadata: { reporterPubkey: 'key-b' },
    }
    expect(isReportOwner(report, 'key-c')).toBe(false)
  })

  test('handles undefined metadata', () => {
    const report = { contactIdentifierHash: 'hash' }
    expect(isReportOwner(report, 'other')).toBe(false)
  })
})

describe('isReport', () => {
  test('returns true when metadata.type is report', () => {
    const report = {
      contactIdentifierHash: 'hash',
      metadata: { type: 'report' },
    }
    expect(isReport(report)).toBe(true)
  })

  test('returns false when metadata.type is different', () => {
    const report = {
      contactIdentifierHash: 'hash',
      metadata: { type: 'conversation' },
    }
    expect(isReport(report)).toBe(false)
  })

  test('returns false when no metadata', () => {
    const report = { contactIdentifierHash: 'hash' }
    expect(isReport(report)).toBe(false)
  })

  test('returns false when metadata has no type', () => {
    const report = {
      contactIdentifierHash: 'hash',
      metadata: { foo: 'bar' },
    }
    expect(isReport(report)).toBe(false)
  })
})
