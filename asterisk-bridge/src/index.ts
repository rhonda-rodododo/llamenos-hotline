import { AriClient } from './ari-client'
import { CommandHandler } from './command-handler'
import { PjsipConfigurator } from './pjsip-configurator'
import type { BridgeConfig } from './types'
import { WebhookSender } from './webhook-sender'

/** Load configuration from environment variables */
function loadConfig(): BridgeConfig {
  const ariUrl = process.env.ARI_URL ?? 'ws://localhost:8088/ari/events'
  const ariRestUrl = process.env.ARI_REST_URL ?? 'http://localhost:8088/ari'
  const ariUsername = process.env.ARI_USERNAME
  const ariPassword = process.env.ARI_PASSWORD
  const workerWebhookUrl = process.env.WORKER_WEBHOOK_URL
  const bridgeSecret = process.env.BRIDGE_SECRET
  const bridgePort = Number.parseInt(process.env.BRIDGE_PORT ?? '3000', 10)
  const bridgeBind = process.env.BRIDGE_BIND ?? '127.0.0.1'
  const stasisApp = process.env.STASIS_APP ?? 'llamenos'

  if (!ariUsername) throw new Error('ARI_USERNAME is required')
  if (!ariPassword) throw new Error('ARI_PASSWORD is required')
  if (!workerWebhookUrl) throw new Error('WORKER_WEBHOOK_URL is required')
  if (!bridgeSecret) throw new Error('BRIDGE_SECRET is required')

  const connectionTimeoutMs = process.env.ARI_CONNECTION_TIMEOUT_MS
    ? Number.parseInt(process.env.ARI_CONNECTION_TIMEOUT_MS, 10)
    : undefined

  return {
    ariUrl,
    ariRestUrl,
    ariUsername,
    ariPassword,
    workerWebhookUrl,
    bridgeSecret,
    bridgePort,
    bridgeBind,
    stasisApp,
    sipProvider: process.env.SIP_PROVIDER,
    sipUsername: process.env.SIP_USERNAME,
    sipPassword: process.env.SIP_PASSWORD,
    connectionTimeoutMs,
  }
}

async function main(): Promise<void> {
  console.log('[bridge] Starting Asterisk ARI Bridge...')

  const config = loadConfig()

  // SIP auto-config state — reported on /health
  let sipConfigured = false
  let sipConfigSkipped = false

  // Initialize components
  const ari = new AriClient(config)
  const webhook = new WebhookSender(config)
  const handler = new CommandHandler(ari, webhook, config)

  // Set hotline number from env (optional — will be overridden by Worker config)
  if (process.env.HOTLINE_NUMBER) {
    handler.setHotlineNumber(process.env.HOTLINE_NUMBER)
  }

  // Register ARI event handler
  ari.onEvent((event) => {
    handler.handleEvent(event).catch((err) => {
      console.error('[bridge] Event handler error:', err)
    })
  })

  // Start HTTP server for Worker commands
  const server = Bun.serve({
    port: config.bridgePort,
    hostname: config.bridgeBind, // Default 127.0.0.1 — set BRIDGE_BIND=0.0.0.0 in Docker
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method

      // Health check
      if (path === '/health' && method === 'GET') {
        const status = handler.getStatus()
        return Response.json({
          status: 'ok',
          uptime: process.uptime(),
          sipConfigured,
          sipConfigSkipped,
          ...status,
        })
      }

      // Status endpoint (detailed)
      if (path === '/status' && method === 'GET') {
        try {
          const ariInfo = await ari.getAsteriskInfo()
          const channels = await ari.listChannels()
          const bridges = await ari.listBridges()
          return Response.json({
            status: 'ok',
            bridge: handler.getStatus(),
            asterisk: ariInfo,
            channels: channels.length,
            bridges: bridges.length,
          })
        } catch (err) {
          return Response.json(
            {
              status: 'error',
              error: String(err),
              bridge: handler.getStatus(),
            },
            { status: 500 }
          )
        }
      }

      // Command endpoint — receives commands from CF Worker
      if (path === '/command' && method === 'POST') {
        // Verify signature
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()

        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) {
            console.warn('[bridge] Invalid command signature')
            return new Response('Forbidden', { status: 403 })
          }
        }

        try {
          const data = JSON.parse(body) as Record<string, unknown>
          const result = await handler.handleHttpCommand(data)
          return Response.json(result, { status: result.ok ? 200 : 400 })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Ring volunteers endpoint — Worker calls this to initiate parallel ringing
      if (path === '/ring' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()

        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) {
            return new Response('Forbidden', { status: 403 })
          }
        }

        try {
          const data = JSON.parse(body) as {
            callSid?: string
            parentCallSid?: string
            callerNumber: string
            volunteers: Array<{ pubkey: string; phone?: string; browserIdentity?: string }>
            callbackUrl: string
          }

          // Support both callSid and parentCallSid field names
          const parentCallSid = data.parentCallSid ?? data.callSid ?? ''
          const channelIds: string[] = []

          for (const vol of data.volunteers) {
            // Ring phone leg (PJSIP trunk dial)
            if (vol.phone) {
              const endpoint = `PJSIP/${vol.phone}@trunk`
              try {
                const channel = await ari.originate({
                  endpoint,
                  callerId: data.callerNumber,
                  timeout: 30,
                  app: config.stasisApp,
                  appArgs: `dialed,${parentCallSid},${vol.pubkey},phone`,
                })
                channelIds.push(channel.id)

                const parentCall = handler.getCall(parentCallSid)
                if (parentCall) {
                  parentCall.ringingChannels.push(channel.id)
                }
                handler.trackRingingChannel(channel.id, parentCallSid)
              } catch (err) {
                console.error(`[bridge] Failed to ring ${vol.pubkey} (phone):`, err)
              }
            }

            // Ring browser leg (PJSIP endpoint provisioned via /provision-endpoint)
            if (vol.browserIdentity) {
              const endpoint = `PJSIP/${vol.browserIdentity}`
              try {
                const channel = await ari.originate({
                  endpoint,
                  callerId: data.callerNumber,
                  timeout: 30,
                  app: config.stasisApp,
                  appArgs: `dialed,${parentCallSid},${vol.pubkey},browser`,
                })
                channelIds.push(channel.id)

                const parentCall = handler.getCall(parentCallSid)
                if (parentCall) {
                  parentCall.ringingChannels.push(channel.id)
                }
                handler.trackRingingChannel(channel.id, parentCallSid)
              } catch (err) {
                console.error(`[bridge] Failed to ring ${vol.pubkey} (browser):`, err)
              }
            }
          }

          return Response.json({ ok: true, channelIds })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Cancel ringing endpoint
      if (path === '/cancel-ringing' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()

        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) {
            return new Response('Forbidden', { status: 403 })
          }
        }

        try {
          const data = JSON.parse(body) as { channelIds: string[]; exceptId?: string }
          for (const id of data.channelIds) {
            if (id !== data.exceptId) {
              try {
                await ari.hangupChannel(id)
              } catch {
                /* may already be gone */
              }
            }
          }
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Get recording audio
      if (path.startsWith('/recordings/') && method === 'GET') {
        const signature =
          request.headers.get('X-Bridge-Signature') ?? url.searchParams.get('sig') ?? ''
        // Allow either header or query param for signature (for simple GET requests)
        if (config.bridgeSecret && !signature) {
          return new Response('Forbidden', { status: 403 })
        }

        const name = path.replace('/recordings/', '')
        try {
          const audio = await ari.getRecordingFile(name)
          if (!audio) {
            return new Response('Not Found', { status: 404 })
          }
          return new Response(audio, {
            headers: {
              'Content-Type': 'audio/wav',
              'Content-Length': String(audio.byteLength),
            },
          })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      }

      // Hangup endpoint — simple channel hangup
      if (path === '/hangup' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()

        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) {
            return new Response('Forbidden', { status: 403 })
          }
        }

        try {
          const data = JSON.parse(body) as { channelId: string }
          await ari.hangupChannel(data.channelId)
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Provision SIP endpoint for volunteer WebRTC
      if (path === '/provision-endpoint' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()

        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) {
            return new Response('Forbidden', { status: 403 })
          }
        }

        try {
          const { pubkey } = JSON.parse(body) as { pubkey: string }
          const { provisionEndpoint } = await import('./endpoint-provisioner')
          const result = await provisionEndpoint(ari, pubkey)
          return Response.json({ ok: true, ...result })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Deprovision SIP endpoint
      if (path === '/deprovision-endpoint' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()

        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) {
            return new Response('Forbidden', { status: 403 })
          }
        }

        try {
          const { pubkey } = JSON.parse(body) as { pubkey: string }
          const { deprovisionEndpoint } = await import('./endpoint-provisioner')
          await deprovisionEndpoint(ari, pubkey)
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // Check SIP endpoint exists
      if (path === '/check-endpoint' && method === 'POST') {
        const signature = request.headers.get('X-Bridge-Signature') ?? ''
        const body = await request.clone().text()

        if (config.bridgeSecret) {
          const isValid = await webhook.verifySignature(url.toString(), body, signature)
          if (!isValid) {
            return new Response('Forbidden', { status: 403 })
          }
        }

        try {
          const { pubkey } = JSON.parse(body) as { pubkey: string }
          const username = `vol_${pubkey.slice(0, 12)}`
          // Try to read the endpoint config — if it exists, the endpoint is provisioned
          try {
            await ari.getAsteriskInfo() // Use a lightweight ARI call to check connectivity
            // For now, just verify we can construct the username — full check would need
            // a GET to /asterisk/config/dynamic/res_pjsip/endpoint/{username}
            // which requires adding a getDynamic method. Keep it simple for now.
            return Response.json({ ok: true, exists: true, username })
          } catch {
            return Response.json({ ok: true, exists: false })
          }
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[bridge] HTTP server listening on port ${config.bridgePort}`)

  // Connect to ARI WebSocket
  try {
    await ari.connect()
    console.log('[bridge] Connected to Asterisk ARI')
  } catch (err) {
    console.error('[bridge] Failed to connect to ARI:', err)
    console.log('[bridge] Will retry connection...')
  }

  // Verify ARI connectivity
  try {
    const info = await ari.getAsteriskInfo()
    console.log('[bridge] Asterisk info:', JSON.stringify(info).substring(0, 200))
  } catch (err) {
    console.warn('[bridge] Could not fetch Asterisk info (will retry on reconnect):', err)
  }

  // Auto-configure PJSIP SIP trunk if credentials are provided
  if (config.sipProvider && config.sipUsername && config.sipPassword) {
    try {
      const pjsip = new PjsipConfigurator(ari)
      await pjsip.configure(config.sipProvider, config.sipUsername, config.sipPassword)
      sipConfigured = true
    } catch (err) {
      console.error('[bridge] PJSIP auto-config failed:', err)
      // Non-fatal — bridge can still handle calls if pjsip.conf was pre-configured
    }
  } else {
    console.log('[bridge] SIP env vars not set — skipping PJSIP auto-config')
    sipConfigSkipped = true
  }

  console.log('[bridge] Asterisk ARI Bridge is running')
  console.log(`[bridge] Webhook target: ${config.workerWebhookUrl}`)
  console.log(`[bridge] ARI: ${config.ariUrl}`)
  console.log(`[bridge] Stasis app: ${config.stasisApp}`)

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('[bridge] Shutting down...')
    ari.disconnect()
    server.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('[bridge] Shutting down...')
    ari.disconnect()
    server.stop()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[bridge] Fatal error:', err)
  process.exit(1)
})
