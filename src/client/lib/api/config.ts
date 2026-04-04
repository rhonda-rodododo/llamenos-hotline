import { API_BASE } from './client'

// --- Public config (no auth) ---

export async function getConfig() {
  const res = await fetch(`${API_BASE}/config`)
  if (!res.ok)
    return {
      hotlineName: 'Hotline',
      hotlineNumber: '',
      channels: undefined,
      setupCompleted: undefined,
    }
  return res.json() as Promise<{
    hotlineName: string
    hotlineNumber: string
    channels?: import('@shared/types').EnabledChannels
    setupCompleted?: boolean
    adminPubkey?: string
    demoMode?: boolean
    demoResetSchedule?: string | null
    needsBootstrap?: boolean
    hubs?: import('@shared/types').Hub[]
    defaultHubId?: string
    serverNostrPubkey?: string
    nostrRelayUrl?: string
  }>
}
