/**
 * Public IVR audio endpoint (no auth required).
 *
 * Twilio fetches these audio files during calls to play recorded IVR prompts.
 * The path params are validated to prevent injection, and the response streams
 * raw audio bytes from the server's IVR audio store.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'

const ivrAudioRoutes = new Hono<AppEnv>()

ivrAudioRoutes.get('/:promptType/:language', async (c) => {
  const promptType = c.req.param('promptType')
  const language = c.req.param('language')
  // Validate path params to prevent injection
  if (!/^[a-z_-]+$/.test(promptType) || !/^[a-z]{2,5}(-[A-Z]{2})?$/.test(language)) {
    return c.json({ error: 'Invalid parameters' }, 400)
  }
  const services = c.get('services')
  const audio = await services.settings.getIvrAudio(promptType, language)
  if (!audio) return c.json({ error: 'Audio not found' }, 404)
  return new Response(audio.audioData, {
    headers: { 'Content-Type': audio.mimeType },
  })
})

export { ivrAudioRoutes }
