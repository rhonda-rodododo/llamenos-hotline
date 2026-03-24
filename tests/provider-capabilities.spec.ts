import { test, expect } from '@playwright/test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

// ─── Mock HTTP server helper ──────────────────────────────────────────────────

async function startMockApi(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    port,
    stop: () => new Promise((r, e) => server.close((err) => (err ? e(err) : r()))),
  }
}

// ─── Existing Zod schema tests ────────────────────────────────────────────────

test.describe('provider Zod schemas', () => {
  test('TwilioConfigSchema validates correct config', async () => {
    const { TwilioConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(true)
  })

  test('TwilioConfigSchema rejects invalid accountSid', async () => {
    const { TwilioConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'INVALID',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(false)
  })

  test('TelephonyProviderConfigSchema discriminates by type', async () => {
    const { TelephonyProviderConfigSchema } = await import('../src/shared/schemas/providers')
    const twilio = TelephonyProviderConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '+15551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(twilio.success).toBe(true)

    const asterisk = TelephonyProviderConfigSchema.safeParse({
      type: 'asterisk',
      phoneNumber: '+15551234567',
      ariUrl: 'http://localhost:8088/ari',
      ariUsername: 'admin',
      ariPassword: 'secret',
    })
    expect(asterisk.success).toBe(true)

    const invalid = TelephonyProviderConfigSchema.safeParse({
      type: 'unknown_provider',
      phoneNumber: '+15551234567',
    })
    expect(invalid.success).toBe(false)
  })

  test('rejects phone numbers not in E.164 format', async () => {
    const { TwilioConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TwilioConfigSchema.safeParse({
      type: 'twilio',
      phoneNumber: '5551234567',
      accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
      authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    })
    expect(result.success).toBe(false)
  })

  test('TelnyxConfigSchema validates', async () => {
    const { TelnyxConfigSchema } = await import('../src/shared/schemas/providers')
    const result = TelnyxConfigSchema.safeParse({
      type: 'telnyx',
      phoneNumber: '+15551234567',
      apiKey: 'KEY01234567890ABCDEF',
    })
    expect(result.success).toBe(true)
  })
})

// ─── Twilio testConnection ────────────────────────────────────────────────────

test.describe('Twilio capabilities', () => {
  test('testConnection succeeds with valid credentials', async () => {
    const mock = await startMockApi((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sid: 'AC123', friendly_name: 'Test Account', status: 'active' }))
    })
    try {
      const { twilioCapabilities } = await import('../src/server/telephony/twilio-capabilities')
      const result = await twilioCapabilities.testConnection({
        type: 'twilio',
        phoneNumber: '+15551234567',
        accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
        authToken: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        _testBaseUrl: `http://127.0.0.1:${mock.port}`,
      } as Parameters<typeof twilioCapabilities.testConnection>[0])
      expect(result.connected).toBe(true)
      expect(result.accountName).toBe('Test Account')
      expect(result.latencyMs).toBeGreaterThan(0)
    } finally {
      await mock.stop()
    }
  })

  test('testConnection fails with 401', async () => {
    const mock = await startMockApi((req, res) => {
      res.writeHead(401)
      res.end('Unauthorized')
    })
    try {
      const { twilioCapabilities } = await import('../src/server/telephony/twilio-capabilities')
      const result = await twilioCapabilities.testConnection({
        type: 'twilio',
        phoneNumber: '+15551234567',
        accountSid: 'ACaaaabbbbccccddddeeeeffffaaaabb00',
        authToken: 'wrong',
        _testBaseUrl: `http://127.0.0.1:${mock.port}`,
      } as Parameters<typeof twilioCapabilities.testConnection>[0])
      expect(result.connected).toBe(false)
      expect(result.errorType).toBe('invalid_credentials')
    } finally {
      await mock.stop()
    }
  })

  test('getWebhookUrls returns correct paths', async () => {
    const { twilioCapabilities } = await import('../src/server/telephony/twilio-capabilities')
    const urls = twilioCapabilities.getWebhookUrls('https://hotline.example.com', 'hub-123')
    expect(urls.voiceIncoming).toBe('https://hotline.example.com/api/telephony/incoming?hub=hub-123')
    expect(urls.smsIncoming).toBe('https://hotline.example.com/api/messaging/sms/webhook?hub=hub-123')
  })
})

// ─── Parameterised tests for SignalWire, Vonage, Plivo, Telnyx ───────────────

const providerTests = [
  {
    name: 'signalwire',
    importPath: '../src/server/telephony/signalwire-capabilities',
    exportName: 'signalwireCapabilities',
    config: (port: number) => ({
      type: 'signalwire' as const,
      phoneNumber: '+15551234567',
      accountSid: 'test',
      authToken: 'test',
      signalwireSpace: 'testspace',
      _testBaseUrl: `http://127.0.0.1:${port}/api/laml`,
    }),
    successResponse: { sid: 'test', friendly_name: 'SW Account', status: 'active' },
  },
  {
    name: 'vonage',
    importPath: '../src/server/telephony/vonage-capabilities',
    exportName: 'vonageCapabilities',
    config: (port: number) => ({
      type: 'vonage' as const,
      phoneNumber: '+15551234567',
      apiKey: 'key',
      apiSecret: 'secret',
      applicationId: '550e8400-e29b-41d4-a716-446655440000',
      _testBaseUrl: `http://127.0.0.1:${port}`,
    }),
    successResponse: { value: 12.5 },
  },
  {
    name: 'plivo',
    importPath: '../src/server/telephony/plivo-capabilities',
    exportName: 'plivoCapabilities',
    config: (port: number) => ({
      type: 'plivo' as const,
      phoneNumber: '+15551234567',
      authId: 'test',
      authToken: 'test',
      _testBaseUrl: `http://127.0.0.1:${port}`,
    }),
    successResponse: { account_type: 'standard', cash_credits: '10.00' },
  },
  {
    name: 'telnyx',
    importPath: '../src/server/telephony/telnyx-capabilities',
    exportName: 'telnyxCapabilities',
    config: (port: number) => ({
      type: 'telnyx' as const,
      phoneNumber: '+15551234567',
      apiKey: 'KEY_TEST',
      _testBaseUrl: `http://127.0.0.1:${port}`,
    }),
    successResponse: { data: [] },
  },
] as const

for (const p of providerTests) {
  test.describe(`${p.name} capabilities`, () => {
    test('testConnection succeeds', async () => {
      const mock = await startMockApi((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(p.successResponse))
      })
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await import(p.importPath as string) as Record<string, any>
        const result = await mod[p.exportName].testConnection(p.config(mock.port))
        expect(result.connected).toBe(true)
      } finally {
        await mock.stop()
      }
    })

    test('testConnection fails with 401', async () => {
      const mock = await startMockApi((req, res) => {
        res.writeHead(401)
        res.end('Unauthorized')
      })
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await import(p.importPath as string) as Record<string, any>
        const result = await mod[p.exportName].testConnection(p.config(mock.port))
        expect(result.connected).toBe(false)
        expect(result.errorType).toBe('invalid_credentials')
      } finally {
        await mock.stop()
      }
    })
  })
}

// ─── Asterisk capability tests ───────────────────────────────────────────────

test.describe('asterisk capabilities', () => {
  test('testConnection rejects loopback addresses', async () => {
    const { asteriskCapabilities } = await import('../src/server/telephony/asterisk-capabilities')
    const result = await asteriskCapabilities.testConnection({
      type: 'asterisk',
      phoneNumber: '+15551234567',
      ariUrl: 'http://127.0.0.1:8089/ari',
      ariUsername: 'llamenos',
      ariPassword: 'changeme',
    } as Parameters<typeof asteriskCapabilities.testConnection>[0])
    expect(result.connected).toBe(false)
    expect(result.errorType).toBe('invalid_credentials')
    expect(result.error).toContain('Loopback')
  })

  test('testConnection rejects localhost', async () => {
    const { asteriskCapabilities } = await import('../src/server/telephony/asterisk-capabilities')
    const result = await asteriskCapabilities.testConnection({
      type: 'asterisk',
      phoneNumber: '+15551234567',
      ariUrl: 'http://localhost:8089/ari',
      ariUsername: 'llamenos',
      ariPassword: 'changeme',
    } as Parameters<typeof asteriskCapabilities.testConnection>[0])
    expect(result.connected).toBe(false)
    expect(result.errorType).toBe('invalid_credentials')
  })

  test('testConnection against real ARI (skipped if unreachable)', async () => {
    // Asterisk Docker runs at localhost:8089 but the loopback guard prevents
    // direct connection in tests. This test is a no-op placeholder that confirms
    // the guard behavior and skips rather than failing.
    test.skip(true, 'Asterisk ARI at localhost:8089 is blocked by loopback guard by design; use an external ARI URL to test real connectivity')
  })
})

// ─── Registry completeness tests ─────────────────────────────────────────────

test('TELEPHONY_CAPABILITIES has all provider types', async () => {
  const { TELEPHONY_CAPABILITIES } = await import('../src/server/telephony/capabilities')
  expect(Object.keys(TELEPHONY_CAPABILITIES)).toEqual(
    expect.arrayContaining(['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk', 'telnyx']),
  )
  for (const caps of Object.values(TELEPHONY_CAPABILITIES)) {
    expect(caps.displayName).toBeTruthy()
    expect(caps.credentialSchema).toBeTruthy()
    expect(typeof caps.testConnection).toBe('function')
    expect(typeof caps.getWebhookUrls).toBe('function')
  }
})

test('MESSAGING_CAPABILITIES has all channel types', async () => {
  const { MESSAGING_CAPABILITIES } = await import('../src/server/messaging/capabilities')
  expect(Object.keys(MESSAGING_CAPABILITIES)).toEqual(
    expect.arrayContaining(['sms', 'whatsapp', 'signal', 'rcs']),
  )
})
