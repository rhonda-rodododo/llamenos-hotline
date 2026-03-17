/**
 * Device registration API routes (Epic 86).
 *
 * POST /api/devices/register — Register/update device push token.
 * DELETE /api/devices — Remove all devices for current user.
 */

import { Hono } from 'hono'
import { describeRoute, validator } from 'hono-openapi'
import type { AppEnv } from '../types'
import { authErrors } from '../openapi/helpers'
import { registerDeviceBodySchema, voipTokenBodySchema } from '@protocol/schemas/devices'

const devicesRoutes = new Hono<AppEnv>()

/**
 * POST /api/devices/register
 * Register or update a device push token for the authenticated volunteer.
 */
devicesRoutes.post('/register',
  describeRoute({
    tags: ['Devices'],
    summary: 'Register or update device push token',
    responses: {
      204: { description: 'Device registered' },
      500: { description: 'Failed to register device' },
      ...authErrors,
    },
  }),
  validator('json', registerDeviceBodySchema),
  async (c) => {
    const pubkey = c.get('pubkey')
    const body = c.req.valid('json')
    const services = c.get('services')

    await services.identity.registerDevice(pubkey, {
      platform: body.platform,
      pushToken: body.pushToken,
      wakeKeyPublic: body.wakeKeyPublic,
    })

    return c.body(null, 204)
  })

/**
 * POST /api/devices/voip-token
 * Register a VoIP-specific push token (PushKit on iOS, FCM on Android).
 * Stored separately from regular push tokens — used for high-priority call dispatch.
 */
devicesRoutes.post('/voip-token',
  describeRoute({
    tags: ['Devices'],
    summary: 'Register VoIP push token',
    responses: {
      204: { description: 'VoIP token registered' },
      500: { description: 'Failed to register VoIP token' },
      ...authErrors,
    },
  }),
  validator('json', voipTokenBodySchema),
  async (c) => {
    const pubkey = c.get('pubkey')
    const body = c.req.valid('json')
    const services = c.get('services')

    await services.identity.registerVoipToken(pubkey, {
      platform: body.platform,
      voipToken: body.voipToken,
    })

    return c.body(null, 204)
  })

/**
 * DELETE /api/devices/voip-token
 * Unregister VoIP push token for the current user.
 */
devicesRoutes.delete('/voip-token',
  describeRoute({
    tags: ['Devices'],
    summary: 'Unregister VoIP push token',
    responses: {
      204: { description: 'VoIP token removed' },
      ...authErrors,
    },
  }),
  async (c) => {
    const pubkey = c.get('pubkey')
    const services = c.get('services')

    await services.identity.deleteVoipToken(pubkey)

    return c.body(null, 204)
  })

/**
 * DELETE /api/devices
 * Remove all registered devices for the current user (called on logout).
 */
devicesRoutes.delete('/',
  describeRoute({
    tags: ['Devices'],
    summary: 'Remove all registered devices',
    responses: {
      204: { description: 'All devices removed' },
      ...authErrors,
    },
  }),
  async (c) => {
    const pubkey = c.get('pubkey')
    const services = c.get('services')

    await services.identity.deleteAllDevices(pubkey)

    return c.body(null, 204)
  })

export default devicesRoutes
