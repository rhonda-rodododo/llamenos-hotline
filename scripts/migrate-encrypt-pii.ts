/**
 * One-time PII backfill migration (Task 10).
 *
 * NOTE: This script references plaintext columns (name, phone, reason, etc.)
 * that have been dropped in Task 12. It must be run BEFORE the Task 12 migration
 * that drops those columns. On a fresh database, this script is not needed.
 *
 * Encrypts all existing plaintext values in the database using the same
 * encryption strategy as the service layer. Safe to re-run — uses
 * isNull(encryptedColumn) guards for idempotency.
 *
 * Usage:
 *   bun run scripts/migrate-encrypt-pii.ts
 */

import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { createDatabase } from '../src/server/db'
import {
  activeCalls,
  bans,
  callLegs,
  callRecords,
  conversations,
  geocodingConfig,
  inviteCodes,
  providerConfig,
  pushSubscriptions,
  signalRegistrationPending,
  volunteers,
  webauthnCredentials,
} from '../src/server/db/schema'
import { CryptoService } from '../src/server/lib/crypto-service'
import {
  HMAC_PHONE_PREFIX,
  LABEL_EPHEMERAL_CALL,
  LABEL_PROVIDER_CREDENTIAL_WRAP,
  LABEL_PUSH_CREDENTIAL,
  LABEL_SERVER_NOSTR_KEY,
  LABEL_SERVER_NOSTR_KEY_INFO,
  LABEL_VOLUNTEER_PII,
} from '../src/shared/crypto-labels'
import { hkdfDerive } from '../src/shared/crypto-primitives'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isValidPubkey = (pk: string) => /^[0-9a-f]{64}$/i.test(pk)

function log(msg: string) {
  console.log(`[migrate-encrypt-pii] ${msg}`)
}

/**
 * Read a secret from /run/secrets/ (Docker secrets) or fall back to env var.
 * Duplicated here to avoid importing loadEnv() which eagerly initialises
 * storage and transcription services (which require credentials we may not
 * have in a migration context).
 */
function readSecret(name: string, envKey?: string): string {
  const fs = require('node:fs') as typeof import('node:fs')
  const filePath = `/run/secrets/${name}`
  try {
    return fs.readFileSync(filePath, 'utf-8').trim()
  } catch {
    const key = envKey || name.toUpperCase().replace(/-/g, '_')
    return process.env[key] || ''
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Load the subset of env vars we actually need
  const DATABASE_URL = readSecret('database-url', 'DATABASE_URL')
  const SERVER_NOSTR_SECRET = readSecret('server-nostr-secret', 'SERVER_NOSTR_SECRET')
  const HMAC_SECRET = readSecret('hmac-secret', 'HMAC_SECRET')
  const ADMIN_PUBKEY = readSecret('admin-pubkey', 'ADMIN_PUBKEY')

  if (!DATABASE_URL) {
    console.error('[migrate-encrypt-pii] ERROR: DATABASE_URL is not set — aborting')
    process.exit(1)
  }
  if (!SERVER_NOSTR_SECRET) {
    console.error('[migrate-encrypt-pii] ERROR: SERVER_NOSTR_SECRET is not set — aborting')
    process.exit(1)
  }
  if (!HMAC_SECRET) {
    console.error('[migrate-encrypt-pii] ERROR: HMAC_SECRET is not set — aborting')
    process.exit(1)
  }

  // 2. Create DB and CryptoService
  let db: ReturnType<typeof createDatabase>
  try {
    db = createDatabase(DATABASE_URL)
  } catch (err) {
    console.error('[migrate-encrypt-pii] ERROR: Failed to create database:', err)
    process.exit(1)
  }

  const crypto = new CryptoService(SERVER_NOSTR_SECRET, HMAC_SECRET)

  // 3. Derive server pubkey for E2EE bootstrap envelopes
  const serverPrivateKey = hkdfDerive(
    hexToBytes(SERVER_NOSTR_SECRET),
    utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
    utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
    32
  )
  const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))

  // Admin pubkey for E2EE envelopes (may be absent in dev)
  const adminPubkey = ADMIN_PUBKEY && isValidPubkey(ADMIN_PUBKEY) ? ADMIN_PUBKEY : null
  if (!adminPubkey) {
    log('WARN: ADMIN_PUBKEY not set or invalid — admin will not receive E2EE envelopes')
  }

  const adminPubkeys = adminPubkey ? [adminPubkey] : []

  log(`Server pubkey: ${serverPubkey}`)
  log(`Admin pubkey:  ${adminPubkey ?? '(none)'}`)

  // -------------------------------------------------------------------------
  // Run migration — wrap in try/catch so errors are surfaced cleanly
  // -------------------------------------------------------------------------
  try {
    // -----------------------------------------------------------------------
    // volunteers.name → encryptedName + nameEnvelopes  (E2EE envelope)
    // volunteers.phone → encryptedPhone  (server-key)
    // -----------------------------------------------------------------------
    {
      const rows = await db.select().from(volunteers).where(isNull(volunteers.encryptedName))

      log(`volunteers: ${rows.length} rows need encryptedName migration`)
      for (const row of rows) {
        if (!row.name) continue

        // E2EE: recipients = server + admins + the volunteer themselves
        const recipients = [serverPubkey, ...adminPubkeys]
        if (isValidPubkey(row.pubkey)) recipients.push(row.pubkey)

        const nameEnv = crypto.envelopeEncrypt(row.name, recipients, LABEL_VOLUNTEER_PII)
        const encryptedPhone = row.phone
          ? crypto.serverEncrypt(row.phone, LABEL_VOLUNTEER_PII)
          : undefined

        await db
          .update(volunteers)
          .set({
            encryptedName: nameEnv.encrypted,
            nameEnvelopes: nameEnv.envelopes,
            ...(encryptedPhone !== undefined ? { encryptedPhone } : {}),
          })
          .where(eq(volunteers.pubkey, row.pubkey))
      }
      log('volunteers: done')
    }

    // -----------------------------------------------------------------------
    // bans.phone → encryptedPhone + phoneEnvelopes + phoneHash  (E2EE + HMAC)
    // bans.reason → encryptedReason + reasonEnvelopes  (E2EE)
    // -----------------------------------------------------------------------
    {
      const rows = await db.select().from(bans).where(isNull(bans.encryptedPhone))

      log(`bans: ${rows.length} rows need migration`)
      for (const row of rows) {
        const recipients = [serverPubkey, ...adminPubkeys]

        const phoneEnv = crypto.envelopeEncrypt(row.phone, recipients, LABEL_VOLUNTEER_PII)
        const phoneHash = crypto.hmac(row.phone, HMAC_PHONE_PREFIX)
        const reasonEnv = row.reason
          ? crypto.envelopeEncrypt(row.reason, recipients, LABEL_VOLUNTEER_PII)
          : null

        await db
          .update(bans)
          .set({
            encryptedPhone: phoneEnv.encrypted,
            phoneEnvelopes: phoneEnv.envelopes,
            phoneHash,
            ...(reasonEnv
              ? { encryptedReason: reasonEnv.encrypted, reasonEnvelopes: reasonEnv.envelopes }
              : {}),
          })
          .where(eq(bans.id, row.id))
      }
      log('bans: done')
    }

    // -----------------------------------------------------------------------
    // invite_codes.name → encryptedName + nameEnvelopes  (E2EE)
    // invite_codes.phone → encryptedPhone  (server-key)
    // -----------------------------------------------------------------------
    {
      const rows = await db.select().from(inviteCodes).where(isNull(inviteCodes.encryptedName))

      log(`invite_codes: ${rows.length} rows need migration`)
      for (const row of rows) {
        const recipients = [serverPubkey, ...adminPubkeys]
        const nameEnv = crypto.envelopeEncrypt(row.name, recipients, LABEL_VOLUNTEER_PII)
        const encryptedPhone = row.phone
          ? crypto.serverEncrypt(row.phone, LABEL_VOLUNTEER_PII)
          : undefined

        await db
          .update(inviteCodes)
          .set({
            encryptedName: nameEnv.encrypted,
            nameEnvelopes: nameEnv.envelopes,
            ...(encryptedPhone !== undefined ? { encryptedPhone } : {}),
          })
          .where(eq(inviteCodes.code, row.code))
      }
      log('invite_codes: done')
    }

    // -----------------------------------------------------------------------
    // call_records.callerLast4 → encryptedCallerLast4 + callerLast4Envelopes  (E2EE)
    // -----------------------------------------------------------------------
    {
      const rows = await db
        .select()
        .from(callRecords)
        .where(and(isNull(callRecords.encryptedCallerLast4), isNotNull(callRecords.callerLast4)))

      log(`call_records: ${rows.length} rows need migration`)
      for (const row of rows) {
        if (!row.callerLast4) continue
        const recipients = [serverPubkey, ...adminPubkeys]
        const env = crypto.envelopeEncrypt(row.callerLast4, recipients, LABEL_VOLUNTEER_PII)

        await db
          .update(callRecords)
          .set({
            encryptedCallerLast4: env.encrypted,
            callerLast4Envelopes: env.envelopes,
          })
          .where(eq(callRecords.id, row.id))
      }
      log('call_records: done')
    }

    // -----------------------------------------------------------------------
    // conversations.contactLast4 → encryptedContactLast4 + contactLast4Envelopes  (E2EE)
    // -----------------------------------------------------------------------
    {
      const rows = await db
        .select()
        .from(conversations)
        .where(
          and(isNull(conversations.encryptedContactLast4), isNotNull(conversations.contactLast4))
        )

      log(`conversations: ${rows.length} rows need migration`)
      for (const row of rows) {
        if (!row.contactLast4) continue
        const recipients = [serverPubkey, ...adminPubkeys]
        // Include assignedTo volunteer if present and valid
        if (row.assignedTo && isValidPubkey(row.assignedTo)) {
          recipients.push(row.assignedTo)
        }
        const env = crypto.envelopeEncrypt(row.contactLast4, recipients, LABEL_VOLUNTEER_PII)

        await db
          .update(conversations)
          .set({
            encryptedContactLast4: env.encrypted,
            contactLast4Envelopes: env.envelopes,
          })
          .where(eq(conversations.id, row.id))
      }
      log('conversations: done')
    }

    // -----------------------------------------------------------------------
    // push_subscriptions.deviceLabel → encryptedDeviceLabel + deviceLabelEnvelopes  (E2EE)
    // push_subscriptions.endpoint → encryptedEndpoint + endpointHash  (server-key + HMAC)
    // push_subscriptions.authKey → encryptedAuthKey  (server-key)
    // push_subscriptions.p256dhKey → encryptedP256dhKey  (server-key)
    // -----------------------------------------------------------------------
    {
      const rows = await db
        .select()
        .from(pushSubscriptions)
        .where(isNull(pushSubscriptions.encryptedEndpoint))

      log(`push_subscriptions: ${rows.length} rows need migration`)
      for (const row of rows) {
        const encryptedEndpoint = crypto.serverEncrypt(row.endpoint, LABEL_PUSH_CREDENTIAL)
        const encryptedAuthKey = crypto.serverEncrypt(row.authKey, LABEL_PUSH_CREDENTIAL)
        const encryptedP256dhKey = crypto.serverEncrypt(row.p256dhKey, LABEL_PUSH_CREDENTIAL)
        const endpointHash = crypto.hmac(row.endpoint, HMAC_PHONE_PREFIX)

        let deviceLabelUpdate: {
          encryptedDeviceLabel?: ReturnType<CryptoService['envelopeEncrypt']>['encrypted']
          deviceLabelEnvelopes?: ReturnType<CryptoService['envelopeEncrypt']>['envelopes']
        } = {}

        if (row.deviceLabel && isValidPubkey(row.pubkey)) {
          const labelEnv = crypto.envelopeEncrypt(
            row.deviceLabel,
            [row.pubkey],
            LABEL_VOLUNTEER_PII
          )
          deviceLabelUpdate = {
            encryptedDeviceLabel: labelEnv.encrypted,
            deviceLabelEnvelopes: labelEnv.envelopes,
          }
        }

        await db
          .update(pushSubscriptions)
          .set({
            encryptedEndpoint,
            encryptedAuthKey,
            encryptedP256dhKey,
            endpointHash,
            ...deviceLabelUpdate,
          })
          .where(eq(pushSubscriptions.id, row.id))
      }
      log('push_subscriptions: done')
    }

    // -----------------------------------------------------------------------
    // webauthn_credentials.label → encryptedLabel + labelEnvelopes  (E2EE)
    // -----------------------------------------------------------------------
    {
      const rows = await db
        .select()
        .from(webauthnCredentials)
        .where(isNull(webauthnCredentials.encryptedLabel))

      log(`webauthn_credentials: ${rows.length} rows need migration`)
      for (const row of rows) {
        if (!row.label || !isValidPubkey(row.pubkey)) continue
        const env = crypto.envelopeEncrypt(row.label, [row.pubkey], LABEL_VOLUNTEER_PII)

        await db
          .update(webauthnCredentials)
          .set({
            encryptedLabel: env.encrypted,
            labelEnvelopes: env.envelopes,
          })
          .where(eq(webauthnCredentials.id, row.id))
      }
      log('webauthn_credentials: done')
    }

    // -----------------------------------------------------------------------
    // active_calls.callerNumber → encryptedCallerNumber  (server-key)
    // -----------------------------------------------------------------------
    {
      const rows = await db
        .select()
        .from(activeCalls)
        .where(isNull(activeCalls.encryptedCallerNumber))

      log(`active_calls: ${rows.length} rows need migration`)
      for (const row of rows) {
        if (!row.callerNumber) continue
        const encryptedCallerNumber = crypto.serverEncrypt(row.callerNumber, LABEL_EPHEMERAL_CALL)

        await db
          .update(activeCalls)
          .set({ encryptedCallerNumber })
          .where(eq(activeCalls.callSid, row.callSid))
      }
      log('active_calls: done')
    }

    // -----------------------------------------------------------------------
    // call_legs.phone → encryptedPhone  (server-key)
    // -----------------------------------------------------------------------
    {
      const rows = await db
        .select()
        .from(callLegs)
        .where(and(isNull(callLegs.encryptedPhone), isNotNull(callLegs.phone)))

      log(`call_legs: ${rows.length} rows need migration`)
      for (const row of rows) {
        if (!row.phone) continue
        const encryptedPhone = crypto.serverEncrypt(row.phone, LABEL_EPHEMERAL_CALL)

        await db.update(callLegs).set({ encryptedPhone }).where(eq(callLegs.legSid, row.legSid))
      }
      log('call_legs: done')
    }

    // -----------------------------------------------------------------------
    // geocoding_config.apiKey → encryptedApiKey  (server-key)
    // -----------------------------------------------------------------------
    {
      const rows = await db
        .select()
        .from(geocodingConfig)
        .where(isNull(geocodingConfig.encryptedApiKey))

      log(`geocoding_config: ${rows.length} rows need migration`)
      for (const row of rows) {
        if (!row.apiKey) continue
        const encryptedApiKey = crypto.serverEncrypt(row.apiKey, LABEL_PROVIDER_CREDENTIAL_WRAP)

        await db
          .update(geocodingConfig)
          .set({ encryptedApiKey })
          .where(eq(geocodingConfig.id, row.id))
      }
      log('geocoding_config: done')
    }

    // -----------------------------------------------------------------------
    // signal_registration_pending.number → encryptedNumber  (server-key)
    // -----------------------------------------------------------------------
    {
      const rows = await db
        .select()
        .from(signalRegistrationPending)
        .where(isNull(signalRegistrationPending.encryptedNumber))

      log(`signal_registration_pending: ${rows.length} rows need migration`)
      for (const row of rows) {
        if (!row.number) continue
        const encryptedNumber = crypto.serverEncrypt(row.number, LABEL_VOLUNTEER_PII)

        await db
          .update(signalRegistrationPending)
          .set({ encryptedNumber })
          .where(eq(signalRegistrationPending.id, row.id))
      }
      log('signal_registration_pending: done')
    }

    // -----------------------------------------------------------------------
    // provider_config.brandSid / campaignSid / messagingServiceSid  (server-key)
    // -----------------------------------------------------------------------
    {
      // Query rows where at least one SID field is unencrypted and present
      const rows = await db.select().from(providerConfig)

      log(`provider_config: checking ${rows.length} rows`)
      for (const row of rows) {
        const updates: Partial<typeof providerConfig.$inferInsert> = {}

        if (row.brandSid && !row.encryptedBrandSid) {
          updates.encryptedBrandSid = crypto.serverEncrypt(
            row.brandSid,
            LABEL_PROVIDER_CREDENTIAL_WRAP
          )
        }
        if (row.campaignSid && !row.encryptedCampaignSid) {
          updates.encryptedCampaignSid = crypto.serverEncrypt(
            row.campaignSid,
            LABEL_PROVIDER_CREDENTIAL_WRAP
          )
        }
        if (row.messagingServiceSid && !row.encryptedMessagingServiceSid) {
          updates.encryptedMessagingServiceSid = crypto.serverEncrypt(
            row.messagingServiceSid,
            LABEL_PROVIDER_CREDENTIAL_WRAP
          )
        }

        if (Object.keys(updates).length > 0) {
          await db.update(providerConfig).set(updates).where(eq(providerConfig.id, row.id))
        }
      }
      log('provider_config: done')
    }

    log('Migration complete.')
  } catch (err) {
    console.error('[migrate-encrypt-pii] ERROR during migration:', err)
    process.exit(1)
  }
}

main()
