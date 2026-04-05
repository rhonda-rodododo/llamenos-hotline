/**
 * Public IVR audio endpoint (no auth required).
 *
 * Twilio fetches these audio files during calls to play recorded IVR prompts.
 * Hub is optional — defaults to global if not provided. Telephony providers
 * embed the hub ID as a query parameter on the webhook URL so the correct
 * hub's IVR recordings are served.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'

const ivrAudioRoutes = new Hono<AppEnv>()

ivrAudioRoutes.get('/:promptType/:language', async (c) => {
  const promptType = c.req.param('promptType')
  const language = c.req.param('language')
  // hubId is supplied via query param since this is a public endpoint Twilio
  // fetches without auth (the usual hub-context middleware requires auth).
  const hubId = c.req.query('hubId')
  if (!/^[a-z_-]+$/.test(promptType) || !/^[a-z]{2,5}(-[A-Z]{2})?$/.test(language)) {
    return c.json({ error: 'Invalid parameters' }, 400)
  }
  if (hubId !== undefined && !/^[a-zA-Z0-9_-]+$/.test(hubId)) {
    return c.json({ error: 'Invalid hubId' }, 400)
  }
  const services = c.get('services')
  const audio = await services.settings.getIvrAudio(promptType, language, hubId)
  if (!audio) return c.json({ error: 'Audio not found' }, 404)
  return new Response(audio.audioData, {
    headers: { 'Content-Type': audio.mimeType },
  })
})

export { ivrAudioRoutes }
