---
title: Features
subtitle: Everything a crisis response platform needs, in one open-source package. Voice, SMS, WhatsApp, Signal, and encrypted reports — self-hosted for maximum control.
---

## Multi-Provider Telephony

**5 voice providers** — Choose from Twilio, SignalWire, Vonage, Plivo, or self-hosted Asterisk. Configure your provider in the admin settings UI or during the setup wizard. Switch providers at any time without code changes.

**WebRTC browser calling** — Volunteers can answer calls directly in the browser without a phone. Provider-specific WebRTC token generation for Twilio, SignalWire, Vonage, and Plivo. Configurable per-volunteer call preference (phone, browser, or both).

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

**On-device transcription** — Calls are transcribed using AI running entirely in the volunteer's browser. Audio never leaves the device. Only the encrypted transcript is stored.

**Admin and volunteer controls** — Admins can enable or disable transcription globally. Volunteers can opt out individually. Both toggles are independent.

**Encrypted transcripts** — Transcripts use the same ECIES encryption as notes. The stored transcript is ciphertext only.

## Spam Mitigation

**Voice CAPTCHA** — Optional voice bot detection: callers hear a randomized 4-digit number and must enter it on the keypad. Blocks automated dialing while remaining accessible to real callers.

**Rate limiting** — Sliding-window rate limiting per phone number, persisted in the database. Configurable thresholds that survive restarts.

**Real-time ban lists** — Admins manage phone number ban lists with single-entry or bulk import. Bans take effect immediately. Banned callers hear a rejection message.

**Custom IVR prompts** — Record custom voice prompts for each supported language. The system uses your recordings for IVR flows, falling back to text-to-speech when no recording exists.

## Multi-Channel Messaging

**SMS** — Inbound and outbound SMS messaging via Twilio, SignalWire, Vonage, or Plivo. Auto-response with configurable welcome messages. Messages flow into the threaded conversation view.

**WhatsApp Business** — Connect via the Meta Cloud API (Graph API v21.0). Template message support for initiating conversations within the 24-hour messaging window. Media message support for images, documents, and audio.

**Signal** — Privacy-focused messaging via a self-hosted signal-cli-rest-api bridge. Health monitoring with graceful degradation. Voice message transcription via on-device Whisper AI.

**Threaded conversations** — All messaging channels flow into a unified conversation view. Message bubbles with timestamps and direction indicators. Real-time updates. All messages are encrypted on your server the moment they arrive. The server stores only ciphertext.

## Encrypted Reports

**Reporter role** — A dedicated role for people who submit tips or reports. Reporters see a simplified interface with only reports and help. Invited through the same flow as volunteers, with a role selector.

**Encrypted submissions** — Report body content is encrypted using ECIES before leaving the browser. Plaintext titles for triage, encrypted content for privacy. File attachments are encrypted separately.

**Report workflow** — Categories for organizing reports. Status tracking (open, claimed, resolved). Admins can claim reports and respond with threaded, encrypted replies.

## Contact Directory

**Encrypted contact records** — Store contact information with end-to-end encryption. Names, phone numbers, emails, and notes are encrypted before leaving the browser.

**Relationship tracking** — Link contacts to each other and to calls, conversations, and reports. Build a picture of who you're helping.

**Auto-linking** — Incoming calls and messages are automatically associated with known contacts by matching phone numbers.

**Team-based access** — Control which team members can see which contacts. Permissions are granular and configurable.

**Tags and intake** — Organize contacts with tags. Intake workflows route new contacts for review.

**Bulk import/export** — Import contacts from CSV or JSON. Export encrypted backups. All processing happens in your browser.

## Configurable Permissions

**Custom roles** — Define your own roles with exactly the permissions you need. Start from built-in templates (Admin, Volunteer, Reporter) or build from scratch.

**Granular permissions** — Over 90 individual permissions across 17 feature areas. Control who can view, create, edit, and delete at a fine-grained level.

**Team scoping** — Assign team members to teams. Permissions can be scoped to specific teams, so different groups see different data.

## Admin Dashboard

**Setup wizard** — Guided multi-step setup on first admin login. Choose which channels to enable (Voice, SMS, WhatsApp, Signal, Reports), configure providers, and set your hotline name.

**Getting Started checklist** — Dashboard widget that tracks setup progress: channel configuration, volunteer onboarding, shift creation.

**Real-time monitoring** — See active calls, queued callers, conversations, and volunteer status in real time. Metrics update instantly.

**User management** — Invite new team members via secure links. They create their own accounts and encryption keys. Manage roles, permissions, and team assignments.

**Audit logging** — Every call answered, note created, message sent, report submitted, setting changed, and admin action is logged. Paginated viewer for admins.

**Call history** — Searchable, filterable call history with date ranges, phone number search, and volunteer assignment. GDPR-compliant data export.

**In-app help** — FAQ sections, role-specific guides, quick reference cards for keyboard shortcuts and security. Accessible from the sidebar and command palette.

## Volunteer Experience

**Command palette** — Press Ctrl+K (or Cmd+K on Mac) for instant access to navigation, search, quick note creation, and theme switching. Admin-only commands are filtered by role.

**Real-time notifications** — Incoming calls trigger a browser ringtone, push notification, and flashing tab title. Toggle each notification type independently in settings.

**Volunteer presence** — Admins see real-time online, offline, and on-break counts. Volunteers can toggle a break switch in the sidebar to pause incoming calls without leaving their shift.

**Keyboard shortcuts** — Press ? to see all available shortcuts. Navigate pages, open the command palette, and perform common actions without touching the mouse.

**Note draft auto-save** — Notes are auto-saved as encrypted drafts in the browser. If the page reloads or the volunteer navigates away, their work is preserved. Drafts are cleaned from localStorage on logout.

**Encrypted data export** — Export notes as a GDPR-compliant encrypted file (.enc) protected by your multi-factor encryption key. Only the original author can decrypt the export.

**Dark/light themes** — Toggle between dark mode, light mode, or follow the system theme. Preference persisted per session.

## Multi-Language & Mobile

**12+ languages** — Full UI translations: English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, Portuguese, and German. RTL support for Arabic.

**Progressive Web App** — Installable on any device via the browser. Service worker caches the app shell for offline launch. Push notifications for incoming calls.

**Mobile-first design** — Responsive layout built for phones and tablets. Collapsible sidebar, touch-friendly controls, and adaptive layouts.

## Authentication & Key Management

**Multi-factor key protection** — Your encryption key is protected by up to three independent factors: a PIN you choose, your identity provider account, and optionally a hardware security key. Compromising any single factor is not enough.

**Identity provider integration** — Self-hosted identity management (you control it). Invite-based onboarding — no sharing secret keys. Remote session revocation — lock out a compromised device from anywhere.

**Automatic session management** — Sessions refresh silently in the background. Idle auto-lock protects unattended devices. Your encryption key lives in an isolated process, never accessible to the page.

**Device linking** — Set up new devices securely. Scan a QR code or enter a short provisioning code. Uses ephemeral key exchange — your secret key is never exposed during transfer.

**Recovery keys** — During onboarding, you receive a recovery key for emergencies. Mandatory encrypted backup before you can proceed.

**Hardware security keys** — Optional passkey support for phishing-resistant login. Register a hardware key or biometric, then sign in without typing credentials.

**Per-note forward secrecy** — Each note is encrypted with a unique random key, then that key is wrapped via ECIES for each authorized reader. Compromising the identity key does not reveal past notes.
