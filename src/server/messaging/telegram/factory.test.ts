import { describe, expect, it, mock } from 'bun:test'
import type { TelegramConfig } from '../../../shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import { createTelegramAdapter } from './factory'

function makeCrypto(): CryptoService {
  return {
    hmac: mock((input: string, _prefix: string) => `hmac:${input}`),
  } as unknown as CryptoService
}

describe('createTelegramAdapter', () => {
  const crypto = makeCrypto()

  it('creates TelegramAdapter with valid config', () => {
    const config: TelegramConfig = {
      enabled: true,
      botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      webhookSecret: 'secret',
      botUsername: 'test_bot',
    }

    const adapter = createTelegramAdapter(config, crypto)

    expect(adapter).toBeDefined()
    expect(adapter.channelType).toBe('telegram')
  })

  it('throws when botToken is missing', () => {
    const config = {
      enabled: true,
      botToken: '',
      webhookSecret: 'secret',
    } as TelegramConfig

    expect(() => createTelegramAdapter(config, crypto)).toThrow('Telegram bot token is required')
  })

  it('throws when channel is not enabled', () => {
    const config: TelegramConfig = {
      enabled: false,
      botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    }

    expect(() => createTelegramAdapter(config, crypto)).toThrow('Telegram channel is not enabled')
  })
})
