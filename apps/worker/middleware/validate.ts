import { ZodError, type ZodSchema } from 'zod'
import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'

/**
 * Format Zod errors into a structured, user-friendly response.
 */
function formatZodError(error: ZodError): {
  error: string
  details: Array<{ field: string; message: string; code: string }>
} {
  return {
    error: 'Validation failed',
    details: error.issues.map(issue => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
      code: issue.code,
    })),
  }
}

/**
 * Validate request body against a Zod schema.
 * Stores parsed result in `c.get('validatedBody')`.
 *
 * @example
 * route.post('/', validateBody(createNoteSchema), async (c) => {
 *   const body = c.get('validatedBody')
 * })
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return async (c: Context<AppEnv>, next: Next) => {
    const body = await c.req.json().catch(() => null)
    if (body === null) {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const result = schema.safeParse(body)
    if (!result.success) {
      return c.json(formatZodError(result.error), 400)
    }

    c.set('validatedBody', result.data)
    await next()
  }
}

/**
 * Validate query parameters against a Zod schema.
 * Stores parsed result in `c.get('validatedQuery')`.
 *
 * @example
 * route.get('/', validateQuery(listSchema), async (c) => {
 *   const query = c.get('validatedQuery')
 * })
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return async (c: Context<AppEnv>, next: Next) => {
    const params: Record<string, string> = {}
    for (const [key, value] of new URL(c.req.url).searchParams) {
      params[key] = value
    }

    const result = schema.safeParse(params)
    if (!result.success) {
      return c.json(formatZodError(result.error), 400)
    }

    c.set('validatedQuery', result.data)
    await next()
  }
}

/**
 * Validate a single path parameter.
 *
 * @example
 * route.get('/:id', validateParam('id', uuidSchema), async (c) => { ... })
 */
export function validateParam(name: string, schema: ZodSchema) {
  return async (c: Context<AppEnv>, next: Next) => {
    const value = c.req.param(name)
    const result = schema.safeParse(value)
    if (!result.success) {
      return c.json({
        error: 'Validation failed',
        details: [{ field: name, message: result.error.issues[0].message, code: result.error.issues[0].code }],
      }, 400)
    }
    await next()
  }
}
