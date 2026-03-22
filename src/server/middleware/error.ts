import type { Context } from 'hono'
import { AppError } from '../lib/errors'

export const errorHandler = (err: Error, c: Context) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.status as 400 | 401 | 403 | 404 | 409 | 429 | 500)
  }
  console.error('[server] Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
}
