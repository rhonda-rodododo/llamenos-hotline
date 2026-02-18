---
title: Documentation
description: Learn how to deploy, configure, and use Llamenos.
guidesHeading: Guides
guides:
  - title: Getting Started
    description: Prerequisites, installation, setup wizard, and your first deployment.
    href: /docs/getting-started
  - title: Admin Guide
    description: Manage volunteers, shifts, channels, ban lists, reports, and settings.
    href: /docs/admin-guide
  - title: Volunteer Guide
    description: Log in, receive calls, respond to messages, write notes, and use transcription.
    href: /docs/volunteer-guide
  - title: Reporter Guide
    description: Submit encrypted reports and track their status.
    href: /docs/reporter-guide
  - title: Telephony Providers
    description: Compare supported telephony providers and choose the best fit for your hotline.
    href: /docs/telephony-providers
  - title: "Setup: SMS"
    description: Enable inbound/outbound SMS messaging via your telephony provider.
    href: /docs/setup-sms
  - title: "Setup: WhatsApp"
    description: Connect WhatsApp Business via the Meta Cloud API.
    href: /docs/setup-whatsapp
  - title: "Setup: Signal"
    description: Set up the Signal channel via the signal-cli bridge.
    href: /docs/setup-signal
  - title: "Setup: Twilio"
    description: Step-by-step guide to configure Twilio as your telephony provider.
    href: /docs/setup-twilio
  - title: "Setup: SignalWire"
    description: Step-by-step guide to configure SignalWire as your telephony provider.
    href: /docs/setup-signalwire
  - title: "Setup: Vonage"
    description: Step-by-step guide to configure Vonage as your telephony provider.
    href: /docs/setup-vonage
  - title: "Setup: Plivo"
    description: Step-by-step guide to configure Plivo as your telephony provider.
    href: /docs/setup-plivo
  - title: "Setup: Asterisk (Self-Hosted)"
    description: Deploy Asterisk with the ARI bridge for maximum privacy and control.
    href: /docs/setup-asterisk
  - title: WebRTC Browser Calling
    description: Enable in-browser call answering for volunteers using WebRTC.
    href: /docs/webrtc-calling
  - title: Security Model
    description: Understand what's encrypted, what isn't, and the threat model.
    href: /security
---

## Architecture overview

Llamenos is a single-page application (SPA) backed by Cloudflare Workers and Durable Objects. There are no traditional servers to manage. It supports voice calls, SMS, WhatsApp, and Signal — all routed to on-shift volunteers through a unified interface.

| Component | Technology |
|---|---|
| Frontend | Vite + React + TanStack Router |
| Backend | Cloudflare Workers + 4 Durable Objects |
| Voice | Twilio, SignalWire, Vonage, Plivo, or Asterisk (via TelephonyAdapter) |
| Messaging | SMS, WhatsApp Business, Signal (via MessagingAdapter) |
| Auth | Nostr keypairs (BIP-340 Schnorr) + WebAuthn |
| Encryption | ECIES (secp256k1 + XChaCha20-Poly1305) |
| Transcription | Cloudflare Workers AI (Whisper) |
| i18n | i18next (12+ languages) |

## Roles

| Role | Can see | Can do |
|---|---|---|
| **Caller** | Nothing (phone/SMS/WhatsApp/Signal) | Call or message the hotline |
| **Volunteer** | Own notes, assigned conversations | Answer calls, write notes, respond to messages |
| **Reporter** | Own reports only | Submit encrypted reports with file attachments |
| **Admin** | All notes, reports, conversations, audit logs | Manage volunteers, shifts, channels, bans, settings |
