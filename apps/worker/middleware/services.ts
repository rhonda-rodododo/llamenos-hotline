/**
 * Hono middleware to inject services into the request context.
 *
 * Usage in routes: const { identity, records, audit } = c.get('services')
 */
import type { Context, Next } from 'hono'
import type { Services } from '../services'

export function servicesMiddleware(services: Services) {
  return async (c: Context, next: Next) => {
    c.set('services', services)
    await next()
  }
}
