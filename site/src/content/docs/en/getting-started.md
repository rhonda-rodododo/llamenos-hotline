---
title: Getting Started
description: Deploy your own Llamenos hotline in minutes.
---

Get a Llamenos hotline running locally or on a server. Only Docker is required — no Node.js, Bun, or other runtimes needed.

## How it works

When someone calls your hotline number, Llamenos routes the call to all on-shift volunteers simultaneously. The first volunteer to answer gets connected, and the others stop ringing. After the call ends, the volunteer can save encrypted notes about the conversation.

```mermaid
flowchart TD
    A["Incoming Call"] --> B{"Shift Active?"}
    B -->|Yes| C["Ring All On-Shift Volunteers"]
    B -->|No| D["Ring Fallback Group"]
    C --> E{"First Pickup"}
    D --> E
    E -->|"Answered"| F["Connect Call"]
    E -->|"No Answer"| G["Voicemail"]
    F --> H["Save Encrypted Note"]
```

The same routing applies to SMS, WhatsApp, and Signal messages — they appear in a unified **Conversations** view where volunteers can respond.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2
- `openssl` (pre-installed on most Linux and macOS systems)
- Git

## Quick start

```bash
git clone https://github.com/rhonda-rodododo/llamenos.git
cd llamenos
./scripts/docker-setup.sh
```

This generates all required secrets, builds the application, and starts the services. Once complete, visit **http://localhost** and the setup wizard will guide you through:

1. **Create your admin account** — generates a cryptographic keypair in your browser
2. **Name your hotline** — set the display name
3. **Choose channels** — enable Voice, SMS, WhatsApp, Signal, and/or Reports
4. **Configure providers** — enter credentials for each enabled channel
5. **Review and finish**

### Try demo mode

To explore with pre-seeded sample data and one-click login (no account creation needed):

```bash
./scripts/docker-setup.sh --demo
```

## Production deployment

For a server with a real domain and automatic TLS:

```bash
./scripts/docker-setup.sh --domain hotline.yourorg.com --email admin@yourorg.com
```

Caddy automatically provisions Let's Encrypt TLS certificates. Make sure ports 80 and 443 are open.

See the [Docker Compose deployment guide](/docs/deploy-docker) for full details on server hardening, backups, monitoring, and optional services.

## Configure webhooks

After deploying, point your telephony provider's webhooks to your deployment URL:

| Webhook | URL |
|---------|-----|
| Voice (incoming) | `https://your-domain/api/telephony/incoming` |
| Voice (status) | `https://your-domain/api/telephony/status` |
| SMS | `https://your-domain/api/messaging/sms/webhook` |
| WhatsApp | `https://your-domain/api/messaging/whatsapp/webhook` |
| Signal | Configure bridge to forward to `https://your-domain/api/messaging/signal/webhook` |

For provider-specific setup: [Twilio](/docs/setup-twilio), [SignalWire](/docs/setup-signalwire), [Vonage](/docs/setup-vonage), [Plivo](/docs/setup-plivo), [Asterisk](/docs/setup-asterisk), [SMS](/docs/setup-sms), [WhatsApp](/docs/setup-whatsapp), [Signal](/docs/setup-signal).

## Next steps

- [Docker Compose Deployment](/docs/deploy-docker) — full production deployment guide with backups and monitoring
- [Admin Guide](/docs/admin-guide) — add volunteers, create shifts, configure channels and settings
- [Volunteer Guide](/docs/volunteer-guide) — share with your volunteers
- [Reporter Guide](/docs/reporter-guide) — set up the reporter role for encrypted report submissions
- [Telephony Providers](/docs/telephony-providers) — compare voice providers
- [Security Model](/security) — understand the encryption and threat model
