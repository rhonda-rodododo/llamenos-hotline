import type { Ciphertext } from '@shared/crypto-types'
import { Hono } from 'hono'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const teams = new Hono<AppEnv>()

// Base read access — all routes require users:read
teams.use('*', requirePermission('users:read'))

// GET /teams — list teams for hub
teams.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const teamsList = await services.teams.listTeams(hubId)
  return c.json({ teams: teamsList })
})

// POST /teams — create team
teams.post('/', requirePermission('users:manage-roles'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{
    encryptedName: Ciphertext
    encryptedDescription?: Ciphertext
  }>()

  if (!body.encryptedName) {
    return c.json({ error: 'encryptedName is required' }, 400)
  }

  const team = await services.teams.createTeam({
    hubId,
    encryptedName: body.encryptedName,
    encryptedDescription: body.encryptedDescription ?? null,
    createdBy: pubkey ?? '',
  })

  return c.json({ team }, 201)
})

// PATCH /teams/:id — update team
teams.patch('/:id', requirePermission('users:manage-roles'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  const body = await c.req.json<{
    encryptedName?: Ciphertext
    encryptedDescription?: Ciphertext | null
  }>()

  const team = await services.teams.updateTeam(id, hubId, body)
  if (!team) return c.json({ error: 'Team not found' }, 404)
  return c.json({ team })
})

// DELETE /teams/:id — delete team (cascade)
teams.delete('/:id', requirePermission('users:manage-roles'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  const deleted = await services.teams.deleteTeam(id, hubId)
  if (!deleted) return c.json({ error: 'Team not found' }, 404)
  return c.json({ ok: true })
})

// --- Members ---

// GET /teams/:id/members — list team members
teams.get('/:id/members', async (c) => {
  const services = c.get('services')
  const id = c.req.param('id')
  const members = await services.teams.listMembers(id)
  return c.json({ members })
})

// POST /teams/:id/members — add members
teams.post('/:id/members', requirePermission('users:manage-roles'), async (c) => {
  const services = c.get('services')
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{ pubkeys: string[] }>()
  if (!body.pubkeys?.length) {
    return c.json({ error: 'pubkeys array is required' }, 400)
  }

  const members = await services.teams.addMembers(id, body.pubkeys, pubkey ?? '')
  return c.json({ members, added: members.length })
})

// DELETE /teams/:id/members/:pubkey — remove member
teams.delete('/:id/members/:pubkey', requirePermission('users:manage-roles'), async (c) => {
  const services = c.get('services')
  const id = c.req.param('id')
  const memberPubkey = c.req.param('pubkey')

  const removed = await services.teams.removeMember(id, memberPubkey)
  if (!removed) return c.json({ error: 'Member not found' }, 404)
  return c.json({ ok: true })
})

// --- Contact Assignment ---

// GET /teams/:id/contacts — list contacts assigned to team
teams.get('/:id/contacts', requirePermission('contacts:read-assigned'), async (c) => {
  const services = c.get('services')
  const id = c.req.param('id')
  const assignments = await services.teams.listTeamContacts(id)
  return c.json({ assignments })
})

// POST /teams/:id/contacts — assign contacts (bulk)
teams.post('/:id/contacts', requirePermission('contacts:update-assigned'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const pubkey = c.get('pubkey')

  const body = await c.req.json<{ contactIds: string[] }>()
  if (!body.contactIds?.length) {
    return c.json({ error: 'contactIds array is required' }, 400)
  }

  const result = await services.teams.assignContacts(id, body.contactIds, hubId, pubkey ?? '')
  return c.json(result)
})

// DELETE /teams/:id/contacts/:contactId — unassign contact
teams.delete(
  '/:id/contacts/:contactId',
  requirePermission('contacts:update-assigned'),
  async (c) => {
    const services = c.get('services')
    const id = c.req.param('id')
    const contactId = c.req.param('contactId')

    const removed = await services.teams.unassignContact(id, contactId)
    if (!removed) return c.json({ error: 'Assignment not found' }, 404)
    return c.json({ ok: true })
  }
)

export default teams
