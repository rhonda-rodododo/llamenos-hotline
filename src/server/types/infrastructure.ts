import type { Services } from '../services'
import type { StorageManager } from './storage'
import type { User } from './users'

/**
 * Transcription service (self-hosted Whisper).
 */
export interface TranscriptionService {
  run(model: string, input: { audio: number[] }): Promise<{ text: string }>
}

export interface CaptchaEntry {
  callSid: string
  expectedDigits: string
}

/**
 * Environment bindings available on the Hono context (c.env).
 * Injected at startup by server.ts via middleware.
 */
export interface Env {
  // Transcription (CF: Ai binding, Node: Whisper HTTP client)
  AI: TranscriptionService

  // Static assets (CF: Fetcher, Node: null — served by Hono serveStatic)
  ASSETS: { fetch(request: Request): Promise<Response> } | null

  // Hub-aware object storage (RustFS / MinIO S3-compatible)
  STORAGE: StorageManager

  // Plain env vars / secrets (same on both platforms)
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
  ADMIN_PUBKEY?: string
  ADMIN_DECRYPTION_PUBKEY?: string // Separate pubkey for note/hub key encryption (falls back to ADMIN_PUBKEY)
  HOTLINE_NAME: string
  ENVIRONMENT: string
  HMAC_SECRET: string
  JWT_SECRET: string
  AUTH_WEBAUTHN_RP_ID: string
  AUTH_WEBAUTHN_RP_NAME: string
  AUTH_WEBAUTHN_ORIGIN: string
  E2E_TEST_SECRET?: string
  DEV_RESET_SECRET?: string

  // Demo mode
  DEMO_MODE?: string // "true" to enable
  DEMO_RESET_CRON?: string // Human-readable schedule label (e.g., "every 4 hours")

  // Server Nostr identity (Epic 76.1) — hex secret for HKDF keypair derivation
  SERVER_NOSTR_SECRET?: string
  // Phase 2.4: Comma-separated list of additional allowed CORS origins
  CORS_ALLOWED_ORIGINS?: string
  // Application URL (used for invite links, webhooks)
  APP_URL?: string
  // Relay URL for Node.js persistent WebSocket (Docker/self-hosted)
  NOSTR_RELAY_URL?: string
  // Public-facing relay URL for client browser connections (e.g., wss://relay.example.com)
  // Falls back to /nostr (reverse-proxied via Caddy) if not set but relay is configured
  NOSTR_RELAY_PUBLIC_URL?: string

  // Push notifications (Epic 86) — APNs (iOS)
  APNS_KEY_P8?: string // Apple Push Notification auth key (PEM format)
  APNS_KEY_ID?: string // Key ID from Apple Developer Portal
  APNS_TEAM_ID?: string // Apple Developer Team ID

  // Push notifications (Epic 86) — FCM (Android)
  FCM_SERVICE_ACCOUNT_KEY?: string // Google Cloud service account JSON

  // Push notifications (Epic 86) — Web Push / VAPID
  VAPID_PUBLIC_KEY?: string // base64url-encoded uncompressed EC public key
  VAPID_PRIVATE_KEY?: string // base64url-encoded EC private key

  // DATABASE_URL for Drizzle connection (Node.js only)
  DATABASE_URL?: string
}

// --- Push Notification Types (Epic 86) ---

export interface DeviceRecord {
  platform: 'ios' | 'android'
  pushToken: string
  wakeKeyPublic: string // secp256k1 compressed pubkey (hex) for wake-tier ECIES
  registeredAt: string
  lastSeenAt: string
}

export type PushNotificationType = 'message' | 'voicemail' | 'shift_reminder' | 'assignment'

/** Wake-tier payload — decryptable without PIN (minimal metadata) */
export interface WakePayload {
  type: PushNotificationType
  conversationId?: string
  channelType?: string
  callId?: string
  shiftId?: string
  startsAt?: string
}

/** Full-tier payload — decryptable only with user's nsec */
export interface FullPushPayload extends WakePayload {
  senderLast4?: string
  previewText?: string
  duration?: number
  callerLast4?: string
  shiftName?: string
  role?: string
}

// Hono typed context
export type AppEnv = {
  Bindings: Env
  Variables: {
    pubkey: string
    user: User
    /** Effective permissions resolved from all roles */
    permissions: string[]
    /** All role definitions (loaded once per request) */
    allRoles: import('../../shared/permissions').Role[]
    /** Current hub ID (set by hub middleware for hub-scoped routes) */
    hubId?: string
    /** Hub-scoped permissions (resolved for the current hub) */
    hubPermissions?: string[]
    /** Injected service instances */
    services: Services
  }
}
