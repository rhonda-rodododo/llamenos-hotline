import { request } from './client'

export interface LockdownResult {
  tier: 'A' | 'B' | 'C'
  revokedSessions: number
  deletedPasskeys: number
  accountDeactivated: boolean
}

export async function triggerLockdown(
  tier: 'A' | 'B' | 'C',
  pinProof: string
): Promise<LockdownResult> {
  return request<LockdownResult>('/auth/sessions/lockdown', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tier, confirmation: 'LOCKDOWN', pinProof }),
  })
}

export async function changePin(
  currentPinProof: string,
  newEncryptedSecretKey: string
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/auth/pin/change', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPinProof, newEncryptedSecretKey }),
  })
}

export async function rotateRecovery(
  currentPinProof: string,
  newEncryptedSecretKey: string
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/auth/recovery/rotate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPinProof, newEncryptedSecretKey }),
  })
}
