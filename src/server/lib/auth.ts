import type { Volunteer } from '../types'
import { verifyAccessToken } from './jwt'

export async function authenticateRequest(
  request: Request,
  identity: {
    getVolunteer(pubkey: string): Promise<Volunteer | null>
  }
): Promise<{ pubkey: string; volunteer: Volunteer } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) throw new Error('JWT_SECRET not configured')

  try {
    const payload = await verifyAccessToken(token, jwtSecret)
    const volunteer = await identity.getVolunteer(payload.sub)
    if (!volunteer) return null
    return { pubkey: payload.sub, volunteer }
  } catch {
    return null
  }
}
