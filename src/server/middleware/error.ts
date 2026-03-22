import type { Context } from 'hono'
import { AppError } from '../lib/errors'

export const errorHandler = (err: Error, c: Context) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.status)
  }
  console.error('[server] Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
}
