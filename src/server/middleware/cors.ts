import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

/** Hard-coded safe origins always allowed (non-configurable baseline). */
const BUILTIN_ORIGINS = new Set([
  'https://app.llamenos.org',
  'https://demo.llamenos-hotline.com',
  'tauri://localhost',
  'https://tauri.localhost',
])

function isAllowedOrigin(
  origin: string,
  env: { ENVIRONMENT: string; CORS_ALLOWED_ORIGINS?: string }
): boolean {
  if (BUILTIN_ORIGINS.has(origin)) return true
  // Phase 2.4: Support CORS_ALLOWED_ORIGINS env var (comma-separated list)
  if (env.CORS_ALLOWED_ORIGINS) {
    const extra = env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    if (extra.includes(origin)) return true
  }
  // Development origins
  if (env.ENVIRONMENT === 'development') {
    if (origin === 'http://localhost:5173' || origin === 'http://localhost:1420') return true
  }
  return false
}

export const cors = createMiddleware<AppEnv>(async (c, next) => {
  const requestOrigin = c.req.header('Origin') || ''
  const allowed = isAllowedOrigin(requestOrigin, c.env)
  const allowedOrigin = allowed ? requestOrigin : ''

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        Vary: 'Origin',
      },
    })
  }

  await next()

  if (allowedOrigin) {
    c.header('Access-Control-Allow-Origin', allowedOrigin)
  }
  c.header('Vary', 'Origin')
})
