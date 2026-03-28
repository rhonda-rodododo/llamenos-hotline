import type { RCSConfig } from '../../../shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import type { MessagingAdapter } from '../adapter'
import { RCSAdapter } from './adapter'

export function createRCSAdapter(config: RCSConfig, crypto: CryptoService): MessagingAdapter {
  return new RCSAdapter(config, crypto)
}
