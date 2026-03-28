import { text } from 'drizzle-orm/pg-core'
import type { Ciphertext, HmacHash } from '../../shared/crypto-types'

/** Text column storing XChaCha20-Poly1305 ciphertext (hex-encoded nonce || ciphertext) */
export const ciphertext = (name: string) => text(name).$type<Ciphertext>()

/** Text column storing an HMAC-SHA256 hash (hex-encoded) */
export const hmacHashed = (name: string) => text(name).$type<HmacHash>()
