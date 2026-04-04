import { z } from '@hono/zod-openapi'
import { permissionGranted } from '@shared/permissions'
import { requirePermission } from '../../middleware/permission-guard'

// ── Shared schemas ──

export const PassthroughSchema = z.object({}).passthrough()
export const ErrorSchema = z.object({ error: z.string() })
export const OkSchema = z.object({ ok: z.boolean() })

export const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'contact-abc123' }),
})

export const CallIdParamSchema = z.object({
  callId: z.string().openapi({ param: { name: 'callId', in: 'path' }, example: 'call-abc123' }),
})

export const RelationshipIdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'rel-abc123' }),
})

// Base permission for all routes
export const baseMiddleware = [requirePermission('contacts:envelope-summary')]

// ── Scope helpers ──

export function getContactReadScope(permissions: string[]): 'own' | 'assigned' | 'all' | null {
  if (permissionGranted(permissions, 'contacts:read-all')) return 'all'
  if (permissionGranted(permissions, 'contacts:read-assigned')) return 'assigned'
  if (permissionGranted(permissions, 'contacts:read-own')) return 'own'
  return null
}

export function getContactUpdateScope(permissions: string[]): 'own' | 'assigned' | 'all' | null {
  if (permissionGranted(permissions, 'contacts:update-all')) return 'all'
  if (permissionGranted(permissions, 'contacts:update-assigned')) return 'assigned'
  if (permissionGranted(permissions, 'contacts:update-own')) return 'own'
  return null
}
