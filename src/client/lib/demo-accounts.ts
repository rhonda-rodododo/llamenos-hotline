import { DEMO_ACCOUNTS } from '@shared/demo-accounts'

/**
 * Demo account nsec values — loaded dynamically to keep nsecs out of
 * the main bundle. The nsec data is in a separate chunk that is only
 * fetched when demo mode is active.
 */
let demoNsecs: Record<string, string> | null = null

async function loadNsecs(): Promise<Record<string, string>> {
  if (!demoNsecs) {
    const mod = await import('./demo-nsec-data')
    demoNsecs = mod.DEMO_NSECS
  }
  return demoNsecs
}

export async function getDemoNsec(pubkey: string): Promise<string | undefined> {
  const nsecs = await loadNsecs()
  return nsecs[pubkey]
}

export async function getDemoAccountsWithNsec() {
  const nsecs = await loadNsecs()
  return DEMO_ACCOUNTS.filter(a => !a.roleIds.includes('role-volunteer') || a.name !== 'Fatima Al-Rashid').map(a => ({
    ...a,
    nsec: nsecs[a.pubkey]!,
  }))
}
