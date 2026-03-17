/**
 * AuditService — replaces audit helper + RecordsDO audit methods.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'
import type { DOStub } from '../types'
import { hashIP } from '../lib/crypto'

export class AuditService {
  constructor(protected db: Database) {}
}

/** Legacy audit helper — delegates to RecordsDO. Will be replaced by AuditService methods. */
export async function audit(
  records: DOStub,
  event: string,
  actorPubkey: string,
  details: Record<string, unknown> = {},
  ctx?: { request: Request; hmacSecret: string },
) {
  const meta: Record<string, unknown> = {}
  if (ctx) {
    const rawIp = ctx.request.headers.get('CF-Connecting-IP')
    meta.ip = rawIp ? hashIP(rawIp, ctx.hmacSecret) : null
    meta.country = ctx.request.headers.get('CF-IPCountry')
    meta.ua = ctx.request.headers.get('User-Agent')
  }
  await records.fetch(new Request('http://do/audit', {
    method: 'POST',
    body: JSON.stringify({ event, actorPubkey, details: { ...details, ...meta } }),
  }))
}
