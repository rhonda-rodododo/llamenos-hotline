# Plan B: FreeSWITCH Telephony Adapter (mod_httapi XML)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add FreeSWITCH as the 9th telephony provider, implementing the full `TelephonyAdapter` interface with mod_httapi XML response generation.

**Dependency:** Plan A (sip-bridge refactor) MUST be completed first. This adapter extends `SipBridgeAdapter` from `src/server/telephony/sip-bridge-adapter.ts`, which provides `ringUsers`, `cancelRinging`, `hangupCall`, recording management, HMAC webhook validation, and `testConnection` via the shared bridge client.

**Architecture:** FreeSWITCH uses mod_httapi for call flow control. When a call arrives, FreeSWITCH POSTs form data to our webhook URL. We respond with XML documents (`<document type="xml/freeswitch-httapi">`) containing `<work>` sections that direct FreeSWITCH's behavior. The sip-bridge ESL client translates FreeSWITCH ESL events into the same JSON webhook format used by the Asterisk bridge (`AsteriskBridgeWebhook`), so all webhook parsing is inherited from `SipBridgeAdapter`.

**Key mod_httapi patterns:**
- Document root: `<document type="xml/freeswitch-httapi">`
- Params section: `<params>` with `<name>` entries for callback config
- Work section: `<work>` contains the actual IVR commands
- Digit capture: `<bind>` elements inside `<playback>` with regex match (no `<getDigits>` tag)
- TTS: `<execute application="speak" data="flite|slt|{text}"/>` (mod_flite)
- Audio playback: `<playback file="{url}" .../>` or `<execute application="playback" data="{url}"/>`
- Recording: `<record file="{path}" limit="{seconds}" action="{callback-url}"/>`
- Hangup: `<execute application="hangup"/>`
- Bridge: `<execute application="bridge" data="..."/>`

**Tech Stack:** Bun, Hono, Zod, mod_httapi XML generation, sip-bridge ESL client (JSON webhooks)

---

### Task 1: Webhook Schemas (mod_httapi POST body + ESL bridge events)

**Files:**
- Create: `src/shared/schemas/external/freeswitch-httapi.ts`
- Modify: `src/shared/schemas/index.ts` (add barrel export)

FreeSWITCH mod_httapi POSTs form-encoded data with call state. The sip-bridge ESL client sends JSON webhooks in the same format as `AsteriskBridgeWebhook`.

- [ ] Create `src/shared/schemas/external/freeswitch-httapi.ts`:

```typescript
/**
 * Zod schemas for FreeSWITCH mod_httapi POST body fields and sip-bridge webhook events.
 *
 * mod_httapi sends form-encoded POST data to the webhook URL on each call event.
 * The sip-bridge ESL client translates FreeSWITCH events into JSON webhooks using
 * the same format as AsteriskBridgeWebhook (shared bridge protocol).
 *
 * Reference: https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Modules/mod_httapi_3966423/
 *            src/server/telephony/freeswitch.ts
 */

import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Section 1: mod_httapi inbound POST body
// FreeSWITCH posts form-encoded data to the webhook URL. These are the
// channel variables included in the POST body.
// ---------------------------------------------------------------------------

/**
 * FreeSWITCH channel state values from mod_httapi POST.
 * CS_EXECUTE = active, CS_HANGUP = call ended, CS_ROUTING = early state.
 */
export const FreeSwitchChannelStateSchema = z.enum([
  'CS_NEW',
  'CS_INIT',
  'CS_ROUTING',
  'CS_SOFT_EXECUTE',
  'CS_EXECUTE',
  'CS_EXCHANGE_MEDIA',
  'CS_PARK',
  'CS_CONSUME_MEDIA',
  'CS_HIBERNATE',
  'CS_RESET',
  'CS_HANGUP',
  'CS_REPORTING',
  'CS_DESTROY',
])
export type FreeSwitchChannelState = z.infer<typeof FreeSwitchChannelStateSchema>

export const FreeSwitchHttapiPostSchema = z.looseObject({
  /** Unique channel UUID — used as callSid throughout the adapter */
  'Channel-Call-UUID': z.string().optional(),
  /** Alternative UUID field */
  'Unique-ID': z.string().optional(),
  /** Caller ID number (E.164 or SIP URI) */
  'Caller-Caller-ID-Number': z.string().optional(),
  /** Alternative caller field */
  'Caller-ANI': z.string().optional(),
  /** Called/destination number */
  'Caller-Destination-Number': z.string().optional(),
  /** Channel state */
  'Channel-State': FreeSwitchChannelStateSchema.optional(),
  /** Channel state number */
  'Channel-State-Number': z.string().optional(),
  /** Call direction: inbound or outbound */
  'Call-Direction': z.enum(['inbound', 'outbound']).optional(),
  /** DTMF digits collected by <bind> */
  variable_digits: z.string().optional(),
  /** Alternative digits field from input callback */
  exiting_data: z.string().optional(),
  /** Session variable: hub ID (set via <params> in initial callback) */
  variable_hub_id: z.string().optional(),
  /** Session variable: caller language selection */
  variable_caller_lang: z.string().optional(),
  /** Session variable: call phase tracking */
  variable_call_phase: z.string().optional(),
  /** Hangup cause (when channel state is CS_HANGUP) */
  'Hangup-Cause': z.string().optional(),
  /** SIP response code */
  variable_sip_term_status: z.string().optional(),
  /** Recording file path after recording completes */
  variable_record_file_path: z.string().optional(),
  /** Recording duration in seconds */
  variable_record_seconds: z.string().optional(),
  /** Queue time (seconds in hold/park — set by bridge) */
  variable_queue_time: z.string().optional(),
})
export type FreeSwitchHttapiPost = z.infer<typeof FreeSwitchHttapiPostSchema>

// ---------------------------------------------------------------------------
// Section 2: Parsed call info (derived from POST body)
// Utility type for adapter's internal use after parsing the POST body.
// ---------------------------------------------------------------------------

export const FreeSwitchCallInfoSchema = z.object({
  channelId: z.string(),
  callerNumber: z.string(),
  calledNumber: z.string().optional(),
  digits: z.string().optional(),
  channelState: FreeSwitchChannelStateSchema.optional(),
  hangupCause: z.string().optional(),
  hubId: z.string().optional(),
  callerLang: z.string().optional(),
  callPhase: z.string().optional(),
  queueTime: z.number().optional(),
  recordingPath: z.string().optional(),
  recordingDuration: z.number().optional(),
})
export type FreeSwitchCallInfo = z.infer<typeof FreeSwitchCallInfoSchema>
```

- [ ] Add barrel export to `src/shared/schemas/index.ts`:

```typescript
// Add this line alongside the other exports:
// (Note: external schemas are NOT exported from the main barrel — they are imported
// directly from their paths. This follows the pattern of asterisk-bridge.ts, twilio-voice.ts, etc.)
```

Actually, looking at the existing pattern, external schemas are imported directly from their file paths (e.g., `import type { AsteriskBridgeWebhook } from '@shared/schemas/external/asterisk-bridge'`). Do NOT add to `src/shared/schemas/index.ts` — external schemas stay out of the barrel. No file modification needed here.

- [ ] `bun run typecheck`

---

### Task 2: Config Schema + Type Registration

**Files:**
- Modify: `src/shared/schemas/providers.ts`
- Modify: `src/shared/types.ts`

- [ ] Add `FreeSwitchConfigSchema` to `src/shared/schemas/providers.ts`:

```typescript
export const FreeSwitchConfigSchema = BaseProviderSchema.extend({
  type: z.literal('freeswitch'),
  /** ESL connection URL for the sip-bridge (e.g., http://freeswitch-bridge:8080) */
  eslUrl: z.string().url('Must be a valid URL'),
  /** ESL authentication password */
  eslPassword: z.string().min(1),
  /** Callback URL for the sip-bridge to POST events back to us */
  bridgeCallbackUrl: z.string().url().optional(),
  /** Shared HMAC secret for webhook signature validation */
  bridgeSecret: z.string().optional(),
  /** FreeSWITCH domain for SIP registration (e.g., fs.example.com) */
  freeswitchDomain: z.string().optional(),
  /** mod_verto WSS port for WebRTC (default: 8082) */
  vertoWssPort: z.number().optional(),
  /** STUN server for WebRTC NAT traversal */
  stunServer: z.string().optional(),
  /** TURN server for WebRTC relay */
  turnServer: z.string().optional(),
  /** TURN shared secret for HMAC credential generation */
  turnSecret: z.string().optional(),
})
export type FreeSwitchConfig = z.infer<typeof FreeSwitchConfigSchema>
```

- [ ] Add `FreeSwitchConfigSchema` to the `TelephonyProviderConfigSchema` discriminated union:

```typescript
export const TelephonyProviderConfigSchema = z.discriminatedUnion('type', [
  TwilioConfigSchema,
  SignalWireConfigSchema,
  VonageConfigSchema,
  PlivoConfigSchema,
  AsteriskConfigSchema,
  TelnyxConfigSchema,
  BandwidthConfigSchema,
  FreeSwitchConfigSchema,  // ← ADD
])
```

- [ ] Add `'freeswitch'` to `TelephonyProviderType` in `src/shared/types.ts`:

```typescript
export type TelephonyProviderType =
  | 'twilio'
  | 'signalwire'
  | 'vonage'
  | 'plivo'
  | 'asterisk'
  | 'telnyx'
  | 'bandwidth'
  | 'freeswitch'  // ← ADD
```

- [ ] Add `'freeswitch'` to `TELEPHONY_PROVIDER_LABELS`:

```typescript
export const TELEPHONY_PROVIDER_LABELS: Record<TelephonyProviderType, string> = {
  twilio: 'Twilio',
  signalwire: 'SignalWire',
  vonage: 'Vonage',
  plivo: 'Plivo',
  asterisk: 'Asterisk (Self-Hosted)',
  telnyx: 'Telnyx',
  bandwidth: 'Bandwidth',
  freeswitch: 'FreeSWITCH (Self-Hosted)',  // ← ADD
}
```

- [ ] Add FreeSWITCH-specific fields to `TelephonyProviderDraft`:

```typescript
export interface TelephonyProviderDraft {
  type: TelephonyProviderType
  phoneNumber?: string
  // ... existing fields ...
  // FreeSWITCH
  eslUrl?: string
  eslPassword?: string
  freeswitchDomain?: string
  vertoWssPort?: number
}
```

- [ ] `bun run typecheck` — expect compile errors in `capabilities.ts` (missing `freeswitch` key) and `adapters.ts` (missing switch case). These are fixed in Tasks 4 and 5.

---

### Task 3: FreeSwitchAdapter — mod_httapi XML Generation

**Files:**
- Create: `src/server/telephony/freeswitch.ts`
- Create: `src/server/telephony/freeswitch.test.ts`

This is the core adapter. It extends `SipBridgeAdapter` (from Plan A) which provides:
- `ringUsers()` — delegates to bridge client
- `cancelRinging()` — delegates to bridge client
- `hangupCall()` — delegates to bridge client
- `getCallRecording()` / `getRecordingAudio()` / `deleteRecording()` — bridge client
- `validateWebhook()` — HMAC signature validation
- `testConnection()` — delegates to capabilities
- `verifyWebhookConfig()` — returns `{ configured: true }` (self-hosted)
- All `parse*Webhook()` methods — JSON parsing from bridge webhooks (same as `AsteriskBridgeWebhook` format)

The `FreeSwitchAdapter` only overrides the IVR/XML response methods.

- [ ] Create `src/server/telephony/freeswitch.ts`:

```typescript
import { DEFAULT_LANGUAGE, IVR_LANGUAGES } from '../../shared/languages'
import { IVR_PROMPTS, getPrompt } from '../../shared/voice-prompts'
import type {
  AudioUrlMap,
  CallAnsweredParams,
  CaptchaResponseParams,
  IncomingCallParams,
  LanguageMenuParams,
  TelephonyResponse,
  VoicemailParams,
} from './adapter'
import { SipBridgeAdapter } from './sip-bridge-adapter'

/**
 * FreeSwitchAdapter — generates mod_httapi XML responses for FreeSWITCH call control.
 *
 * FreeSWITCH mod_httapi posts form-encoded channel variables to our webhook URL.
 * We respond with `<document type="xml/freeswitch-httapi">` XML that directs the
 * call flow. The sip-bridge ESL client handles call management (ring, cancel, hangup)
 * and translates FreeSWITCH ESL events into JSON webhooks (same format as Asterisk bridge).
 *
 * Key mod_httapi patterns:
 * - Digit capture uses <bind> inside <playback> with regex (no <getDigits> tag)
 * - TTS via mod_flite: <execute application="speak" data="flite|slt|{text}"/>
 * - Custom audio: <playback file="{url}" .../>
 * - Recording: <record file="{path}" limit="{seconds}" action="{callback}"/>
 * - Hangup: <execute application="hangup"/>
 */
export class FreeSwitchAdapter extends SipBridgeAdapter {
  // --- XML helpers ---

  /**
   * Wrap work content in the mod_httapi XML document envelope.
   * Optionally includes <params> for callback URL configuration and session variables.
   */
  private doc(work: string, params?: string): TelephonyResponse {
    const paramsSection = params ? `<params>${params}</params>` : ''
    return {
      contentType: 'text/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<document type="xml/freeswitch-httapi">${paramsSection}<work>${work}</work></document>`,
    }
  }

  /** Generate a <params> entry for setting the action (callback) URL with hub query param. */
  private actionParam(path: string, hubId?: string): string {
    const qs = hubId ? `?hub=${encodeURIComponent(hubId)}` : ''
    return `<name>url</name><value>${this.callbackBaseUrl}${path}${qs}</value>`
  }

  /** Generate mod_flite TTS speak command. */
  private speak(text: string, lang: string): string {
    const voice = getFliteVoice(lang)
    // Escape XML special characters in text
    const escaped = escapeXml(text)
    return `<execute application="speak" data="flite|${voice}|${escaped}"/>`
  }

  /** Generate playback command for a URL or TTS fallback. */
  private speakOrPlay(
    promptKey: string,
    lang: string,
    audioUrls?: AudioUrlMap,
    text?: string
  ): string {
    const audioUrl = audioUrls?.[`${promptKey}:${lang}`]
    if (audioUrl) {
      return `<playback file="${escapeXml(audioUrl)}"/>`
    }
    const content = text ?? getPrompt(promptKey, lang)
    return this.speak(content, lang)
  }

  /** Wrap content in a playback+bind for DTMF digit collection. */
  private gatherDigits(
    prompt: string,
    numDigits: number,
    callbackPath: string,
    hubId?: string,
    timeout = 8
  ): string {
    const qs = hubId ? `?hub=${encodeURIComponent(hubId)}` : ''
    const callbackUrl = `${this.callbackBaseUrl}${callbackPath}${qs}`
    const digitRegex = numDigits === 1 ? `~\\d` : `~\\d{${numDigits}}`
    return [
      `<playback file="silence_stream://100" timeout="${timeout * 1000}" action="${escapeXml(callbackUrl)}">`,
      `<bind strip="#">${digitRegex}</bind>`,
      `</playback>`,
      prompt,
    ].join('\n')
  }

  // --- IVR / Call flow (override SipBridgeAdapter abstract methods) ---

  async handleLanguageMenu(params: LanguageMenuParams): Promise<TelephonyResponse> {
    const { enabledLanguages, hubId } = params
    const activeLanguages = IVR_LANGUAGES.filter((code) => enabledLanguages.includes(code))

    if (activeLanguages.length <= 1) {
      const lang = activeLanguages[0] || DEFAULT_LANGUAGE
      // Auto-select single language — set variable and continue
      return this.doc(
        [
          `<execute application="set" data="caller_lang=${lang}"/>`,
          `<execute application="set" data="call_phase=language_selected"/>`,
          this.speak(' ', lang),
        ].join('\n'),
        this.actionParam('/telephony/language-selected', hubId)
      )
    }

    // Build prompts for each enabled language
    const prompts: string[] = []
    for (const langCode of IVR_LANGUAGES) {
      if (!enabledLanguages.includes(langCode)) continue
      const prompt = IVR_PROMPTS[langCode]
      if (!prompt) continue
      prompts.push(this.speak(prompt, langCode))
    }

    // Gather 1 digit for language selection
    const qs = hubId ? `?hub=${encodeURIComponent(hubId)}` : ''
    const callbackUrl = `${this.callbackBaseUrl}/telephony/language-selected${qs}`

    return this.doc(
      [
        `<playback file="silence_stream://100" timeout="8000" action="${escapeXml(callbackUrl)}">`,
        `<bind strip="#">~\\d</bind>`,
        `</playback>`,
        ...prompts,
      ].join('\n')
    )
  }

  async handleIncomingCall(params: IncomingCallParams): Promise<TelephonyResponse> {
    const { rateLimited, voiceCaptchaEnabled, callerLanguage: lang, callSid, audioUrls, hubId } =
      params

    if (rateLimited) {
      return this.doc(
        [this.speakOrPlay('rateLimited', lang, audioUrls), `<execute application="hangup"/>`].join(
          '\n'
        )
      )
    }

    if (voiceCaptchaEnabled && params.captchaDigits) {
      const digits = params.captchaDigits
      const captchaText = getPrompt('captcha', lang).replace(
        '{digits}',
        digits.split('').join(' ')
      )
      const qs = hubId ? `?hub=${encodeURIComponent(hubId)}` : ''
      const callbackUrl = `${this.callbackBaseUrl}/telephony/captcha-response${qs}`

      return this.doc(
        [
          `<execute application="set" data="expected_digits=${digits}"/>`,
          `<playback file="silence_stream://100" timeout="10000" action="${escapeXml(callbackUrl)}">`,
          `<bind strip="#">~\\d{4}</bind>`,
          `</playback>`,
          this.speak(captchaText, lang),
        ].join('\n')
      )
    }

    // Enqueue caller — play connecting message then park for queue
    return this.doc(
      [
        this.speakOrPlay('connecting', lang, audioUrls),
        `<execute application="set" data="call_phase=queued"/>`,
        `<execute application="park"/>`,
      ].join('\n'),
      this.actionParam('/telephony/wait-music', hubId)
    )
  }

  async handleCaptchaResponse(params: CaptchaResponseParams): Promise<TelephonyResponse> {
    const { digits, expectedDigits, callerLanguage: lang, callSid, hubId } = params

    if (digits === expectedDigits) {
      return this.doc(
        [
          this.speak(getPrompt('captchaSuccess', lang), lang),
          `<execute application="set" data="call_phase=queued"/>`,
          `<execute application="park"/>`,
        ].join('\n'),
        this.actionParam('/telephony/wait-music', hubId)
      )
    }

    // Retry with new digits
    if (params.remainingAttempts && params.remainingAttempts > 0 && params.newCaptchaDigits) {
      const qs = hubId ? `?hub=${encodeURIComponent(hubId)}` : ''
      const callbackUrl = `${this.callbackBaseUrl}/telephony/captcha-response${qs}`

      return this.doc(
        [
          `<execute application="set" data="expected_digits=${params.newCaptchaDigits}"/>`,
          this.speak(getPrompt('captchaRetry', lang), lang),
          `<playback file="silence_stream://100" timeout="10000" action="${escapeXml(callbackUrl)}">`,
          `<bind strip="#">~\\d{4}</bind>`,
          `</playback>`,
          this.speak(params.newCaptchaDigits.split('').join(' '), lang),
        ].join('\n')
      )
    }

    // Failed — hangup
    return this.doc(
      [this.speak(getPrompt('captchaFailed', lang), lang), `<execute application="hangup"/>`].join(
        '\n'
      )
    )
  }

  async handleCallAnswered(params: CallAnsweredParams): Promise<TelephonyResponse> {
    const { parentCallSid } = params
    // Bridge the volunteer's channel to the caller's parked channel
    return this.doc(
      [
        `<execute application="set" data="call_phase=bridged"/>`,
        `<execute application="bridge" data="{origination_uuid=${parentCallSid}}park"/>`,
      ].join('\n')
    )
  }

  async handleVoicemail(params: VoicemailParams): Promise<TelephonyResponse> {
    const { callerLanguage: lang, audioUrls, maxRecordingSeconds, hubId, callSid } = params
    const limit = maxRecordingSeconds || 120
    const qs = hubId ? `?hub=${encodeURIComponent(hubId)}` : ''
    const callbackUrl = `${this.callbackBaseUrl}/telephony/voicemail-recording${qs}&callSid=${encodeURIComponent(callSid)}`

    return this.doc(
      [
        this.speakOrPlay('voicemailPrompt', lang, audioUrls),
        `<record file="$${`{recordings_dir}`}/${callSid}.wav" limit="${limit}" finish_on_key="#" action="${escapeXml(callbackUrl)}"/>`,
      ].join('\n')
    )
  }

  async handleWaitMusic(
    lang: string,
    audioUrls?: AudioUrlMap,
    queueTime?: number,
    queueTimeout?: number
  ): Promise<TelephonyResponse> {
    const timeout = queueTimeout || 90
    if (queueTime && queueTime >= timeout) {
      // Leave queue — unpark the channel (bridge will handle voicemail redirect)
      return this.doc(`<execute application="set" data="call_phase=voicemail"/>`)
    }
    return this.doc(this.speakOrPlay('holdMusic', lang, audioUrls))
  }

  rejectCall(): TelephonyResponse {
    return this.doc(
      `<execute application="hangup" data="CALL_REJECTED"/>`
    )
  }

  handleVoicemailComplete(lang: string): TelephonyResponse {
    return this.doc(
      [this.speak(getPrompt('voicemailThankYou', lang), lang), `<execute application="hangup"/>`].join(
        '\n'
      )
    )
  }

  handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse {
    return this.doc(
      [
        this.speakOrPlay('unavailableMessage', lang, audioUrls),
        `<execute application="hangup"/>`,
      ].join('\n')
    )
  }

  emptyResponse(): TelephonyResponse {
    return this.doc('')
  }
}

// --- Helpers ---

/** Map language codes to mod_flite voice names. flite has limited voices. */
function getFliteVoice(_lang: string): string {
  // mod_flite only ships with English voices (slt, kal, awb, rms)
  // For non-English, slt (female) is the least-bad fallback.
  // Production deployments should use custom audio URLs instead of TTS for non-English.
  return 'slt'
}

/** Escape XML special characters for safe embedding in XML attributes/text. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
```

- [ ] Create unit tests at `src/server/telephony/freeswitch.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { FreeSwitchAdapter } from './freeswitch'

// The constructor signature matches SipBridgeAdapter:
// (bridgeCallbackUrl: string, bridgeSecret: string, phoneNumber: string, callbackBaseUrl: string)
function createAdapter(): FreeSwitchAdapter {
  return new FreeSwitchAdapter(
    'http://fs-bridge:8080',
    'test-secret-32chars-minimum-here',
    '+15551234567',
    'https://app.example.com'
  )
}

describe('FreeSwitchAdapter XML generation', () => {
  describe('document structure', () => {
    test('emptyResponse returns valid httapi XML document', () => {
      const adapter = createAdapter()
      const res = adapter.emptyResponse()
      expect(res.contentType).toBe('text/xml')
      expect(res.body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(res.body).toContain('<document type="xml/freeswitch-httapi">')
      expect(res.body).toContain('<work>')
      expect(res.body).toContain('</work>')
      expect(res.body).toContain('</document>')
    })

    test('rejectCall generates hangup with CALL_REJECTED cause', () => {
      const adapter = createAdapter()
      const res = adapter.rejectCall()
      expect(res.body).toContain('application="hangup"')
      expect(res.body).toContain('CALL_REJECTED')
    })
  })

  describe('handleLanguageMenu', () => {
    test('single language auto-selects without gather', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleLanguageMenu({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['en'],
      })
      expect(res.body).toContain('caller_lang=en')
      expect(res.body).toContain('call_phase=language_selected')
      expect(res.body).not.toContain('<bind')
    })

    test('multiple languages generates playback with bind for digit capture', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleLanguageMenu({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['en', 'es', 'fr'],
      })
      expect(res.body).toContain('<playback')
      expect(res.body).toContain('<bind')
      expect(res.body).toContain('~\\d')
      expect(res.body).toContain('language-selected')
      expect(res.body).toContain('application="speak"')
    })

    test('hub ID appended to callback URL as query param', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleLanguageMenu({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        hotlineName: 'Test Hotline',
        enabledLanguages: ['en', 'es'],
        hubId: 'hub-123',
      })
      expect(res.body).toContain('hub=hub-123')
    })
  })

  describe('handleIncomingCall', () => {
    test('rate limited caller gets hangup', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        voiceCaptchaEnabled: false,
        rateLimited: true,
        callerLanguage: 'en',
        hotlineName: 'Test',
      })
      expect(res.body).toContain('application="hangup"')
      expect(res.body).toContain('application="speak"')
    })

    test('CAPTCHA enabled generates gather with 4-digit bind', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        voiceCaptchaEnabled: true,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test',
        captchaDigits: '1234',
      })
      expect(res.body).toContain('~\\d{4}')
      expect(res.body).toContain('expected_digits=1234')
      expect(res.body).toContain('captcha-response')
      expect(res.body).toContain('1 2 3 4')
    })

    test('normal call parks channel for queue', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        voiceCaptchaEnabled: false,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test',
      })
      expect(res.body).toContain('application="park"')
      expect(res.body).toContain('call_phase=queued')
      expect(res.body).toContain('wait-music')
    })

    test('custom audio URL uses playback instead of speak', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        voiceCaptchaEnabled: false,
        rateLimited: false,
        callerLanguage: 'en',
        hotlineName: 'Test',
        audioUrls: { 'connecting:en': 'https://cdn.example.com/connecting-en.mp3' },
      })
      expect(res.body).toContain('<playback file="https://cdn.example.com/connecting-en.mp3"')
      expect(res.body).not.toContain('application="speak"')
    })
  })

  describe('handleCaptchaResponse', () => {
    test('correct digits parks for queue', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCaptchaResponse({
        callSid: 'test-uuid',
        digits: '1234',
        expectedDigits: '1234',
        callerLanguage: 'en',
      })
      expect(res.body).toContain('application="park"')
      expect(res.body).toContain('call_phase=queued')
    })

    test('wrong digits with retries re-gathers', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCaptchaResponse({
        callSid: 'test-uuid',
        digits: '9999',
        expectedDigits: '1234',
        callerLanguage: 'en',
        remainingAttempts: 2,
        newCaptchaDigits: '5678',
      })
      expect(res.body).toContain('expected_digits=5678')
      expect(res.body).toContain('~\\d{4}')
      expect(res.body).toContain('5 6 7 8')
    })

    test('wrong digits with no retries hangs up', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCaptchaResponse({
        callSid: 'test-uuid',
        digits: '9999',
        expectedDigits: '1234',
        callerLanguage: 'en',
        remainingAttempts: 0,
      })
      expect(res.body).toContain('application="hangup"')
    })
  })

  describe('handleCallAnswered', () => {
    test('bridges volunteer to parked caller channel', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleCallAnswered({
        parentCallSid: 'caller-uuid-123',
        callbackUrl: 'https://app.example.com',
        userPubkey: 'vol-pubkey',
      })
      expect(res.body).toContain('application="bridge"')
      expect(res.body).toContain('caller-uuid-123')
      expect(res.body).toContain('call_phase=bridged')
    })
  })

  describe('handleVoicemail', () => {
    test('generates record element with limit and callback', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleVoicemail({
        callSid: 'test-uuid',
        callerLanguage: 'en',
        callbackUrl: 'https://app.example.com',
        maxRecordingSeconds: 60,
        hubId: 'hub-1',
      })
      expect(res.body).toContain('<record')
      expect(res.body).toContain('limit="60"')
      expect(res.body).toContain('finish_on_key="#"')
      expect(res.body).toContain('voicemail-recording')
      expect(res.body).toContain('hub=hub-1')
      expect(res.body).toContain('test-uuid.wav')
    })

    test('defaults to 120 second limit', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleVoicemail({
        callSid: 'test-uuid',
        callerLanguage: 'en',
        callbackUrl: 'https://app.example.com',
      })
      expect(res.body).toContain('limit="120"')
    })
  })

  describe('handleWaitMusic', () => {
    test('plays hold music when within timeout', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleWaitMusic('en', undefined, 30, 90)
      expect(res.body).toContain('application="speak"')
      expect(res.body).not.toContain('voicemail')
    })

    test('leaves queue when timeout exceeded', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleWaitMusic('en', undefined, 95, 90)
      expect(res.body).toContain('call_phase=voicemail')
    })
  })

  describe('handleVoicemailComplete', () => {
    test('speaks thank you and hangs up', () => {
      const adapter = createAdapter()
      const res = adapter.handleVoicemailComplete('en')
      expect(res.body).toContain('application="speak"')
      expect(res.body).toContain('application="hangup"')
    })
  })

  describe('handleUnavailable', () => {
    test('speaks unavailable message and hangs up', () => {
      const adapter = createAdapter()
      const res = adapter.handleUnavailable('es')
      expect(res.body).toContain('application="speak"')
      expect(res.body).toContain('application="hangup"')
    })

    test('uses custom audio URL when provided', () => {
      const adapter = createAdapter()
      const res = adapter.handleUnavailable('en', {
        'unavailableMessage:en': 'https://cdn.example.com/unavailable.mp3',
      })
      expect(res.body).toContain('<playback file="https://cdn.example.com/unavailable.mp3"')
    })
  })

  describe('XML escaping', () => {
    test('special characters in text are escaped', async () => {
      const adapter = createAdapter()
      const res = await adapter.handleIncomingCall({
        callSid: 'test-uuid',
        callerNumber: '+15550001111',
        voiceCaptchaEnabled: false,
        rateLimited: true,
        callerLanguage: 'en',
        hotlineName: 'Test & "Friends" <Hotline>',
      })
      // Should not contain raw & or < in the XML
      expect(res.body).not.toMatch(/[^&]&[^a]/) // raw & not followed by entity
    })
  })
})
```

- [ ] Run unit tests: `bun test src/server/telephony/freeswitch.test.ts`
- [ ] `bun run typecheck`

---

### Task 4: Capabilities + Factory Registration

**Files:**
- Create: `src/server/telephony/freeswitch-capabilities.ts`
- Modify: `src/server/telephony/capabilities.ts` (add import + registry entry)
- Modify: `src/server/lib/adapters.ts` (add factory case + import)

- [ ] Create `src/server/telephony/freeswitch-capabilities.ts`:

```typescript
import { FreeSwitchConfigSchema } from '@shared/schemas/providers'
import type { FreeSwitchConfig } from '@shared/schemas/providers'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { ProviderCapabilities } from './capabilities'

function bridgeBase(config: FreeSwitchConfig): string {
  return ((config as Record<string, unknown>)._testBaseUrl as string) ?? config.eslUrl
}

/** Block loopback and link-local addresses. Private IPs are allowed for self-hosted FreeSWITCH. */
function isBlockedHost(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  )
    return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  return false
}

export const freeswitchCapabilities: ProviderCapabilities<FreeSwitchConfig> = {
  type: 'freeswitch',
  displayName: 'FreeSWITCH (Self-Hosted)',
  description: 'Self-hosted open-source PBX via mod_httapi XML and ESL bridge, with WebRTC via mod_verto',
  credentialSchema: FreeSwitchConfigSchema,
  supportsOAuth: false,
  supportsSms: false,
  supportsSip: true,
  supportsWebRtc: true, // via mod_verto
  supportsNumberProvisioning: false,
  supportsWebhookAutoConfig: false,

  async testConnection(config: FreeSwitchConfig): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const base = bridgeBase(config)
      const parsed = new URL(base)
      if (isBlockedHost(parsed.hostname)) {
        return {
          connected: false,
          latencyMs: 0,
          error: 'Loopback and link-local addresses are not allowed',
          errorType: 'invalid_credentials',
        }
      }
      // Health check endpoint on the sip-bridge
      const url = `${base}/health`
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          connected: false,
          latencyMs,
          error: `HTTP ${res.status}`,
          errorType:
            res.status === 401
              ? 'invalid_credentials'
              : res.status === 429
                ? 'rate_limited'
                : 'unknown',
        }
      }
      const data = (await res.json()) as {
        status?: string
        version?: string
        sipConfigured?: boolean
      }
      return {
        connected: true,
        latencyMs,
        accountName: data.version ? `FreeSWITCH bridge v${data.version}` : 'FreeSWITCH bridge',
      }
    } catch (err) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        error: String(err),
        errorType: 'network_error',
      }
    }
  },

  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/telephony/call-status${qs}`,
    }
  },
}
```

- [ ] Register in `src/server/telephony/capabilities.ts`:

```typescript
// Add import:
import { freeswitchCapabilities } from './freeswitch-capabilities'

// Add to TELEPHONY_CAPABILITIES record:
export const TELEPHONY_CAPABILITIES: Record<TelephonyProviderType, ProviderCapabilities> = {
  twilio: twilioCapabilities,
  signalwire: signalwireCapabilities,
  vonage: vonageCapabilities,
  plivo: plivoCapabilities,
  asterisk: asteriskCapabilities,
  telnyx: telnyxCapabilities,
  bandwidth: bandwidthCapabilities,
  freeswitch: freeswitchCapabilities,  // ← ADD
}
```

- [ ] Register in the adapter factory at `src/server/lib/adapters.ts`:

```typescript
// Add import at top:
import { FreeSwitchAdapter } from '../telephony/freeswitch'

// Add case in the switch statement (after 'asterisk' case):
case 'freeswitch': {
  if (!config.eslUrl || !config.eslPassword || !config.bridgeCallbackUrl)
    throw new AppError(
      500,
      'FreeSWITCH config missing eslUrl, eslPassword, or bridgeCallbackUrl'
    )
  return new FreeSwitchAdapter(
    config.bridgeCallbackUrl,
    config.eslPassword, // Bridge secret uses ESL password as shared secret
    config.phoneNumber,
    callbackBaseUrl     // The app's public URL for mod_httapi callbacks
  )
}
```

**Note:** The `FreeSwitchAdapter` constructor inherits from `SipBridgeAdapter(bridgeCallbackUrl, bridgeSecret, phoneNumber, callbackBaseUrl)`. The `callbackBaseUrl` is the app's public URL that FreeSWITCH mod_httapi uses for XML callbacks — this is different from the bridge callback URL. The factory must pass both. Check how the factory resolves `callbackBaseUrl` (likely from env or hub config) and pass it accordingly.

- [ ] `bun run typecheck`
- [ ] `bun run build`

---

### Task 5: Simulation Tests + UI Updates

**Files:**
- Modify: `tests/helpers/simulation.ts`
- Modify: `tests/api/simulation-telephony.spec.ts`
- Modify: `tests/ui/telephony-provider.spec.ts` (update test count if needed)

- [ ] Add `'freeswitch'` to the `TelephonyProvider` type in `tests/helpers/simulation.ts`:

```typescript
export type TelephonyProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk' | 'freeswitch'
```

- [ ] Add FreeSWITCH cases to each payload builder function. FreeSWITCH uses the same JSON format as Asterisk (shared bridge protocol), so the payloads are identical:

In `buildIncomingCallPayload`:
```typescript
case 'freeswitch':
  return {
    contentType: 'application/json',
    body: JSON.stringify({
      channelId: callSid,
      callSid: callSid,
      callerNumber: from,
      from: from,
      calledNumber: to,
      to: to,
      state: 'Ring',
    } satisfies AsteriskBridgeWebhook),
  }
```

In `buildCallStatusPayload`:
```typescript
case 'freeswitch':
  return {
    contentType: 'application/json',
    body: JSON.stringify({
      channelId: callSid,
      callSid: callSid,
      state: status as AsteriskBridgeWebhook['state'],
      status: status,
      duration: 30,
    } satisfies AsteriskBridgeWebhook),
  }
```

In `buildRecordingPayload`:
```typescript
case 'freeswitch':
  return {
    contentType: 'application/json',
    body: JSON.stringify({
      channelId: callSid,
      callSid: callSid,
      recordingStatus: 'done',
      recordingName: recordingSid,
      recordingSid: recordingSid,
    } satisfies AsteriskBridgeWebhook),
  }
```

**Note:** Since FreeSWITCH and Asterisk share the same bridge webhook format (`AsteriskBridgeWebhook`), the payloads are identical. This is by design — the sip-bridge normalizes ESL/ARI events into a common format.

- [ ] Add `'freeswitch'` to the `PROVIDERS` array in `tests/api/simulation-telephony.spec.ts`:

```typescript
const PROVIDERS = ['twilio', 'signalwire', 'vonage', 'plivo', 'asterisk', 'freeswitch'] as const
```

- [ ] Add FreeSWITCH to `RESPONSE_PATTERNS` in `tests/api/simulation-telephony.spec.ts`:

```typescript
const RESPONSE_PATTERNS: Record<string, { contentType: RegExp; bodyPattern: RegExp }> = {
  // ... existing ...
  // FreeSWITCH returns mod_httapi XML when configured, TwiML when using TestAdapter fallback
  freeswitch: { contentType: /xml/i, bodyPattern: /freeswitch-httapi|document|<Response>/i },
}
```

- [ ] Add `'freeswitch'` to the messaging `MessagingProvider` type if needed. FreeSWITCH doesn't do SMS natively, but if the pattern requires exhaustive coverage, add it alongside asterisk (delegates to external provider):

```typescript
export type MessagingProvider = 'twilio' | 'signalwire' | 'vonage' | 'plivo' | 'asterisk' | 'freeswitch' | 'meta'
```

And add `'freeswitch'` case to `buildIncomingMessagePayload` (SMS only, same as asterisk — Twilio-compatible delegation):
```typescript
case 'freeswitch':
  // Same as asterisk — delegates SMS to external provider (Twilio-compatible)
  // Falls through to twilio/signalwire/asterisk case
```

- [ ] Review `tests/ui/telephony-provider.spec.ts` for any hardcoded provider counts or arrays that need updating. If the UI select dropdown tests check for a specific number of options, increment accordingly.

- [ ] Run simulation tests: `bunx playwright test tests/api/simulation-telephony.spec.ts`
- [ ] Run full unit test suite: `bun run test:unit`
- [ ] `bun run typecheck && bun run build`

---

### Commit Plan

After each task, commit with a descriptive message:

1. **Task 1 commit:** `feat(telephony): add FreeSWITCH mod_httapi webhook schemas`
2. **Task 2 commit:** `feat(telephony): add FreeSWITCH config schema and type registration`
3. **Task 3 commit:** `feat(telephony): implement FreeSwitchAdapter with mod_httapi XML generation`
4. **Task 4 commit:** `feat(telephony): add FreeSWITCH capabilities and factory registration`
5. **Task 5 commit:** `feat(telephony): add FreeSWITCH to simulation tests and UI`

---

### Summary Table

| Task | Files Created | Files Modified | Tests |
|------|--------------|----------------|-------|
| 1. Webhook schemas | `src/shared/schemas/external/freeswitch-httapi.ts` | — | typecheck |
| 2. Config + types | — | `src/shared/schemas/providers.ts`, `src/shared/types.ts` | typecheck |
| 3. FreeSwitchAdapter | `src/server/telephony/freeswitch.ts`, `src/server/telephony/freeswitch.test.ts` | — | `bun test src/server/telephony/freeswitch.test.ts` |
| 4. Capabilities + factory | `src/server/telephony/freeswitch-capabilities.ts` | `src/server/telephony/capabilities.ts`, `src/server/lib/adapters.ts` | typecheck + build |
| 5. Simulation + UI | — | `tests/helpers/simulation.ts`, `tests/api/simulation-telephony.spec.ts`, `tests/ui/telephony-provider.spec.ts` | `bunx playwright test tests/api/simulation-telephony.spec.ts` |

**Total new files:** 4
**Total modified files:** 6
**Verification commands:** `bun run typecheck && bun run build && bun test src/server/telephony/freeswitch.test.ts && bunx playwright test tests/api/simulation-telephony.spec.ts`
