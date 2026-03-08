/**
 * Correlation ID middleware.
 *
 * Generates a unique request ID per request (or accepts an incoming
 * X-Request-Id header). Sets the ID on the Hono context and response header
 * for distributed tracing and log correlation.
 *
 * In development, incoming X-Request-Id headers are trusted.
 * In production, a fresh ID is always generated to prevent spoofing.
 */
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'
import { incRequests } from '../lib/error-counter'

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  // Trust incoming header in development, always regenerate in production
  const isDev = c.env.ENVIRONMENT === 'development'
  const incoming = c.req.header('X-Request-Id')
  const id = (isDev && incoming) ? incoming : crypto.randomUUID()

  c.set('requestId', id)
  incRequests()

  await next()

  c.header('X-Request-Id', id)
})
