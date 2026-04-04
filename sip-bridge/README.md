# SIP Bridge

Unified SIP bridge for Llamenos — translates PBX protocol events into HTTP webhooks and receives JSON commands back from the Llamenos server.

## Architecture

The SIP bridge supports multiple PBX backends through a common `BridgeClient` interface:

| PBX | Protocol | Client | Status |
|-----|----------|--------|--------|
| **Asterisk** (default) | ARI (WebSocket + REST) | `AriClient` | Production-ready |
| FreeSWITCH | ESL (TCP) | `EslClient` | Foundation |
| Kamailio | JSONRPC (HTTP) | `KamailioClient` | Management only |

Asterisk is the recommended and default PBX for all deployment modes.

## How It Works

1. The bridge connects to the PBX using the protocol-specific client
2. PBX events (call create, answer, hangup, DTMF, recording) are normalized to `BridgeEvent` objects
3. The `WebhookSender` translates events into HMAC-signed HTTP POSTs to the Llamenos server
4. The Llamenos server responds with JSON commands (play, gather, bridge, record, hangup)
5. The `CommandHandler` executes commands via the PBX client

## Configuration

Set `PBX_TYPE` to select the PBX backend:

```bash
# Asterisk (default)
PBX_TYPE=asterisk
ARI_URL=ws://asterisk:8088/ari/events
ARI_REST_URL=http://asterisk:8088/ari
ARI_USERNAME=llamenos
ARI_PASSWORD=<secret>
STASIS_APP=llamenos

# FreeSWITCH
PBX_TYPE=freeswitch
ESL_HOST=freeswitch
ESL_PORT=8021
ESL_PASSWORD=<secret>

# Kamailio (optional, alongside a PBX)
KAMAILIO_ENABLED=true
KAMAILIO_JSONRPC_URL=http://kamailio:5060/jsonrpc
```

Shared environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKER_WEBHOOK_URL` | Yes | Llamenos server URL for webhook delivery |
| `BRIDGE_SECRET` | Yes | HMAC shared secret for webhook signing |
| `BRIDGE_PORT` | No | HTTP server port (default: 3000) |
| `BRIDGE_BIND` | No | Bind address (default: 127.0.0.1) |
| `HOTLINE_NUMBER` | No | Hotline phone number for call routing |

## Development

```bash
bun install
bun run dev          # Watch mode
bun run typecheck    # Type check
bun test             # Run tests
bun run build        # Build for production
```

## Project Structure

```
sip-bridge/
  src/
    bridge-client.ts        # BridgeClient interface + BridgeEvent types
    types.ts                # ARI-specific types (events, resources, commands)
    clients/
      ari-client.ts         # Asterisk ARI client (WebSocket + REST)
      esl-client.ts         # FreeSWITCH ESL client (TCP)
      kamailio-client.ts    # Kamailio JSONRPC client (HTTP, management only)
    index.ts                # Unified entry point (PBX_TYPE selection)
    webhook-sender.ts       # HMAC-signed HTTP webhooks to Llamenos server
    command-handler.ts      # Executes JSON commands via PBX client
    pjsip-configurator.ts   # Asterisk PJSIP SIP trunk auto-config
    endpoint-provisioner.ts # Dynamic SIP endpoint provisioning
  asterisk-config/          # Asterisk configuration files
  Dockerfile                # Multi-stage production build
```

## Docker

```bash
docker build -f sip-bridge/Dockerfile -t llamenos-sip-bridge .
docker run -e PBX_TYPE=asterisk -e ARI_USERNAME=llamenos -e ARI_PASSWORD=secret \
  -e WORKER_WEBHOOK_URL=https://app.example.com -e BRIDGE_SECRET=secret \
  llamenos-sip-bridge
```
