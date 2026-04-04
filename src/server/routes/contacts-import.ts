import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const contactImport = new Hono<AppEnv>()

const RecipientEnvelopeSchema = z.object({
  pubkey: z.string(),
  wrappedKey: z.string(),
  ephemeralPubkey: z.string(),
})

const ContactImportSchema = z.object({
  contacts: z
    .array(
      z.object({
        contactType: z.string(),
        riskLevel: z.string(),
        tags: z.array(z.string()).optional(),
        encryptedDisplayName: z.string(),
        displayNameEnvelopes: z.array(RecipientEnvelopeSchema),
        encryptedFullName: z.string().optional(),
        fullNameEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
        encryptedPhone: z.string().optional(),
        phoneEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
        identifierHash: z.string().optional(),
        encryptedPII: z.string().optional(),
        piiEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
      })
    )
    .min(1, 'contacts array is required')
    .max(500, 'Maximum 500 contacts per batch'),
})

const MergeSchema = z.object({ secondaryId: z.string().min(1, 'secondaryId is required') })

// POST /contacts/import — batch import contacts
contactImport.post(
  '/import',
  requirePermission('contacts:create', 'contacts:envelope-full'),
  async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId') ?? 'global'
    const pubkey = c.get('pubkey')

    const raw = await c.req.json()
    const parsed = ContactImportSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
    }
    const body = parsed.data as unknown as {
      contacts: Array<{
        contactType: string
        riskLevel: string
        tags?: string[]
        encryptedDisplayName: Ciphertext
        displayNameEnvelopes: RecipientEnvelope[]
        encryptedFullName?: Ciphertext
        fullNameEnvelopes?: RecipientEnvelope[]
        encryptedPhone?: Ciphertext
        phoneEnvelopes?: RecipientEnvelope[]
        identifierHash?: HmacHash
        encryptedPII?: Ciphertext
        piiEnvelopes?: RecipientEnvelope[]
      }>
    }

    let created = 0
    const errors: Array<{ index: number; error: string }> = []

    for (let i = 0; i < body.contacts.length; i++) {
      const contact = body.contacts[i]
      try {
        // Check for duplicates via identifierHash
        if (contact.identifierHash) {
          const existing = await services.contacts.checkDuplicate(contact.identifierHash, hubId)
          if (existing) {
            errors.push({ index: i, error: 'Duplicate contact (identifierHash match)' })
            continue
          }
        }

        await services.contacts.createContact({
          hubId,
          contactType: contact.contactType || 'caller',
          riskLevel: contact.riskLevel || 'low',
          tags: contact.tags ?? [],
          identifierHash: contact.identifierHash,
          encryptedDisplayName: contact.encryptedDisplayName,
          displayNameEnvelopes: contact.displayNameEnvelopes ?? [],
          encryptedFullName: contact.encryptedFullName,
          fullNameEnvelopes: contact.fullNameEnvelopes ?? [],
          encryptedPhone: contact.encryptedPhone,
          phoneEnvelopes: contact.phoneEnvelopes ?? [],
          encryptedPII: contact.encryptedPII,
          piiEnvelopes: contact.piiEnvelopes ?? [],
          createdBy: pubkey ?? '',
        })
        created++
      } catch (err) {
        errors.push({ index: i, error: err instanceof Error ? err.message : 'Unknown error' })
      }
    }

    return c.json({ created, errors })
  }
)

// POST /contacts/:primaryId/merge — merge secondary into primary
contactImport.post(
  '/:primaryId/merge',
  requirePermission('contacts:update-all', 'contacts:envelope-full', 'contacts:delete'),
  async (c) => {
    const services = c.get('services')
    const hubId = c.get('hubId') ?? 'global'
    const primaryId = c.req.param('primaryId')

    const raw = await c.req.json()
    const parsed = MergeSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
    }
    const body = parsed.data

    const primary = await services.contacts.getContact(primaryId, hubId)
    if (!primary) return c.json({ error: 'Primary contact not found' }, 404)

    const secondary = await services.contacts.getContact(body.secondaryId, hubId)
    if (!secondary) return c.json({ error: 'Secondary contact not found' }, 404)

    // Re-link calls from secondary to primary
    const callIds = await services.contacts.getLinkedCallIds(body.secondaryId)
    for (const callId of callIds) {
      await services.contacts.unlinkCall(body.secondaryId, callId)
      try {
        await services.contacts.linkCall(primaryId, callId, hubId, 'merge')
      } catch {
        /* already linked */
      }
    }

    // Re-link conversations
    const convIds = await services.contacts.getLinkedConversationIds(body.secondaryId)
    for (const convId of convIds) {
      await services.contacts.unlinkConversation(body.secondaryId, convId)
      try {
        await services.contacts.linkConversation(primaryId, convId, hubId, 'merge')
      } catch {
        /* already linked */
      }
    }

    // Merge tags
    const mergedTags = [
      ...new Set([...(primary.tags as string[]), ...(secondary.tags as string[])]),
    ]
    await services.contacts.updateContact(primaryId, hubId, { tags: mergedTags })

    // Soft-delete secondary with mergedInto reference
    await services.contacts.mergeContact(body.secondaryId, hubId, primaryId)

    return c.json({ ok: true, primaryId, mergedTags })
  }
)

export default contactImport
