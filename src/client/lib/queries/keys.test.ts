import { describe, expect, test } from 'bun:test'
import { queryKeys } from './keys'

describe('queryKeys', () => {
  // --- volunteers ---
  test('volunteers.all is stable', () => {
    expect(queryKeys.volunteers.all).toEqual(['volunteers'])
  })

  test('volunteers.list returns consistent key', () => {
    expect(queryKeys.volunteers.list()).toEqual(['volunteers', 'list'])
    expect(queryKeys.volunteers.list()).toEqual(queryKeys.volunteers.list())
  })

  test('volunteers.detail includes pubkey', () => {
    expect(queryKeys.volunteers.detail('abc123')).toEqual(['volunteers', 'detail', 'abc123'])
  })

  test('volunteers.all is a prefix of list and detail keys', () => {
    const all = queryKeys.volunteers.all
    const list = queryKeys.volunteers.list()
    const detail = queryKeys.volunteers.detail('xyz')
    expect(list.slice(0, all.length)).toEqual([...all])
    expect(detail.slice(0, all.length)).toEqual([...all])
  })

  // --- notes ---
  test('notes.list includes filters in key', () => {
    const filters = { callId: 'call-1', page: 2, limit: 10 }
    const key = queryKeys.notes.list(filters)
    expect(key).toEqual(['notes', 'list', filters])
  })

  test('notes.list with no args uses empty object', () => {
    expect(queryKeys.notes.list()).toEqual(['notes', 'list', {}])
    expect(queryKeys.notes.list(undefined)).toEqual(['notes', 'list', {}])
  })

  test('notes.list with different filters produces different keys', () => {
    const key1 = queryKeys.notes.list({ callId: 'a' })
    const key2 = queryKeys.notes.list({ callId: 'b' })
    expect(key1).not.toEqual(key2)
  })

  // --- calls ---
  test('calls.all is stable', () => {
    expect(queryKeys.calls.all).toEqual(['calls'])
  })

  test('calls.history with different filters produces different keys', () => {
    const key1 = queryKeys.calls.history({ page: 1 })
    const key2 = queryKeys.calls.history({ page: 2 })
    expect(key1).not.toEqual(key2)
  })

  test('calls.history with no args uses empty object', () => {
    expect(queryKeys.calls.history()).toEqual(['calls', 'history', {}])
  })

  test('calls.active returns consistent key', () => {
    expect(queryKeys.calls.active()).toEqual(['calls', 'active'])
  })

  test('calls.detail includes id', () => {
    expect(queryKeys.calls.detail('call-42')).toEqual(['calls', 'detail', 'call-42'])
  })

  test('calls.todayCount returns consistent key', () => {
    expect(queryKeys.calls.todayCount()).toEqual(['calls', 'todayCount'])
  })

  test('calls.all is a prefix of active, history, detail, and todayCount keys', () => {
    const all = queryKeys.calls.all
    const keys = [
      queryKeys.calls.active(),
      queryKeys.calls.history(),
      queryKeys.calls.detail('x'),
      queryKeys.calls.todayCount(),
    ]
    for (const key of keys) {
      expect(key.slice(0, all.length)).toEqual([...all])
    }
  })

  // --- settings ---
  test('settings keys are stable', () => {
    expect(queryKeys.settings.spam()).toEqual(['settings', 'spam'])
    expect(queryKeys.settings.call()).toEqual(['settings', 'call'])
  })

  test('settings keys return consistent values across calls', () => {
    expect(queryKeys.settings.spam()).toEqual(queryKeys.settings.spam())
    expect(queryKeys.settings.transcription()).toEqual(queryKeys.settings.transcription())
    expect(queryKeys.settings.ivrLanguages()).toEqual(queryKeys.settings.ivrLanguages())
    expect(queryKeys.settings.webauthn()).toEqual(queryKeys.settings.webauthn())
    expect(queryKeys.settings.customFields()).toEqual(queryKeys.settings.customFields())
    expect(queryKeys.settings.provider()).toEqual(queryKeys.settings.provider())
    expect(queryKeys.settings.messaging()).toEqual(queryKeys.settings.messaging())
    expect(queryKeys.settings.geocoding()).toEqual(queryKeys.settings.geocoding())
    expect(queryKeys.settings.reportTypes()).toEqual(queryKeys.settings.reportTypes())
    expect(queryKeys.settings.retention()).toEqual(queryKeys.settings.retention())
  })

  // --- invites ---
  test('invites.all is a prefix of list and channels keys', () => {
    const all = queryKeys.invites.all
    expect(queryKeys.invites.list().slice(0, all.length)).toEqual([...all])
    expect(queryKeys.invites.channels().slice(0, all.length)).toEqual([...all])
  })

  // --- contacts ---
  test('contacts.list with filters includes them in key', () => {
    const filters = { contactType: 'individual', riskLevel: 'high' }
    expect(queryKeys.contacts.list(filters)).toEqual(['contacts', 'list', filters])
  })

  test('contacts.list with no args uses empty object', () => {
    expect(queryKeys.contacts.list()).toEqual(['contacts', 'list', {}])
  })

  test('contacts.detail includes id', () => {
    expect(queryKeys.contacts.detail('c-1')).toEqual(['contacts', 'detail', 'c-1'])
  })

  test('contacts.timeline includes id', () => {
    expect(queryKeys.contacts.timeline('c-1')).toEqual(['contacts', 'timeline', 'c-1'])
  })

  test('contacts.all is a prefix of list, detail, timeline, relationships', () => {
    const all = queryKeys.contacts.all
    const keys = [
      queryKeys.contacts.list(),
      queryKeys.contacts.detail('x'),
      queryKeys.contacts.timeline('x'),
      queryKeys.contacts.relationships(),
    ]
    for (const key of keys) {
      expect(key.slice(0, all.length)).toEqual([...all])
    }
  })

  // --- shifts ---
  test('shifts.all is a prefix of list, fallback, myStatus', () => {
    const all = queryKeys.shifts.all
    const keys = [queryKeys.shifts.list(), queryKeys.shifts.fallback(), queryKeys.shifts.myStatus()]
    for (const key of keys) {
      expect(key.slice(0, all.length)).toEqual([...all])
    }
  })

  // --- bans ---
  test('bans.all is a prefix of list', () => {
    const all = queryKeys.bans.all
    expect(queryKeys.bans.list().slice(0, all.length)).toEqual([...all])
  })

  // --- audit ---
  test('audit.list with no args uses empty object', () => {
    expect(queryKeys.audit.list()).toEqual(['audit', 'list', {}])
  })

  test('audit.list with different filters produces different keys', () => {
    expect(queryKeys.audit.list({ page: 1 })).not.toEqual(queryKeys.audit.list({ page: 2 }))
  })

  // --- analytics ---
  test('analytics.callVolume uses null when days not provided', () => {
    expect(queryKeys.analytics.callVolume()).toEqual(['analytics', 'callVolume', null])
  })

  test('analytics.callVolume with different days produces different keys', () => {
    expect(queryKeys.analytics.callVolume(7)).not.toEqual(queryKeys.analytics.callVolume(30))
  })

  // --- prefix matching correctness ---
  test('key factories return arrays starting with their resource name', () => {
    const resourceChecks: [readonly string[], string][] = [
      [queryKeys.volunteers.list(), 'volunteers'],
      [queryKeys.notes.list(), 'notes'],
      [queryKeys.calls.active(), 'calls'],
      [queryKeys.shifts.list(), 'shifts'],
      [queryKeys.bans.list(), 'bans'],
      [queryKeys.blasts.list(), 'blasts'],
      [queryKeys.hubs.list(), 'hubs'],
      [queryKeys.roles.list(), 'roles'],
    ]
    for (const [key, resource] of resourceChecks) {
      expect(key[0]).toBe(resource)
    }
  })

  // --- stability: calling a factory twice returns equal (but not same) arrays ---
  test('factory calls return value-equal arrays each invocation', () => {
    expect(queryKeys.volunteers.list()).toEqual(queryKeys.volunteers.list())
    expect(queryKeys.calls.todayCount()).toEqual(queryKeys.calls.todayCount())
    expect(queryKeys.shifts.myStatus()).toEqual(queryKeys.shifts.myStatus())
    expect(queryKeys.preferences.mine()).toEqual(queryKeys.preferences.mine())
    expect(queryKeys.credentials.mine()).toEqual(queryKeys.credentials.mine())
    expect(queryKeys.provider.health()).toEqual(queryKeys.provider.health())
    expect(queryKeys.presence.list()).toEqual(queryKeys.presence.list())
  })
})
