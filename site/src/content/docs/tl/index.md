---
title: Dokumentasyon
description: Alamin kung paano mag-deploy, mag-configure, at gamitin ang Llamenos.
guidesHeading: Mga Gabay
guides:
  - title: Pagsisimula
    description: Mga kinakailangan, pag-install, pag-setup ng telephony, at iyong unang deployment.
    href: /docs/getting-started
  - title: Gabay para sa Admin
    description: Pamahalaan ang mga boluntaryo, shift, ban list, custom field, at mga setting.
    href: /docs/admin-guide
  - title: Gabay para sa Boluntaryo
    description: Mag-log in, tumanggap ng mga tawag, sumulat ng mga nota, at gamitin ang transcription.
    href: /docs/volunteer-guide
  - title: Mga Telephony Provider
    description: Ihambing ang mga sinusuportahang telephony provider at piliin ang pinakamainam para sa iyong hotline.
    href: /docs/telephony-providers
  - title: "Setup: Twilio"
    description: Hakbang-hakbang na gabay para i-configure ang Twilio bilang iyong telephony provider.
    href: /docs/setup-twilio
  - title: "Setup: SignalWire"
    description: Hakbang-hakbang na gabay para i-configure ang SignalWire bilang iyong telephony provider.
    href: /docs/setup-signalwire
  - title: "Setup: Vonage"
    description: Hakbang-hakbang na gabay para i-configure ang Vonage bilang iyong telephony provider.
    href: /docs/setup-vonage
  - title: "Setup: Plivo"
    description: Hakbang-hakbang na gabay para i-configure ang Plivo bilang iyong telephony provider.
    href: /docs/setup-plivo
  - title: "Setup: Asterisk (Self-Hosted)"
    description: I-deploy ang Asterisk gamit ang ARI bridge para sa pinakamataas na privacy at kontrol.
    href: /docs/setup-asterisk
  - title: WebRTC Browser Calling
    description: I-enable ang pagsagot ng tawag sa browser para sa mga boluntaryo gamit ang WebRTC.
    href: /docs/webrtc-calling
  - title: Modelo ng Seguridad
    description: Unawain kung ano ang naka-encrypt, kung ano ang hindi, at ang threat model.
    href: /security
---

## Pangkalahatang-tanaw ng arkitektura

Ang Llamenos ay isang self-hosted single-page application (SPA) na dine-deploy sa pamamagitan ng **Docker Compose** o **Kubernetes**. Sinusuportahan nito ang voice calls, SMS, WhatsApp, at Signal — lahat ay nire-route sa on-shift na staff sa pamamagitan ng isang unified interface.

| Bahagi | Teknolohiya |
|---|---|
| Frontend | Vite + React + TanStack Router |
| Backend | Bun + Hono + PostgreSQL |
| Storage | RustFS (S3-compatible) |
| Identity Provider | Authentik (self-hosted OIDC) |
| Telephony | Twilio, SignalWire, Vonage, Plivo, o Asterisk |
| Messaging | SMS, WhatsApp Business, Signal |
| Auth | JWT + multi-factor KEK + WebAuthn passkeys |
| Encryption | ECIES (secp256k1 + XChaCha20-Poly1305), 3 tiers |
| Transcription | Client-side Whisper (WASM) — hindi umaalis ang audio sa browser |
| Real-time | Nostr relay (strfry) |
| i18n | i18next (13 na wika) |

## Mga Tungkulin

| Tungkulin | Makikita | Magagawa |
|---|---|---|
| **Tumatawag** | Wala (GSM phone) | Tumawag sa numero ng hotline |
| **Boluntaryo** | Sariling mga nota lamang | Sagutin ang mga tawag, sumulat ng mga nota sa panahon ng shift |
| **Admin** | Lahat ng nota, audit log, datos ng tawag | Pamahalaan ang mga boluntaryo, shift, ban, mga setting |
