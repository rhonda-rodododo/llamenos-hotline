---
title: Features
subtitle: Everything a crisis response platform needs, in one open-source package. Voice, SMS, WhatsApp, Signal, and encrypted reports — built on Cloudflare Workers with zero servers to manage.
---

## Call Routing

**Parallel ringing** — When a caller dials in, every on-shift, non-busy volunteer rings simultaneously. The first volunteer to pick up gets the call; other ringing stops immediately.

**Shift-based scheduling** — Create recurring shifts with specific days and time ranges. Assign volunteers to shifts. The system automatically routes calls to whoever is on duty.

**Queue with hold music** — If all volunteers are busy, callers enter a queue with configurable hold music. Queue timeout is adjustable (30-300 seconds). When no one answers, calls fall through to voicemail.

**Voicemail fallback** — Callers can leave a voicemail (up to 5 minutes) if no volunteer answers. Voicemails are transcribed via Whisper AI and encrypted for admin review.

## Encrypted Notes

**End-to-end encrypted note-taking** — Volunteers write notes during and after calls. Notes are encrypted client-side using ECIES (secp256k1 + XChaCha20-Poly1305) before leaving the browser. The server stores only ciphertext.

**Dual encryption** — Every note is encrypted twice: once for the volunteer who wrote it, and once for the admin. Both can decrypt independently. No one else can read the content.

**Custom fields** — Admins define custom fields for notes: text, number, select, checkbox, textarea. Fields are encrypted alongside note content.

**Draft auto-save** — Notes are auto-saved as encrypted drafts in the browser. If the page reloads or the volunteer navigates away, their work is preserved. Drafts are cleaned on logout.

## AI Transcription

**Whisper-powered transcription** — Call recordings are transcribed using Cloudflare Workers AI with the Whisper model. Transcription happens server-side, then the transcript is encrypted before storage.

**Toggle controls** — Admin can enable/disable transcription globally. Volunteers can opt out individually. Both toggles are independent.

**Encrypted transcripts** — Transcripts use the same ECIES encryption as notes. The stored transcript is ciphertext only.

## Spam Mitigation

**Voice CAPTCHA** — Optional voice bot detection: callers hear a randomized 4-digit number and must enter it on the keypad. Blocks automated dialing while remaining accessible to real callers.

**Rate limiting** — Sliding-window rate limiting per phone number, persisted in Durable Object storage. Survives Worker restarts. Configurable thresholds.

**Real-time ban lists** — Admins manage phone number ban lists with single-entry or bulk import. Bans take effect immediately. Banned callers hear a rejection message.

**Custom IVR prompts** — Record custom voice prompts for each supported language. The system uses your recordings for IVR flows, falling back to text-to-speech when no recording exists.

## Multi-Channel Messaging

**SMS** — Inbound and outbound SMS messaging via Twilio, SignalWire, Vonage, or Plivo. Auto-response with configurable welcome messages. Messages flow into the threaded conversation view.

**WhatsApp Business** — Connect via the Meta Cloud API (Graph API v21.0). Template message support for initiating conversations within the 24-hour messaging window. Media message support for images, documents, and audio.

**Signal** — Privacy-focused messaging via a self-hosted signal-cli-rest-api bridge. Health monitoring with graceful degradation. Voice message transcription via Workers AI Whisper.

**Threaded conversations** — All messaging channels flow into a unified conversation view. Message bubbles with timestamps and direction indicators. Real-time updates via WebSocket.

## Encrypted Reports

**Reporter role** — A dedicated role for people who submit tips or reports. Reporters see a simplified interface with only reports and help. Invited through the same flow as volunteers, with a role selector.

**Encrypted submissions** — Report body content is encrypted using ECIES before leaving the browser. Plaintext titles for triage, encrypted content for privacy. File attachments are encrypted separately.

**Report workflow** — Categories for organizing reports. Status tracking (open, claimed, resolved). Admins can claim reports and respond with threaded, encrypted replies.

## Admin Dashboard

**Setup wizard** — Guided multi-step setup on first admin login. Choose which channels to enable (Voice, SMS, WhatsApp, Signal, Reports), configure providers, and set your hotline name.

**Getting Started checklist** — Dashboard widget that tracks setup progress: channel configuration, volunteer onboarding, shift creation.

**Real-time monitoring** — See active calls, queued callers, conversations, and volunteer status in real time via WebSocket. Metrics update instantly.

**Volunteer management** — Add volunteers with generated keypairs, manage roles (volunteer, admin, reporter), view online status. Invite links for self-registration with role selection.

**Audit logging** — Every call answered, note created, message sent, report submitted, setting changed, and admin action is logged. Paginated viewer for admins.

**Call history** — Searchable, filterable call history with date ranges, phone number search, and volunteer assignment. GDPR-compliant data export.

**In-app help** — FAQ sections, role-specific guides, quick reference cards for keyboard shortcuts and security. Accessible from the sidebar and command palette.

## Multi-Language & Mobile

**12+ languages** — Full UI translations: English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, Portuguese, and German. RTL support for Arabic.

**Progressive Web App** — Installable on any device via the browser. Service worker caches the app shell for offline launch. Push notifications for incoming calls.

**Mobile-first design** — Responsive layout built for phones and tablets. Collapsible sidebar, touch-friendly controls, and adaptive layouts.

## Authentication

**Nostr keypair auth** — Volunteers authenticate with Nostr-compatible keypairs (nsec/npub). BIP-340 Schnorr signature verification. No passwords, no email addresses.

**WebAuthn passkeys** — Optional passkey support for multi-device login. Register a hardware key or biometric, then sign in without typing your secret key.

**Session management** — 8-hour session tokens with idle timeout warnings. Session renewal, expiry dialogs, and automatic cleanup.
