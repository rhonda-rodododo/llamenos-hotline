/**
 * IdP adapter factory — constructs the configured IdP adapter at server startup.
 *
 * Controlled by the IDP_ADAPTER environment variable (default: "authentik").
 * Additional adapters can be added as new cases in the switch below.
 */

import type { IdPAdapter } from './adapter'

export async function createIdPAdapter(): Promise<IdPAdapter> {
  const adapterType = process.env.IDP_ADAPTER ?? 'authentik'

  switch (adapterType) {
    case 'authentik': {
      const { AuthentikAdapter } = await import('./authentik-adapter')
      const adapter = new AuthentikAdapter({
        url: process.env.AUTHENTIK_URL ?? 'http://authentik-server:9000',
        apiToken: process.env.AUTHENTIK_API_TOKEN ?? '',
        idpValueEncryptionKey: process.env.IDP_VALUE_ENCRYPTION_KEY ?? '',
      })
      await adapter.initialize()
      return adapter
    }
    default:
      throw new Error(`Unknown IdP adapter type: ${adapterType}`)
  }
}

export type { IdPAdapter, IdPUser, InviteOpts, NsecSecretRotation } from './adapter'
