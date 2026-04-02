---
title: Documentation
description: Learn how to deploy, configure, and use Llamenos.
guidesHeading: Guides
guides:
  - title: Getting Started
    description: Prerequisites, installation, setup wizard, and your first deployment.
    href: /docs/deploy/
  - title: Self-Hosting Overview
    description: Deploy on your own infrastructure with Docker Compose or Kubernetes.
    href: /docs/deploy/self-hosting
  - title: "Deploy: Docker Compose"
    description: Single-server self-hosted deployment with automatic HTTPS.
    href: /docs/deploy/docker
  - title: "Deploy: Kubernetes (Helm)"
    description: Deploy to Kubernetes with the official Helm chart.
    href: /docs/deploy/kubernetes
  - title: "Deploy: Co-op Cloud"
    description: Deploy as a standardized recipe for cooperative hosting collectives.
    href: /docs/deploy/coopcloud
  - title: Guides
    description: Browse guides by audience and topic — operators, staff, and callers.
    href: /docs/guides/
  - title: Telephony Providers
    description: Compare supported telephony providers and choose the best fit for your hotline.
    href: /docs/deploy/providers/
  - title: "Setup: SMS"
    description: Enable inbound/outbound SMS messaging via your telephony provider.
    href: /docs/deploy/providers/sms
  - title: "Setup: WhatsApp"
    description: Connect WhatsApp Business via the Meta Cloud API.
    href: /docs/deploy/providers/whatsapp
  - title: "Setup: Signal"
    description: Set up the Signal channel via the signal-cli bridge.
    href: /docs/deploy/providers/signal
  - title: "Setup: Twilio"
    description: Step-by-step guide to configure Twilio as your telephony provider.
    href: /docs/deploy/providers/twilio
  - title: "Setup: SignalWire"
    description: Step-by-step guide to configure SignalWire as your telephony provider.
    href: /docs/deploy/providers/signalwire
  - title: "Setup: Vonage"
    description: Step-by-step guide to configure Vonage as your telephony provider.
    href: /docs/deploy/providers/vonage
  - title: "Setup: Plivo"
    description: Step-by-step guide to configure Plivo as your telephony provider.
    href: /docs/deploy/providers/plivo
  - title: "Setup: Asterisk (Self-Hosted)"
    description: Deploy Asterisk with the ARI bridge for maximum privacy and control.
    href: /docs/deploy/providers/asterisk
  - title: WebRTC Browser Calling
    description: Enable in-browser call answering for volunteers using WebRTC.
    href: /docs/deploy/providers/webrtc
  - title: Security Model
    description: Understand what's encrypted, what isn't, and the threat model.
    href: /security
---

## Architecture overview

Llamenos is a single-page application (SPA) that can run on **Cloudflare Workers** or on your own infrastructure via **Docker Compose / Kubernetes**. It supports voice calls, SMS, WhatsApp, and Signal — all routed to on-shift volunteers through a unified interface.

| Component | Cloudflare | Self-Hosted |
|---|---|---|
| Frontend | Vite + React + TanStack Router | Same |
| Backend | Cloudflare Workers + 6 Durable Objects | Node.js + PostgreSQL |
| Blob Storage | R2 | RustFS (S3-compatible) |
| Voice | Twilio, SignalWire, Vonage, Plivo, or Asterisk | Same |
| Messaging | SMS, WhatsApp Business, Signal | Same |
| Auth | Nostr keypairs (BIP-340 Schnorr) + WebAuthn | Same |
| Encryption | ECIES (secp256k1 + XChaCha20-Poly1305) | Same |
| Transcription | Client-side Whisper (WASM) | Client-side Whisper (WASM) |
| i18n | i18next (13 languages) | Same |

## Roles

| Role | Can see | Can do |
|---|---|---|
| **Caller** | Nothing (phone/SMS/WhatsApp/Signal) | Call or message the hotline |
| **Volunteer** | Own notes, assigned conversations | Answer calls, write notes, respond to messages |
| **Reporter** | Own reports only | Submit encrypted reports with file attachments |
| **Admin** | All notes, reports, conversations, audit logs | Manage volunteers, shifts, channels, bans, settings |
