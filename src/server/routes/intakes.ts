import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { Hono } from 'hono'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const intakes = new Hono<AppEnv>()

// POST /intakes — submit intake
intakes.post('/', requirePermission('notes:create'), async (c) => {
  // Any user who can create notes can submit intakes
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{
    contactId?: string
    callId?: string
    encryptedPayload: string
    payloadEnvelopes: RecipientEnvelope[]
  }>()

  if (!body.encryptedPayload) {
    return c.json({ error: 'encryptedPayload is required' }, 400)
  }

  const intake = await services.intakes.submitIntake({
    hubId,
    contactId: body.contactId,
    callId: body.callId,
    encryptedPayload: body.encryptedPayload as Ciphertext,
    payloadEnvelopes: body.payloadEnvelopes ?? [],
    submittedBy: pubkey ?? '',
  })

  return c.json({ intake }, 201)
})

// GET /intakes — list intakes
intakes.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const status = c.req.query('status')
  const contactId = c.req.query('contactId')

  let intakesList = await services.intakes.listIntakes(hubId, { status, contactId })

  // Non-triage users only see their own
  if (!checkPermission(permissions, 'contacts:triage')) {
    intakesList = intakesList.filter((i) => i.submittedBy === pubkey)
  }

  return c.json({ intakes: intakesList })
})

// GET /intakes/:id — single intake
intakes.get('/:id', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  const intake = await services.intakes.getIntake(id, hubId)
  if (!intake) return c.json({ error: 'Intake not found' }, 404)
  return c.json({ intake })
})

// PATCH /intakes/:id — update status (triage)
intakes.patch('/:id', requirePermission('contacts:triage'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{ status: string }>()
  if (!body.status || !['reviewed', 'merged', 'dismissed'].includes(body.status)) {
    return c.json({ error: 'status must be reviewed, merged, or dismissed' }, 400)
  }

  const intake = await services.intakes.updateIntakeStatus(id, hubId, body.status, pubkey ?? '')
  if (!intake) return c.json({ error: 'Intake not found' }, 404)
  return c.json({ intake })
})

export default intakes
