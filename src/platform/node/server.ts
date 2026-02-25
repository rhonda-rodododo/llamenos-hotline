/**
 * Node.js server entry point.
 * Runs the Hono app with @hono/node-server, serving static files
 * and handling WebSocket upgrades.
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import path from 'node:path'
import { createNodeEnv } from './env'
import type { DONamespaceWithInstance } from './durable-object'

import type { Role } from '../../shared/permissions'

// Types for auth parsing
interface AuthPayload {
  pubkey: string
  timestamp: number
  token: string
}

interface Volunteer {
  pubkey: string
  roles: string[]
  name: string
  active: boolean
}

async function main() {
  console.log('[llamenos] Starting Node.js server...')

  // Create the Node.js environment with shimmed bindings
  const env = await createNodeEnv()
  console.log('[llamenos] Environment initialized')

  // Import the app after setting PLATFORM
  const { default: workerApp } = await import('../../worker/app')
  const { verifyAuthToken } = await import('../../worker/lib/auth')
  const { resolvePermissions, permissionGranted } = await import('../../shared/permissions')

  // Create a top-level Hono app
  const app = new Hono()

  // Set up WebSocket handling for Node.js
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  // Inject env bindings into every request via middleware
  app.use('*', async (c, next) => {
    // Hono on CF Workers provides env via c.env
    // On Node.js, we inject it manually
    ;(c as any).env = env
    await next()
  })

  // Handle WebSocket upgrade for /api/ws directly on Node.js
  // This is necessary because the CF Workers-style WebSocketPair doesn't work with Node.js HTTP upgrades
  app.get(
    '/api/ws',
    upgradeWebSocket(async (c) => {
      // Parse auth from Sec-WebSocket-Protocol header
      const protocols = c.req.header('Sec-WebSocket-Protocol') || ''
      const parts = protocols.split(',').map(p => p.trim())
      const authB64 = parts.find(p => p !== 'llamenos-auth' && p !== '')

      if (!authB64) {
        console.error('[ws] No auth token in protocol header')
        return { onOpen: (_, ws) => ws.close(1008, 'Unauthorized') }
      }

      let wsPubkey: string | null = null

      // Get DO stubs for auth
      const identityDO = (env.IDENTITY_DO as DONamespaceWithInstance)
      const settingsDO = (env.SETTINGS_DO as DONamespaceWithInstance)
      const callRouterDO = (env.CALL_ROUTER as DONamespaceWithInstance)

      const identityStub = identityDO.get(identityDO.idFromName('global-identity'))
      const settingsStub = settingsDO.get(settingsDO.idFromName('global-settings'))
      const callsStub = callRouterDO.get(callRouterDO.idFromName('global-calls'))

      // Try session token first (for WebAuthn sessions)
      if (authB64.startsWith('session-')) {
        const sessionToken = authB64.slice(8)
        const sessionRes = await identityStub.fetch(
          new Request(`http://do/sessions/validate/${sessionToken}`)
        )
        if (sessionRes.ok) {
          const session = await sessionRes.json() as { pubkey: string }
          wsPubkey = session.pubkey
        }
      }

      // Fall back to Schnorr auth
      if (!wsPubkey) {
        try {
          const b64 = authB64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - authB64.length % 4) % 4)
          const auth = JSON.parse(atob(b64)) as AuthPayload
          const wsUrl = new URL(c.req.url)
          if (await verifyAuthToken(auth, c.req.method, wsUrl.pathname)) {
            wsPubkey = auth.pubkey
          }
        } catch {
          // Invalid auth format
        }
      }

      if (!wsPubkey) {
        console.error('[ws] Auth validation failed')
        return { onOpen: (_, ws) => ws.close(1008, 'Unauthorized') }
      }

      // Verify volunteer exists
      const volRes = await identityStub.fetch(new Request(`http://do/volunteer/${wsPubkey}`))
      if (!volRes.ok) {
        console.error('[ws] Unknown user:', wsPubkey)
        return { onOpen: (_, ws) => ws.close(1008, 'Unknown user') }
      }
      const vol = await volRes.json() as Volunteer

      // Resolve permissions to determine access level for presence data
      const rolesRes = await settingsStub.fetch(new Request('http://do/settings/roles'))
      const allRoles: Role[] = rolesRes.ok ? ((await rolesRes.json()) as { roles: Role[] }).roles : []
      const permissions = resolvePermissions(vol.roles, allRoles)
      const accessLevel = permissionGranted(permissions, 'calls:read-presence') ? 'admin' : 'volunteer'

      // Get the CallRouterDO instance directly
      const callRouterInstance = callsStub.getInstance()

      // Return WebSocket handlers that wire to the DO
      return {
        onOpen: async (_event, ws) => {
          console.log('[ws] Connection opened for:', wsPubkey)

          // Register this WebSocket with the DO's context
          // Use the ctx.acceptWebSocket to track the socket
          const doCtx = (callRouterInstance as any).ctx
          doCtx.acceptWebSocket(ws.raw, [wsPubkey!, accessLevel])

          // Sync active calls to the new connection
          try {
            const callsRes = await callsStub.fetch(new Request('http://do/calls/active'))
            if (callsRes.ok) {
              const { calls } = await callsRes.json() as { calls: unknown[] }
              const redacted = calls.map((c: any) => ({ ...c, callerNumber: '[redacted]' }))
              ws.send(JSON.stringify({ type: 'calls:sync', calls: redacted }))
            }
          } catch (err) {
            console.error('[ws] Failed to sync calls:', err)
          }

          // Sync conversations
          try {
            const convDO = (env.CONVERSATION_DO as DONamespaceWithInstance)
            const convStub = convDO.get(convDO.idFromName('global-conversations'))

            if (accessLevel !== 'admin') {
              // Fetch assigned + waiting conversations for volunteers
              const assignedRes = await convStub.fetch(
                new Request(`http://do/conversations?assignedTo=${wsPubkey}`)
              )
              const assigned = await assignedRes.json() as { conversations: unknown[] }

              const waitingRes = await convStub.fetch(
                new Request('http://do/conversations?status=waiting')
              )
              const waiting = await waitingRes.json() as { conversations: unknown[] }

              ws.send(JSON.stringify({
                type: 'conversations:sync',
                conversations: [...assigned.conversations, ...waiting.conversations],
              }))
            } else {
              // Admin sees all non-closed conversations
              const activeRes = await convStub.fetch(
                new Request('http://do/conversations?status=active')
              )
              const active = await activeRes.json() as { conversations: unknown[] }

              const waitingRes = await convStub.fetch(
                new Request('http://do/conversations?status=waiting')
              )
              const waiting = await waitingRes.json() as { conversations: unknown[] }

              ws.send(JSON.stringify({
                type: 'conversations:sync',
                conversations: [...active.conversations, ...waiting.conversations],
              }))
            }
          } catch (err) {
            console.error('[ws] Failed to sync conversations:', err)
          }

          // Broadcast presence update
          try {
            await callsStub.fetch(new Request('http://do/broadcast', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'presence:ping' }),
            }))
          } catch {
            // Ignore broadcast errors
          }
        },

        onMessage: async (event, ws) => {
          // Forward to the DO's webSocketMessage handler
          // Note: ws.raw is a Node.js ws WebSocket, cast to any for DO compatibility
          if (!ws.raw) return
          try {
            await callRouterInstance.webSocketMessage(ws.raw as any, event.data as string)
          } catch (err) {
            console.error('[ws] Error handling message:', err)
          }
        },

        onClose: async (_event, ws) => {
          console.log('[ws] Connection closed for:', wsPubkey)
          if (!ws.raw) return
          // Remove from tracking and notify
          try {
            const doCtx = (callRouterInstance as any)._wsManager
            if (doCtx?.removeWebSocket) {
              doCtx.removeWebSocket(ws.raw as any)
            }
            await callRouterInstance.webSocketClose(ws.raw as any)
          } catch (err) {
            console.error('[ws] Error handling close:', err)
          }
        },

        onError: async (event, ws) => {
          console.error('[ws] Error:', event)
          if (!ws.raw) return
          try {
            await callRouterInstance.webSocketError(ws.raw as any)
          } catch {
            // Ignore error handling errors
          }
        },
      }
    })
  )

  // Mount the worker app routes (this includes /api/* but the /api/ws is handled above)
  app.route('/', workerApp as any)

  // Static file serving (replaces CF ASSETS binding)
  // The worker app's catch-all calls next() when ASSETS is null,
  // allowing these middleware to serve static files on Node.js.
  const staticDir = path.resolve(process.cwd(), 'dist', 'client')
  app.use('*', serveStatic({ root: staticDir }))

  // SPA fallback — serve index.html for all unmatched routes
  app.use('*', serveStatic({ root: staticDir, path: '/index.html' }))

  const port = parseInt(process.env.PORT || '3000')
  const server = serve({
    fetch: app.fetch,
    port,
  }, (info) => {
    console.log(`[llamenos] Server running at http://localhost:${info.port}`)
  })

  // Inject WebSocket upgrade handler
  injectWebSocket(server)

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[llamenos] Shutting down...')
    const { stopAlarmPoller } = await import('./storage/alarm-poller')
    const { closePool } = await import('./storage/postgres-pool')
    stopAlarmPoller()
    await closePool()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[llamenos] Fatal error:', err)
  process.exit(1)
})
