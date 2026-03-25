import type { AriClient } from './ari-client'

/**
 * Provision a WebRTC-capable PJSIP endpoint for a volunteer.
 *
 * Creates three ARI dynamic config objects:
 * 1. auth — username/password credentials
 * 2. aor — address of record (max 1 contact, qualify for health)
 * 3. endpoint — WebRTC-enabled PJSIP endpoint
 *
 * Idempotent: ARI PUT overwrites existing objects with same ID.
 * Does NOT call reloadModule — with the memory sorcery wizard,
 * dynamic config changes take effect immediately.
 *
 * Rollback: if a later step fails, earlier objects are cleaned up.
 */
export async function provisionEndpoint(
  ari: Pick<AriClient, 'configureDynamic' | 'deleteDynamic'>,
  pubkey: string
): Promise<{ username: string; password: string }> {
  const username = `vol_${pubkey.slice(0, 12)}`
  const password = generatePassword()

  // 1. Auth object — userpass credentials
  await ari.configureDynamic('res_pjsip', 'auth', username, {
    auth_type: 'userpass',
    username,
    password,
  })

  // 2. AOR — single contact, qualify every 30s for health
  try {
    await ari.configureDynamic('res_pjsip', 'aor', username, {
      max_contacts: '1',
      remove_existing: 'yes',
      qualify_frequency: '30',
    })
  } catch (err) {
    // Rollback auth on aor failure
    try {
      await ari.deleteDynamic('res_pjsip', 'auth', username)
    } catch {
      /* best effort */
    }
    throw err
  }

  // 3. Endpoint — webrtc=yes auto-enables DTLS, ICE, AVPF
  try {
    await ari.configureDynamic('res_pjsip', 'endpoint', username, {
      auth: username,
      aors: username,
      webrtc: 'yes',
      transport: 'transport-wss',
      context: 'volunteers',
      dtls_auto_generate_cert: 'yes',
      media_encryption: 'dtls',
      disallow: 'all',
      allow: 'opus,ulaw',
    })
  } catch (err) {
    // Rollback auth + aor on endpoint failure
    try {
      await ari.deleteDynamic('res_pjsip', 'aor', username)
    } catch {
      /* best effort */
    }
    try {
      await ari.deleteDynamic('res_pjsip', 'auth', username)
    } catch {
      /* best effort */
    }
    throw err
  }

  return { username, password }
}

/**
 * Deprovision a volunteer's PJSIP endpoint.
 * Removes in reverse order: endpoint, aor, auth.
 * Errors are non-fatal (object may already be deleted).
 */
export async function deprovisionEndpoint(
  ari: Pick<AriClient, 'deleteDynamic'>,
  pubkey: string
): Promise<void> {
  const username = `vol_${pubkey.slice(0, 12)}`

  try {
    await ari.deleteDynamic('res_pjsip', 'endpoint', username)
  } catch {
    /* may not exist */
  }
  try {
    await ari.deleteDynamic('res_pjsip', 'aor', username)
  } catch {
    /* may not exist */
  }
  try {
    await ari.deleteDynamic('res_pjsip', 'auth', username)
  } catch {
    /* may not exist */
  }
}

/** Generate a 32-byte CSPRNG password as base64url */
function generatePassword(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
