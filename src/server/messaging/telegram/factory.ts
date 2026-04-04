import type { TelegramConfig } from '../../../shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import type { MessagingAdapter } from '../adapter'
import { TelegramAdapter } from './adapter'

/**
 * Create a validated TelegramAdapter instance from a TelegramConfig.
 * Throws if any required configuration fields are missing.
 */
export function createTelegramAdapter(
  config: TelegramConfig,
  crypto: CryptoService
): MessagingAdapter {
  if (!config.botToken) {
    throw new Error('Telegram bot token is required')
  }
  if (!config.enabled) {
    throw new Error('Telegram channel is not enabled')
  }
  return new TelegramAdapter(config, crypto)
}
