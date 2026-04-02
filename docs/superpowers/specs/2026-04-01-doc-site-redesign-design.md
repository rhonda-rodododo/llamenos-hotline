# Design: Doc Site Redesign (Spec C)

**Version:** 1.0
**Date:** 2026-04-01
**Status:** Draft
**Depends on:** `2026-04-01-documentation-infrastructure-overhaul-design.md` (Spec A+B — core docs must be accurate before site content references them)

## Problem

The doc site has three issues:

1. **Outdated content**: Every page describes the old system (Nostr-only auth, MinIO, CF Workers AI transcription, plaintext messaging). None of the major changes from the last month are reflected.

2. **Flat structure mixes audiences**: Deployment guides (Docker, K8s) sit next to user guides (admin, volunteer) in the same sidebar. Non-technical users looking for "how do I use this" land on "how to deploy to Kubernetes."

3. **Role-locked guides**: admin-guide, volunteer-guide, reporter-guide hardcode role names, but roles are configurable via PBAC. Organizations rename and create custom roles.

## Principles

1. **Preserve the voice**: The security page's plain-language, "what can they see" style is praised by users. All user-facing content uses accessible language — no jargon.
2. **Audience, not role**: Use generic audience terms (Operator, Staff, Caller) that describe capability level, not configurable role names.
3. **Tag-based discovery**: Articles organized by feature, browsable by audience + task tags, with semantic search.
4. **Clean separation**: User-facing content (About, Guides) is clearly separated from technical content (Deploy, Reference).

## Scope

### In Scope
- Site information architecture redesign (4-section layout)
- New `guides` content collection with tag schema
- Pagefind search integration
- Security page complete rewrite
- Features page complete rewrite
- 15 new feature guide articles
- Deployment guide updates (Authentik, RustFS, webhook URLs)
- Getting started page overhaul
- Telephony setup guide webhook URL fixes
- Old role-based guides → redirect stubs
- Sidebar redesign
- Translation stubs for all 12 non-English locales
- i18n translation key updates

### Out of Scope
- Full professional translation (follow-up)
- Visual redesign of the site theme/branding (use existing design system)
- New marketing pages beyond features/security
- API reference (auto-generated at `/api/docs`)

---

## Section 1: Information Architecture

### Four top-level sections

```
/                           — Home (marketing landing)
/features                   — Features overview (marketing)
/security                   — Security & Privacy (marketing, plain-language)

/docs/guides/               — Guides hub (tag-filtered cards + search)
/docs/guides/[slug]         — Individual guide article

/docs/deploy/               — Deploy overview (was "Getting Started")
/docs/deploy/self-hosting   — Self-hosting overview
/docs/deploy/docker         — Docker Compose deployment
/docs/deploy/kubernetes     — Kubernetes/Helm deployment
/docs/deploy/coopcloud      — Co-op Cloud deployment
/docs/deploy/providers/     — Telephony & messaging provider setup
/docs/deploy/providers/twilio
/docs/deploy/providers/signalwire
/docs/deploy/providers/vonage
/docs/deploy/providers/plivo
/docs/deploy/providers/asterisk
/docs/deploy/providers/sms
/docs/deploy/providers/whatsapp
/docs/deploy/providers/signal
/docs/deploy/providers/webrtc

/docs/reference/            — Reference hub (links to technical docs)
```

### URL migration

| Old URL | New URL | Method |
|---------|---------|--------|
| `/docs/getting-started` | `/docs/deploy/` | Redirect |
| `/docs/self-hosting` | `/docs/deploy/self-hosting` | Redirect |
| `/docs/deploy-docker` | `/docs/deploy/docker` | Redirect |
| `/docs/deploy-kubernetes` | `/docs/deploy/kubernetes` | Redirect |
| `/docs/deploy-coopcloud` | `/docs/deploy/coopcloud` | Redirect |
| `/docs/setup-twilio` | `/docs/deploy/providers/twilio` | Redirect |
| `/docs/setup-signalwire` | `/docs/deploy/providers/signalwire` | Redirect |
| `/docs/setup-vonage` | `/docs/deploy/providers/vonage` | Redirect |
| `/docs/setup-plivo` | `/docs/deploy/providers/plivo` | Redirect |
| `/docs/setup-asterisk` | `/docs/deploy/providers/asterisk` | Redirect |
| `/docs/setup-sms` | `/docs/deploy/providers/sms` | Redirect |
| `/docs/setup-whatsapp` | `/docs/deploy/providers/whatsapp` | Redirect |
| `/docs/setup-signal` | `/docs/deploy/providers/signal` | Redirect |
| `/docs/webrtc-calling` | `/docs/deploy/providers/webrtc` | Redirect |
| `/docs/telephony-providers` | `/docs/deploy/providers/` | Redirect |
| `/docs/admin-guide` | `/docs/guides/?audience=operator` | Redirect |
| `/docs/volunteer-guide` | `/docs/guides/?audience=staff` | Redirect |
| `/docs/reporter-guide` | `/docs/guides/?audience=staff` | Redirect |

Redirects implemented as Astro pages that return 301 with `Astro.redirect()`.

---

## Section 2: Guides Collection

### Content collection schema

Add to `site/src/content.config.ts`:

```typescript
const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    audience: z.array(z.enum(['operator', 'staff', 'caller'])),
    task: z.array(z.enum(['setup', 'daily-use', 'configuration', 'troubleshooting', 'security'])),
    feature: z.string().optional(),
    order: z.number().optional(),
  }),
});
```

### Guide articles (15)

| Article | File | Audience | Task | Feature |
|---------|------|----------|------|---------|
| Getting Started | `getting-started.md` | operator, staff | setup | onboarding |
| Call Handling | `call-handling.md` | staff | daily-use | calls |
| Voicemail | `voicemail.md` | operator, staff | configuration, daily-use | voicemail |
| Contact Directory | `contact-directory.md` | operator, staff | daily-use, configuration | contacts |
| Shifts & Scheduling | `shifts-scheduling.md` | operator | configuration, daily-use | shifts |
| Teams & Permissions | `teams-permissions.md` | operator | configuration, security | permissions |
| Encryption & Keys | `encryption-keys.md` | operator, staff | security, setup | encryption |
| Messaging Channels | `messaging-channels.md` | operator | setup, configuration | messaging |
| Reports & Submissions | `reports-submissions.md` | staff | daily-use | reports |
| Ban Lists & Spam | `ban-lists-spam.md` | operator | configuration, troubleshooting | bans |
| Transcription | `transcription.md` | operator, staff | configuration, daily-use | transcription |
| Browser Calling | `browser-calling.md` | operator, staff | setup, daily-use | webrtc |
| Notifications & Presence | `notifications-presence.md` | staff | daily-use, configuration | notifications |
| Data Export | `data-export.md` | operator, staff | daily-use, security | export |
| Account Recovery | `account-recovery.md` | operator, staff | troubleshooting, security | recovery |

### Guides hub page (`/docs/guides/`)

- Tag filter bar: audience pills (Operator, Staff) + task pills (Setup, Daily Use, Configuration, Troubleshooting, Security)
- Card grid showing all guides (title + description + tag badges)
- Client-side JS filtering (no page reload)
- URL query params for deep-linking: `?audience=operator&task=setup`
- Mobile: horizontal scroll for tag bar

### Guide article pages (`/docs/guides/[slug]`)

- DocsLayout with guide content
- Tag badges at top
- "Related guides" at bottom (same feature or overlapping tags)

---

## Section 3: Search

### Pagefind integration

- Install `astro-pagefind` as Astro integration
- Indexes all static pages at build time
- Ships small WASM runtime (~100KB) for client-side search
- Search input in sidebar header (all doc pages)
- Dropdown results with title, description, matched excerpt
- Works offline (PWA-compatible)
- No external service dependencies

---

## Section 4: Sidebar Redesign

### New sidebar structure

```
[Search input]

About
  Features
  Security & Privacy

Guides
  Browse All Guides →
  (or top 5 contextual links)

Deploy
  Overview
  Self-Hosting
  Docker
  Kubernetes
  Co-op Cloud

Providers
  Voice Providers
  Twilio | SignalWire | Vonage | Plivo | Asterisk
  Browser Calling (WebRTC)
  SMS | WhatsApp | Signal

Reference
  API Documentation →
  Protocol Specification →
  Architecture →
  Security Docs →
```

The Reference section links to external URLs (GitHub docs/ directory, `/api/docs`).

### DocsLayout changes

- Update sidebar sections in `DocsLayout.astro`
- Remove old "User Guides" section
- Add search component at top
- Highlight current section based on URL path

---

## Section 5: Security Page Rewrite

File: `site/src/content/pages/en/security.md`

Preserve the existing voice and structure (subpoena table → by feature → planned → summary). Key content changes:

### Subpoena table
- Add to "CANNOT provide": volunteer names, contact records, message content (all now E2EE)
- Update: "Decryption keys (protected by your PIN, your identity provider account, and optionally your hardware security key)"

### Voice calls
- Transcription: "Audio is processed entirely in your browser using on-device AI. Audio never leaves your device."

### Text messaging
- Server storage: "Encrypted" (not "Plaintext")
- "Messages are encrypted the moment they arrive at your server. The server stores only ciphertext."
- Remove "Future improvement" for E2EE messaging — it shipped

### Notes & reports
- Add: "Custom fields, report content, and file attachments are all individually encrypted"
- Device seizure: multi-factor (PIN + IdP + optional hardware key)

### Volunteer identities
- Names: E2EE (was "encrypted at rest")
- Subpoena: "Ciphertext only" (was "Yes, with effort")

### What's shipped / What's planned
Replace "What's planned" with "Recently shipped" + remaining planned items:
- SHIPPED: E2EE messaging, client-side transcription, reproducible builds, multi-factor key protection, hardware security keys, contact directory
- PLANNED: Native call-receiving apps

### Summary table
Update all rows to reflect current encryption status. Add: contact records (E2EE), team/role metadata (encrypted), custom fields (encrypted).

---

## Section 6: Features Page Rewrite

File: `site/src/content/pages/en/features.md`

### Subtitle
"Everything a crisis response platform needs, in one open-source package. Voice, SMS, WhatsApp, Signal, and encrypted reports — self-hosted for maximum control."

### Content changes
- Transcription: "on-device AI (Whisper)" — audio never leaves browser
- Spam: "database-backed storage" (not Durable Objects)
- Auth section: complete rewrite for multi-factor KEK, IdP, invite-based onboarding, Web Worker isolation, remote revocation
- NEW: Contact Directory section (encrypted contacts, teams, tags, bulk ops, auto-linking)
- NEW: Configurable Permissions section (PBAC, custom roles, team scoping)
- Messaging: stored encrypted (not plaintext), "real-time updates" (not WebSocket)

---

## Section 7: Deploy Guide Updates

### All deployment guides
- Add Authentik to services tables
- Add IdP secret generation
- Fix MinIO → RustFS where needed
- Add Authentik configuration subsections

### Getting started (`deploy/index`)
- Rewrite from old `getting-started.md`
- IdP account creation replaces keypair generation
- Invite-based onboarding
- Fix webhook URLs (`/api/` prefix)

### Telephony setup guides (5 providers)
- Fix webhook URLs: add `/api/` prefix to all callback URLs
- `/telephony/incoming` → `/api/telephony/incoming`
- `/telephony/status` → `/api/telephony/status`

### deploy-kubernetes.md
- Replace MinIO with RustFS
- Add IdP Helm values
- Remove `bootstrap-admin`

### deploy-coopcloud.md
- Replace MinIO with RustFS in services table
- Add Authentik service

---

## Section 8: Translation Updates

### Existing locale files
- Move content files to match new URL structure
- Update technical terms (MinIO → RustFS, auth terminology)
- Mark with `<!-- Updated 2026-04-01 — full translation review needed -->`

### Guide stubs
- Create stub files for all 12 locales
- Translated title + description
- English body with notice: "This guide is available in English. Translation coming soon."

### i18n keys
Update `common.ts` translations:
- Section labels: "About", "Guides", "Deploy", "Providers", "Reference"
- Audience: "Operator", "Staff", "Caller"
- Task: "Setup", "Daily Use", "Configuration", "Troubleshooting", "Security"
- Search: "Search documentation..."

---

## Implementation Strategy

1. **Site architecture** — New content collection, URL structure, redirect pages, sidebar, search
2. **Content — marketing pages** — Security page rewrite, features page rewrite
3. **Content — guides** — 15 new guide articles (can parallelize)
4. **Content — deploy guides** — Update existing deployment docs, fix webhook URLs
5. **Content — reference page** — Simple hub with links
6. **Translations** — Stub files, i18n keys

Steps 2-5 can parallelize once step 1 is complete.
Step 6 is mechanical once English content is final.

## Non-Goals

- Visual redesign / new theme (use existing design system)
- Full professional translation
- API reference docs (link to auto-generated `/api/docs`)
- Desktop app docs
- New marketing pages beyond features/security
