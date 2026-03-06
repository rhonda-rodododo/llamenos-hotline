# Llamenos

**Category**: Communication
**Status**: 1 (alpha)
**Image**: [`ghcr.io/rhonda-rodododo/llamenos`](https://github.com/rhonda-rodododo/llamenos/pkgs/container/llamenos)
**Upstream**: <https://github.com/rhonda-rodododo/llamenos>

Secure, open-source crisis response hotline software with end-to-end encryption.

## Features

| Feature | Status |
|---------|--------|
| E2EE notes & transcriptions | Yes |
| Multi-provider telephony (Twilio, SignalWire, Vonage, Plivo, Asterisk) | Yes |
| Multi-channel messaging (SMS, WhatsApp, Signal) | Yes |
| Encrypted reporting portal | Yes |
| Multi-language (13 languages) | Yes |
| Admin/volunteer role separation | Yes |
| Docker Swarm secrets | Yes |
| Backupbot integration | Yes |

## Secrets

| Name | Type | Description |
|------|------|-------------|
| `hmac_secret` | hex (64 chars) | HMAC signing key for session tokens |
| `server_nostr` | hex (64 chars) | Server Nostr identity key |
| `db_password` | alnum (32 chars) | PostgreSQL password |
| `minio_access` | alnum (20 chars) | MinIO access key |
| `minio_secret` | alnum (40 chars) | MinIO secret key |

## First login

After deployment, visit your domain in a browser. The setup wizard will guide you through creating an admin account, naming your hotline, and configuring communication channels.

## Optional services

Enable optional services by adding overlays to `COMPOSE_FILE` in your app config:

- **Transcription**: `compose.yml:compose.transcription.yml`
- **Asterisk PBX**: `compose.yml:compose.asterisk.yml`
- **Signal messaging**: `compose.yml:compose.signal.yml`
