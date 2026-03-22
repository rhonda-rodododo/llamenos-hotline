import type { MiddlewareHandler } from 'hono'
import type { Services } from '../services'
import type { AppEnv } from '../types'

export function servicesMiddleware(services: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('services', services)
    await next()
  }
}
