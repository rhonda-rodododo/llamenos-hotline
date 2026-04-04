import { AriClient } from './clients/ari-client'
import { EslClient } from './clients/esl-client'
import { KamailioClient } from './clients/kamailio-client'
import { CommandHandler } from './command-handler'
import { PjsipConfigurator } from './pjsip-configurator'
import type { BridgeConfig } from './types'
import { WebhookSender } from './webhook-sender'

type PbxType = 'asterisk' | 'freeswitch'

/**
 * Verify an incoming command signature from the Llamenos server's BridgeClient.
 * BridgeClient signs: HMAC-SHA256(secret, "timestamp.body") → hex string.
 * Headers: X-Bridge-Signature (hex), X-Bridge-Timestamp (unix seconds).
 * Rejects timestamps older than 5 minutes (replay protection).
 */
async function verifyBridgeSignature(
  request: Request,
  body: string,
  secret: string
): Promise<boolean> {
  const signature = request.headers.get('X-Bridge-Signature')
  if (!signature) return false

  const timestamp = request.headers.get('X-Bridge-Timestamp') ?? ''
  const tsSeconds = Number.parseInt(timestamp, 10)
  if (Number.isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
    return false
  }

  const payload = `${timestamp}.${body}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const expectedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison
  if (signature.length !== expectedSig.length) return false
  const encoder = new TextEncoder()
  const aBuf = encoder.encode(signature)
  const bBuf = encoder.encode(expectedSig)
  let result = 0
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i]
  }
  return result === 0
}

/** Load configuration from environment variables */
function loadConfig(): BridgeConfig {
  const ariUrl = process.env.ARI_URL ?? 'ws://localhost:8088/ari/events'
  const ariRestUrl = process.env.ARI_REST_URL ?? 'http://localhost:8088/ari'
  const ariUsername = process.env.ARI_USERNAME ?? ''
  const ariPassword = process.env.ARI_PASSWORD ?? ''
  const workerWebhookUrl = process.env.WORKER_WEBHOOK_URL
  const bridgeSecret = process.env.BRIDGE_SECRET
  const bridgePort = Number.parseInt(process.env.BRIDGE_PORT ?? '3000', 10)
  const bridgeBind = process.env.BRIDGE_BIND ?? '127.0.0.1'
  const stasisApp = process.env.STASIS_APP ?? 'llamenos'

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
  const pbxType: PbxType = (process.env.PBX_TYPE ?? 'asterisk') as PbxType
  console.log(`[sip-bridge] Starting with PBX_TYPE=${pbxType}`)

  const config = loadConfig()

  // Optional Kamailio sidecar
  const kamailioEnabled = process.env.KAMAILIO_ENABLED === 'true'
  const kamailioJsonrpcUrl = process.env.KAMAILIO_JSONRPC_URL

  let kamailioClient: KamailioClient | null = null
  if (kamailioEnabled) {
    if (!kamailioJsonrpcUrl) {
      throw new Error('KAMAILIO_JSONRPC_URL is required when KAMAILIO_ENABLED=true')
    }
    kamailioClient = new KamailioClient({ jsonrpcUrl: kamailioJsonrpcUrl })
    console.log(`[sip-bridge] Kamailio JSONRPC enabled at ${kamailioJsonrpcUrl}`)
  }

  // ARI-specific state — reported on /health
  let sipConfigured = false
  let sipConfigSkipped = false

  // Set up PBX client and optional ARI components
  let ari: AriClient | null = null
  let esl: EslClient | null = null
  let handler: CommandHandler | null = null
  let webhook: WebhookSender | null = null

  if (pbxType === 'asterisk') {
    if (!config.ariUsername) throw new Error('ARI_USERNAME is required for asterisk PBX_TYPE')
    if (!config.ariPassword) throw new Error('ARI_PASSWORD is required for asterisk PBX_TYPE')

    ari = new AriClient(config)
    webhook = new WebhookSender(config)
    handler = new CommandHandler(ari, webhook, config)

    if (process.env.HOTLINE_NUMBER) {
      handler.setHotlineNumber(process.env.HOTLINE_NUMBER)
    }

    // Register CommandHandler on raw ARI events (CommandHandler needs ARI-specific event shapes)
    ari.onRawEvent((event) => {
      handler?.handleEvent(event).catch((err) => {
        console.error('[sip-bridge] Event handler error:', err)
      })
    })
  } else if (pbxType === 'freeswitch') {
    const eslHost = process.env.ESL_HOST ?? 'localhost'
    const eslPort = Number.parseInt(process.env.ESL_PORT ?? '8021', 10)
    const eslPassword = process.env.ESL_PASSWORD ?? 'ClueCon'

    esl = new EslClient({
      host: eslHost,
      port: eslPort,
      password: eslPassword,
      connectionTimeoutMs: config.connectionTimeoutMs,
    })

    esl.onEvent((event) => {
      // Plan B: add FreeSWITCH CommandHandler. For now, log events.
      console.log(`[sip-bridge] FreeSWITCH event: type=${event.type} channel=${event.channelId}`)
    })
  }

  // Start HTTP server
  const server = Bun.serve({
    port: config.bridgePort,
    hostname: config.bridgeBind,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method

      // ---- GET /health ----
      if (path === '/health' && method === 'GET') {
        let pbxHealth: Record<string, unknown> = {}
        let kamailioHealth: Record<string, unknown> | undefined

        if (ari) {
          const h = await ari.healthCheck().catch((err) => ({
            ok: false,
            latencyMs: -1,
            details: { error: String(err) },
          }))
          pbxHealth = { ...h }
        } else if (esl) {
          pbxHealth = { ok: esl.isConnected(), latencyMs: -1 }
        }

        if (kamailioClient) {
          const kh = await kamailioClient.healthCheck().catch((err) => ({
            ok: false,
            latencyMs: -1,
            details: { error: String(err) },
          }))
          kamailioHealth = { ...kh }
        }

        const bridgeStatus = handler?.getStatus() ?? {}

        return Response.json({
          status: 'ok',
          pbxType,
          uptime: process.uptime(),
          sipConfigured,
          sipConfigSkipped,
          pbx: pbxHealth,
          ...(kamailioHealth ? { kamailio: kamailioHealth } : {}),
          ...bridgeStatus,
        })
      }

      // ---- GET /status ----
      if (path === '/status' && method === 'GET') {
        if (!ari) {
          return Response.json(
            { status: 'error', error: '/status only available for asterisk PBX_TYPE' },
            { status: 501 }
          )
        }
        try {
          const ariInfo = await ari.getAsteriskInfo()
          const channels = await ari.listChannels()
          const bridges = await ari.listBridges()
          return Response.json({
            status: 'ok',
            bridge: handler?.getStatus(),
            asterisk: ariInfo,
            channels: channels.length,
            bridges: bridges.length,
          })
        } catch (err) {
          return Response.json(
            {
              status: 'error',
              error: String(err),
              bridge: handler?.getStatus(),
            },
            { status: 500 }
          )
        }
      }

      // ---- POST /command ----
      if (path === '/command' && method === 'POST') {
        if (!handler || !webhook) {
          return Response.json(
            { ok: false, error: '/command only available for asterisk PBX_TYPE' },
            { status: 501 }
          )
        }

        const body = await request.clone().text()

        const isValid = await verifyBridgeSignature(request, body, config.bridgeSecret)
        if (!isValid) {
          console.warn('[sip-bridge] Invalid command signature')
          return new Response('Forbidden', { status: 403 })
        }

        try {
          const data = JSON.parse(body) as Record<string, unknown>
          const result = await handler.handleHttpCommand(data)
          return Response.json(result, { status: result.ok ? 200 : 400 })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // ---- POST /ring ----
      if (path === '/ring' && method === 'POST') {
        if (!ari || !handler || !webhook) {
          return Response.json(
            { ok: false, error: '/ring only available for asterisk PBX_TYPE' },
            { status: 501 }
          )
        }

        const body = await request.clone().text()

        const isValid = await verifyBridgeSignature(request, body, config.bridgeSecret)
        if (!isValid) {
          return new Response('Forbidden', { status: 403 })
        }

        try {
          const data = JSON.parse(body) as {
            callSid?: string
            parentCallSid?: string
            callerNumber: string
            volunteers: Array<{ pubkey: string; phone?: string; browserIdentity?: string }>
            callbackUrl: string
          }

          const parentCallSid = data.parentCallSid ?? data.callSid ?? ''
          const channelIds: string[] = []

          for (const vol of data.volunteers) {
            // Ring phone leg (PJSIP trunk dial)
            if (vol.phone) {
              const endpoint = `PJSIP/${vol.phone}@trunk`
              try {
                const channel = await ari.originateChannel({
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
                console.error(`[sip-bridge] Failed to ring ${vol.pubkey} (phone):`, err)
              }
            }

            // Ring browser leg (PJSIP endpoint provisioned via /provision-endpoint)
            if (vol.browserIdentity) {
              const endpoint = `PJSIP/${vol.browserIdentity}`
              try {
                const channel = await ari.originateChannel({
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
                console.error(`[sip-bridge] Failed to ring ${vol.pubkey} (browser):`, err)
              }
            }
          }

          return Response.json({ ok: true, channelIds })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // ---- POST /cancel-ringing ----
      if (path === '/cancel-ringing' && method === 'POST') {
        if (!ari || !webhook) {
          return Response.json(
            { ok: false, error: '/cancel-ringing only available for asterisk PBX_TYPE' },
            { status: 501 }
          )
        }

        const body = await request.clone().text()

        const isValid = await verifyBridgeSignature(request, body, config.bridgeSecret)
        if (!isValid) {
          return new Response('Forbidden', { status: 403 })
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

      // ---- GET /recordings/:name ----
      if (path.startsWith('/recordings/') && method === 'GET') {
        if (!ari) {
          return Response.json(
            { error: '/recordings only available for asterisk PBX_TYPE' },
            { status: 501 }
          )
        }

        const isValid = await verifyBridgeSignature(request, '', config.bridgeSecret)
        if (!isValid) {
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

      // ---- POST /hangup ----
      if (path === '/hangup' && method === 'POST') {
        if (!ari || !webhook) {
          return Response.json(
            { ok: false, error: '/hangup only available for asterisk PBX_TYPE' },
            { status: 501 }
          )
        }

        const body = await request.clone().text()

        const isValid = await verifyBridgeSignature(request, body, config.bridgeSecret)
        if (!isValid) {
          return new Response('Forbidden', { status: 403 })
        }

        try {
          const data = JSON.parse(body) as { channelId: string }
          await ari.hangupChannel(data.channelId)
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      // ---- POST /provision-endpoint ----
      if (path === '/provision-endpoint' && method === 'POST') {
        if (!ari || !webhook) {
          return Response.json(
            { ok: false, error: '/provision-endpoint only available for asterisk PBX_TYPE' },
            { status: 501 }
          )
        }

        const body = await request.clone().text()

        const isValid = await verifyBridgeSignature(request, body, config.bridgeSecret)
        if (!isValid) {
          return new Response('Forbidden', { status: 403 })
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

      // ---- POST /deprovision-endpoint ----
      if (path === '/deprovision-endpoint' && method === 'POST') {
        if (!ari || !webhook) {
          return Response.json(
            { ok: false, error: '/deprovision-endpoint only available for asterisk PBX_TYPE' },
            { status: 501 }
          )
        }

        const body = await request.clone().text()

        const isValid = await verifyBridgeSignature(request, body, config.bridgeSecret)
        if (!isValid) {
          return new Response('Forbidden', { status: 403 })
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

      // ---- POST /check-endpoint ----
      if (path === '/check-endpoint' && method === 'POST') {
        if (!ari || !webhook) {
          return Response.json(
            { ok: false, error: '/check-endpoint only available for asterisk PBX_TYPE' },
            { status: 501 }
          )
        }

        const body = await request.clone().text()

        const isValid = await verifyBridgeSignature(request, body, config.bridgeSecret)
        if (!isValid) {
          return new Response('Forbidden', { status: 403 })
        }

        try {
          const { pubkey } = JSON.parse(body) as { pubkey: string }
          const { checkEndpoint } = await import('./endpoint-provisioner')
          const exists = await checkEndpoint(ari, pubkey)
          const username = `vol_${pubkey.slice(0, 12)}`
          return Response.json({ ok: true, exists, username })
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 })
        }
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[sip-bridge] HTTP server listening on port ${config.bridgePort}`)

  // Connect to PBX
  if (ari) {
    try {
      await ari.connect()
      console.log('[sip-bridge] Connected to Asterisk ARI')
    } catch (err) {
      console.error('[sip-bridge] Failed to connect to ARI:', err)
      console.log('[sip-bridge] Will retry connection...')
    }

    try {
      const info = await ari.getAsteriskInfo()
      console.log('[sip-bridge] Asterisk info:', JSON.stringify(info).substring(0, 200))
    } catch (err) {
      console.warn('[sip-bridge] Could not fetch Asterisk info (will retry on reconnect):', err)
    }

    // Auto-configure PJSIP SIP trunk if credentials are provided
    if (config.sipProvider && config.sipUsername && config.sipPassword) {
      try {
        const pjsip = new PjsipConfigurator(ari)
        await pjsip.configure(config.sipProvider, config.sipUsername, config.sipPassword)
        sipConfigured = true
      } catch (err) {
        console.error('[sip-bridge] PJSIP auto-config failed:', err)
        // Non-fatal — bridge can still handle calls if pjsip.conf was pre-configured
      }
    } else {
      console.log('[sip-bridge] SIP env vars not set — skipping PJSIP auto-config')
      sipConfigSkipped = true
    }

    console.log('[sip-bridge] Asterisk ARI Bridge is running')
    console.log(`[sip-bridge] Webhook target: ${config.workerWebhookUrl}`)
    console.log(`[sip-bridge] ARI: ${config.ariUrl}`)
    console.log(`[sip-bridge] Stasis app: ${config.stasisApp}`)
  } else if (esl) {
    try {
      await esl.connect()
      console.log('[sip-bridge] Connected to FreeSWITCH ESL')
    } catch (err) {
      console.error('[sip-bridge] Failed to connect to FreeSWITCH ESL:', err)
      console.log('[sip-bridge] Will retry connection...')
    }

    console.log(
      '[sip-bridge] FreeSWITCH ESL Bridge is running (event logging only; Plan B adds full command handler)'
    )
    console.log(
      `[sip-bridge] ESL: ${process.env.ESL_HOST ?? 'localhost'}:${process.env.ESL_PORT ?? '8021'}`
    )
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('[sip-bridge] Shutting down...')
    ari?.disconnect()
    esl?.disconnect()
    server.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[sip-bridge] Fatal error:', err)
  process.exit(1)
})
