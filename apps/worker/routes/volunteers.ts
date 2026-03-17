import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { getDOs } from '../lib/do-access'
import { requirePermission } from '../middleware/permission-guard'
import { createVolunteerBodySchema, adminUpdateVolunteerBodySchema, volunteerResponseSchema } from '@protocol/schemas/volunteers'
import { okResponseSchema } from '@protocol/schemas/common'
import type { CaseRecord } from '@protocol/schemas/records'
import { authErrors, notFoundError } from '../openapi/helpers'
import { audit } from '../services/audit'

const volunteers = new Hono<AppEnv>()
volunteers.use('*', requirePermission('volunteers:read'))

volunteers.get('/',
  describeRoute({
    tags: ['Volunteers'],
    summary: 'List all volunteers',
    responses: {
      200: {
        description: 'List of volunteers',
        content: {
          'application/json': {
            schema: resolver(z.object({ volunteers: z.array(volunteerResponseSchema) })),
          },
        },
      },
      ...authErrors,
    },
  }),
  async (c) => {
    const services = c.get('services')
    const result = await services.identity.getVolunteers()
    return c.json(result)
  },
)

volunteers.get('/:targetPubkey',
  describeRoute({
    tags: ['Volunteers'],
    summary: 'Get a single volunteer by pubkey',
    responses: {
      200: {
        description: 'Volunteer details',
        content: {
          'application/json': {
            schema: resolver(volunteerResponseSchema),
          },
        },
      },
      ...authErrors,
      ...notFoundError,
    },
  }),
  async (c) => {
    const services = c.get('services')
    const targetPubkey = c.req.param('targetPubkey')
    const volunteer = await services.identity.getVolunteer(targetPubkey)
    return c.json(volunteer)
  },
)

volunteers.post('/',
  describeRoute({
    tags: ['Volunteers'],
    summary: 'Create a new volunteer',
    responses: {
      201: {
        description: 'Volunteer created',
        content: {
          'application/json': {
            schema: resolver(volunteerResponseSchema),
          },
        },
      },
      ...authErrors,
    },
  }),
  requirePermission('volunteers:create'),
  validator('json', createVolunteerBodySchema),
  async (c) => {
    const services = c.get('services')
    const pubkey = c.get('pubkey')
    const body = c.req.valid('json')

    const result = await services.identity.createVolunteer({
      pubkey: body.pubkey,
      name: body.name,
      phone: body.phone,
      roleIds: body.roleIds || body.roles || ['role-volunteer'],
      encryptedSecretKey: body.encryptedSecretKey || '',
      // Epic 340: Volunteer profile extensions
      ...(body.specializations && { specializations: body.specializations }),
      ...(body.maxCaseAssignments !== undefined && { maxCaseAssignments: body.maxCaseAssignments }),
      ...(body.teamId && { teamId: body.teamId }),
      ...(body.supervisorPubkey && { supervisorPubkey: body.supervisorPubkey }),
    })

    await audit(services.audit, 'volunteerAdded', pubkey, { target: body.pubkey, roles: body.roleIds || body.roles })

    return c.json(result, 201)
  },
)

volunteers.patch('/:targetPubkey',
  describeRoute({
    tags: ['Volunteers'],
    summary: 'Update a volunteer (admin)',
    responses: {
      200: {
        description: 'Volunteer updated',
        content: {
          'application/json': {
            schema: resolver(volunteerResponseSchema),
          },
        },
      },
      ...authErrors,
    },
  }),
  requirePermission('volunteers:update'),
  validator('json', adminUpdateVolunteerBodySchema),
  async (c) => {
    const services = c.get('services')
    const pubkey = c.get('pubkey')
    const targetPubkey = c.req.param('targetPubkey')
    const body = c.req.valid('json')

    const result = await services.identity.updateVolunteer(targetPubkey, body, true)

    if (body.roles) await audit(services.audit, 'rolesChanged', pubkey, { target: targetPubkey, roles: body.roles })
    if (body.active === false) await audit(services.audit, 'volunteerDeactivated', pubkey, { target: targetPubkey })
    // Revoke all sessions when deactivating or changing roles
    if (body.active === false || body.roles) {
      await services.identity.revokeAllSessions(targetPubkey)
    }

    return c.json(result)
  },
)

volunteers.delete('/:targetPubkey',
  describeRoute({
    tags: ['Volunteers'],
    summary: 'Delete a volunteer',
    responses: {
      200: {
        description: 'Volunteer deleted',
        content: {
          'application/json': {
            schema: resolver(okResponseSchema),
          },
        },
      },
      ...authErrors,
    },
  }),
  requirePermission('volunteers:delete'),
  async (c) => {
    const services = c.get('services')
    const pubkey = c.get('pubkey')
    const targetPubkey = c.req.param('targetPubkey')
    // Revoke all sessions before deletion — proceed even if this fails
    // (orphaned sessions will expire naturally via TTL)
    await services.identity.revokeAllSessions(targetPubkey).catch(() => {})
    await services.identity.deleteVolunteer(targetPubkey)
    await audit(services.audit, 'volunteerRemoved', pubkey, { target: targetPubkey })
    return c.json({ ok: true })
  },
)

// ============================================================
// Volunteer Case Endpoints (Epic 340)
// ============================================================

/**
 * GET /volunteers/:pubkey/cases
 *
 * List case records assigned to a volunteer. Queries CaseDO using the
 * idx:assigned:{pubkey}: prefix index for efficient lookup. Uses the
 * global (non-hub-scoped) CaseManager — hub-scoped queries would need
 * a different approach.
 */
volunteers.get('/:targetPubkey/cases',
  describeRoute({
    tags: ['Volunteers'],
    summary: 'List case records assigned to a volunteer',
    responses: {
      200: { description: 'Assigned records' },
      ...authErrors,
      ...notFoundError,
    },
  }),
  async (c) => {
    const services = c.get('services')
    const dos = getDOs(c.env)
    const targetPubkey = c.req.param('targetPubkey')

    // Verify volunteer exists (throws 404 if not found)
    await services.identity.getVolunteer(targetPubkey)

    // Query CaseDO for records assigned to this volunteer
    const qs = new URLSearchParams({
      page: c.req.query('page') ?? '1',
      limit: c.req.query('limit') ?? '20',
      assignedTo: targetPubkey,
    })
    const entityTypeId = c.req.query('entityTypeId')
    if (entityTypeId) qs.set('entityTypeId', entityTypeId)

    const res = await dos.caseManager.fetch(new Request(`http://do/records?${qs}`))
    return new Response(res.body, res)
  },
)

/**
 * GET /volunteers/:pubkey/metrics
 *
 * Volunteer workload metrics: active case count, total cases handled,
 * and average resolution days. This avoids making the volunteer list
 * endpoint expensive by providing per-volunteer metrics on demand.
 */
volunteers.get('/:targetPubkey/metrics',
  describeRoute({
    tags: ['Volunteers'],
    summary: 'Get volunteer workload metrics',
    responses: {
      200: {
        description: 'Volunteer metrics',
        content: {
          'application/json': {
            schema: resolver(z.object({
              pubkey: z.string(),
              activeCaseCount: z.number(),
              totalCasesHandled: z.number(),
              averageResolutionDays: z.number().nullable(),
            })),
          },
        },
      },
      ...authErrors,
      ...notFoundError,
    },
  }),
  async (c) => {
    const services = c.get('services')
    const dos = getDOs(c.env)
    const targetPubkey = c.req.param('targetPubkey')

    // Verify volunteer exists (throws 404 if not found)
    await services.identity.getVolunteer(targetPubkey)

    // Fetch all records assigned to this volunteer (use a high limit to get all)
    const qs = new URLSearchParams({
      page: '1',
      limit: '1000',
      assignedTo: targetPubkey,
    })
    const recordsRes = await dos.caseManager.fetch(new Request(`http://do/records?${qs}`))
    if (!recordsRes.ok) {
      return c.json({ pubkey: targetPubkey, activeCaseCount: 0, totalCasesHandled: 0, averageResolutionDays: null })
    }

    const { records } = await recordsRes.json() as { records: CaseRecord[] }
    const totalCasesHandled = records.length
    const closedRecords = records.filter(r => r.closedAt)
    const activeRecords = records.filter(r => !r.closedAt)

    // Calculate average resolution days for closed records
    let averageResolutionDays: number | null = null
    if (closedRecords.length > 0) {
      let totalDays = 0
      for (const record of closedRecords) {
        const created = new Date(record.createdAt).getTime()
        const closed = new Date(record.closedAt!).getTime()
        totalDays += (closed - created) / (1000 * 60 * 60 * 24)
      }
      averageResolutionDays = Math.round((totalDays / closedRecords.length) * 10) / 10
    }

    return c.json({
      pubkey: targetPubkey,
      activeCaseCount: activeRecords.length,
      totalCasesHandled,
      averageResolutionDays,
    })
  },
)

export default volunteers
