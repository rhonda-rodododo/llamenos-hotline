# Plan: IdP Auth — Docs Site User & Marketing Pages

**Status**: Not started
**Branch**: feat/idp-auth-hardening
**Context**: User-facing guides (admin, volunteer, reporter, getting-started) describe Nostr nsec login. Marketing pages (features, security) highlight nsec-only auth. All need updating for JWT + IdP + MFA.

## Scope

User guides under `site/src/content/docs/en/`:
- `getting-started.md` — First-time setup wizard flow
- `admin-guide.md` — Admin operations (volunteer mgmt, settings)
- `volunteer-guide.md` — Volunteer daily usage
- `reporter-guide.md` — Reporter role usage

Marketing pages under `site/src/content/pages/en/`:
- `features.md` — Feature list and descriptions
- `security.md` — Security model and threat analysis

## Auth Flow Changes (for reference)

### Old Flow (nsec-only)
1. Admin generates keypair via `bootstrap-admin` CLI
2. Admin logs in with nsec string
3. Admin creates volunteer → gets nsec → shares securely
4. Volunteer logs in with nsec, sets PIN
5. Optional: register WebAuthn passkey

### New Flow (IdP + multi-factor)
1. Admin runs setup wizard → creates account via IdP (Authentik)
2. Admin logs in via IdP (email/password or SSO) → enters PIN → worker unlocks
3. Admin creates volunteer → generates invite link with code
4. Volunteer opens invite → creates IdP account → sets PIN → nsec encrypted with multi-factor KEK
5. MFA: PIN (always) + IdP session (always) + WebAuthn PRF (optional hardware binding)
6. Day-to-day: IdP session auto-refreshes → PIN unlocks local key → worker decrypts

### Key Messaging Changes
- "Nostr keypair" → "cryptographic identity" (nsec still exists under the hood but users don't see it)
- "Share nsec securely" → "Send invite link" (invite-based onboarding)
- "Optional WebAuthn" → "Multi-factor authentication" (PIN + IdP are always required)
- "8-hour session tokens" → "JWT sessions with automatic refresh"
- "Recovery key" → "Recovery options" (IdP password reset + backup file + recovery key)

## Per-File Tasks

### 1. getting-started.md
- [ ] Update "Create your admin account" to describe setup wizard with IdP registration
- [ ] Remove/update "cryptographic keypair in your browser" language
- [ ] Add note about Authentik first-boot and admin enrollment
- [ ] Update "Add your first volunteer" to describe invite-based flow
- [ ] Keep webhook documentation as-is (unchanged)

### 2. admin-guide.md
- [ ] Rewrite "Logging in" section:
  - IdP login (email/password or SSO)
  - PIN entry to unlock local cryptographic key
  - Session management (auto-refresh, timeout)
- [ ] Rewrite "Volunteer creation" section:
  - Create volunteer profile → system generates invite
  - Share invite link (not nsec)
  - Volunteer self-onboards via invite
- [ ] Update "WebAuthn policy" section:
  - MFA enforcement settings (require for admins, volunteers, or all)
  - Device management (list registered devices, revoke)
- [ ] Add "Session management" section:
  - View active sessions
  - Revoke sessions remotely (via IdP)
  - Auto-lock on idle (5 min)
- [ ] Add "Account recovery" section:
  - IdP password reset
  - Backup key file restore
  - Admin-initiated re-enrollment

### 3. volunteer-guide.md
- [ ] Rewrite "Getting your credentials":
  - Receive invite link from admin
  - Click link → create account (email/password via IdP)
  - Set PIN for local key encryption
  - Complete profile setup
- [ ] Rewrite "Logging in":
  - Open app → IdP session auto-refreshes (if cookie valid)
  - Enter PIN to unlock local key
  - If session expired: re-authenticate via IdP
- [ ] Update "Passkey registration":
  - Frame as "Add a security key" for faster, stronger login
  - Hardware-bound factor (WebAuthn PRF)
- [ ] Add "If you lose access":
  - IdP password reset (email)
  - Backup key file restore
  - Contact admin for re-enrollment

### 4. reporter-guide.md
- [ ] Same credential flow updates as volunteer-guide
- [ ] Update login section
- [ ] Update device recovery guidance

### 5. features.md (marketing)
- [ ] Rewrite "Authentication & Key Management" section (lines 108-125):
  - **Identity provider integration** — Self-hosted Authentik IdP with OIDC. Email/password, SSO, or social login. No third-party auth dependencies.
  - **Multi-factor key protection** — Local cryptographic key encrypted with PIN + IdP-bound value + optional WebAuthn PRF. Three independent factors.
  - **Crypto Web Worker isolation** — Private keys never touch the main thread. All signing and decryption runs in an isolated Web Worker.
  - **Invite-based onboarding** — Admins send invite links. Volunteers self-enroll. No manual key sharing.
  - **JWT session management** — Automatic token refresh. Configurable idle timeout. Remote session revocation via IdP.
  - **WebAuthn passkeys** — FIDO2 hardware-bound authentication. Phishing-resistant. Works on phones, laptops, and security keys.
- [ ] Update "Recovery & backup" subsection for new key-store-v2 format
- [ ] Update session model description (JWT instead of 8-hour tokens)

### 6. security.md (marketing)
- [ ] Update authentication threat model:
  - Multi-factor KEK derivation (PIN + IdP + PRF)
  - JWT token lifecycle and revocation
  - IdP as remote kill-switch for compromised devices
- [ ] Update "Volunteer identities" protection description:
  - E2EE envelope encryption (not just "encrypted at rest")
  - Server returns `[encrypted]` — client decrypts via worker
- [ ] Add "Session security" section:
  - JWT signed with HS256, 15-min access token, httpOnly refresh cookie
  - Auto-lock after idle (configurable)
  - IdP session revocation propagates to all devices
- [ ] Update "Key management" section:
  - Multi-factor KEK: `PBKDF2(PIN, 600K iterations) ⊕ HKDF(IdP value) ⊕ WebAuthn PRF`
  - Forward secrecy: unique random key per note, ECIES-wrapped per reader
  - Key rotation on IdP value change (transparent to user)
- [ ] Remove/update "Future improvement: E2EE message storage" — it's shipped now
- [ ] Update security table (lines 92-104) with new auth model

## Translation Impact

All changes affect 13 locale files. Strategy:
- Update English first (source of truth)
- Mark translated files as needing re-translation (add `<!-- NEEDS_TRANSLATION: idp-auth-2026-03-28 -->` comment)
- Translation can be a separate follow-up task

## Acceptance Criteria
- No nsec/Nostr references visible to end users in guides
- Invite-based onboarding flow documented end-to-end
- Security page accurately describes multi-factor auth model
- Features page highlights IdP integration as a selling point
- All user roles (admin, volunteer, reporter) have updated login/onboarding docs
