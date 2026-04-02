---
title: Dokumentation
description: Erfahren Sie, wie Sie Llamenos bereitstellen, konfigurieren und verwenden.
guidesHeading: Anleitungen
guides:
  - title: Erste Schritte
    description: Voraussetzungen, Installation, Telefonie-Einrichtung und erstes Deployment.
    href: /docs/getting-started
  - title: Administratorhandbuch
    description: Verwalten Sie Freiwillige, Schichten, Sperrlisten, benutzerdefinierte Felder und Einstellungen.
    href: /docs/admin-guide
  - title: Handbuch fuer Freiwillige
    description: Anmelden, Anrufe entgegennehmen, Notizen schreiben und Transkription nutzen.
    href: /docs/volunteer-guide
  - title: Telefonieanbieter
    description: Vergleichen Sie die unterstuetzten Telefonieanbieter und waehlen Sie den besten fuer Ihre Hotline.
    href: /docs/telephony-providers
  - title: "Einrichtung: Twilio"
    description: Schritt-fuer-Schritt-Anleitung zur Konfiguration von Twilio als Telefonieanbieter.
    href: /docs/setup-twilio
  - title: "Einrichtung: SignalWire"
    description: Schritt-fuer-Schritt-Anleitung zur Konfiguration von SignalWire als Telefonieanbieter.
    href: /docs/setup-signalwire
  - title: "Einrichtung: Vonage"
    description: Schritt-fuer-Schritt-Anleitung zur Konfiguration von Vonage als Telefonieanbieter.
    href: /docs/setup-vonage
  - title: "Einrichtung: Plivo"
    description: Schritt-fuer-Schritt-Anleitung zur Konfiguration von Plivo als Telefonieanbieter.
    href: /docs/setup-plivo
  - title: "Einrichtung: Asterisk (selbst gehostet)"
    description: Stellen Sie Asterisk mit der ARI-Bridge fuer maximale Privatsphaere und Kontrolle bereit.
    href: /docs/setup-asterisk
  - title: WebRTC-Browseranrufe
    description: Aktivieren Sie die Anrufannahme im Browser fuer Freiwillige ueber WebRTC.
    href: /docs/webrtc-calling
  - title: Sicherheitsmodell
    description: Verstehen Sie, was verschluesselt ist, was nicht, und das Bedrohungsmodell.
    href: /security
---

## Architekturuebersicht

Llamenos ist eine selbst gehostete Single-Page-Anwendung (SPA), die ueber **Docker Compose** oder **Kubernetes** bereitgestellt wird. Sie unterstuetzt Sprachanrufe, SMS, WhatsApp und Signal — alles wird ueber eine einheitliche Oberflaeche an diensthabendes Personal weitergeleitet.

| Komponente | Technologie |
|---|---|
| Frontend | Vite + React + TanStack Router |
| Backend | Bun + Hono + PostgreSQL |
| Speicher | RustFS (S3-kompatibel) |
| Identitaetsanbieter | Authentik (selbst gehostetes OIDC) |
| Telefonie | Twilio, SignalWire, Vonage, Plivo oder Asterisk |
| Messaging | SMS, WhatsApp Business, Signal |
| Authentifizierung | JWT + Multi-Faktor-KEK + WebAuthn-Passkeys |
| Verschluesselung | ECIES (secp256k1 + XChaCha20-Poly1305), 3 Stufen |
| Transkription | Client-seitige Whisper (WASM) — Audio verlaesst nie den Browser |
| Echtzeit | Nostr-Relay (strfry) |
| i18n | i18next (13 Sprachen) |

## Rollen

| Rolle | Kann sehen | Kann tun |
|---|---|---|
| **Anrufer** | Nichts (GSM-Telefon) | Die Hotline-Nummer anrufen |
| **Freiwilliger** | Nur eigene Notizen | Anrufe entgegennehmen, Notizen waehrend der Schicht schreiben |
| **Administrator** | Alle Notizen, Auditprotokolle, Anrufdaten | Freiwillige, Schichten, Sperren und Einstellungen verwalten |
