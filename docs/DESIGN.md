# Design Notes (Original v0.x)

> **Historical document.** These are the original design notes from early development. For the current architecture, see [`docs/architecture/`](architecture/) which covers the E2EE architecture, PBAC authorization model, Contact Directory, and protocol specification.

## Key Evolutions Since v0.x

- **Auth**: Migrated from raw nsec entry to JWT + Authentik IdP with WebAuthn (passkey) support. Nostr keypairs are still used for cryptographic operations (signing, encryption) but authentication flows through Authentik.
- **Storage**: Replaced MinIO with RustFS (S3-compatible, self-hosted via Docker/Ansible). Per-hub buckets with lifecycle policies.
- **Services**: Replaced Cloudflare Durable Objects with seven PostgreSQL-backed services (IdentityService, SettingsService, RecordsService, ShiftManagerService, CallRouterService, ConversationService, AuditService) using Drizzle ORM.
- **Real-time**: Replaced custom WebSocket server with Nostr relay (strfry) for all real-time communication. All event content is hub-key encrypted.
- **Encryption**: Added field-level encryption for all PII (envelope encryption) and org metadata (hub-key symmetric encryption). Per-note forward secrecy with multi-admin envelopes.
- **Contact Directory**: E2EE contact management with PBAC, teams, tags, intake routing, and bulk operations.
- **Deployment**: Primary deployment is VPS via Docker Compose + Ansible. Kubernetes via Helm chart for larger deployments.

---

## Hotline Personas

- **Callers** — someone dialing into the hotline using a regular GSM phone line.
- **Volunteers** — the person on the receiving end of calls during their shift. They receive calls on their phone and use the webapp to log notes about each call. They can only see notes they wrote themselves.
- **Admins** — manage volunteers, shifts, contact info, ban lists, and all notes. Any volunteer can be promoted to admin. This is the most sensitive role.

## Threat Model

- **Potential adversaries**: nation states, right-wing groups, private hacking firms, other malicious actors. Most digital platforms are compelled to cooperate with these adversaries, so E2EE and zero-knowledge architecture is ideal.
- **What they're willing to spend**: a lot.
- **What they want access to**: personally identifying information of volunteers, activists calling in, and lead information on what they've witnessed — for strategic legal or operational advantage.

## Requirements That Shaped the Architecture

- **Low cost** — Twilio for telephony, self-hosted VPS for infrastructure.
- **Automated shift routing** — recurring schedules with ring groups and fallback groups.
- **Volunteer identity protection** — personal info (name, phone) visible only to admins.
- **Call spam mitigation** — real-time ban lists, voice CAPTCHA, rate limiting.
- **Parallel ringing** — all on-shift volunteers ring simultaneously; first pickup wins.
- **E2EE transcription** — Whisper transcription encrypted so the server can never read it.
- **Audit logging** — every call answered, every note created, visible to admins only.
- **GDPR compliance** — EU parent org, data handling must comply.
