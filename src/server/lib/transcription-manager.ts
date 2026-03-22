import { encryptMessageForStorage } from '../lib/crypto'
import type { Services } from '../services'
import type { Env } from '../types'
import { getTelephony } from './adapters'

export async function maybeTranscribe(
  parentCallSid: string,
  recordingSid: string,
  volunteerPubkey: string,
  env: Env,
  services: Services
) {
  // Check if transcription is globally enabled
  const transSettings = await services.settings.getTranscriptionSettings()
  if (!transSettings.globalEnabled) return

  // Check if volunteer has transcription enabled
  const volunteer = await services.identity.getVolunteer(volunteerPubkey)
  if (!volunteer?.transcriptionEnabled) return

  // Get recording audio directly by recording SID
  const adapter = await getTelephony(services.settings, undefined, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return
  const audio = await adapter.getRecordingAudio(recordingSid)
  if (!audio) return

  try {
    // Transcribe using platform transcription service (CF Workers AI or self-hosted Whisper)
    const result = await env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(audio)],
    })

    if (result.text) {
      // Envelope encryption: single ciphertext, wrapped key for volunteer + admin
      const adminPubkey = env.ADMIN_DECRYPTION_PUBKEY || env.ADMIN_PUBKEY
      if (!adminPubkey) {
        console.error('[transcription] ADMIN_PUBKEY not configured — cannot encrypt transcription')
        return
      }
      const readerPubkeys = [volunteerPubkey]
      if (adminPubkey !== volunteerPubkey) readerPubkeys.push(adminPubkey)

      const { encryptedContent, readerEnvelopes } = encryptMessageForStorage(
        result.text,
        readerPubkeys
      )

      await services.records.createNote({
        callId: parentCallSid,
        authorPubkey: 'system:transcription',
        encryptedContent,
        adminEnvelopes: readerEnvelopes,
      })

      // Mark call record as having a transcription and persist the recording SID
      await services.records.updateCallRecord(parentCallSid, {
        hasTranscription: true,
        recordingSid,
        hasRecording: true,
      })
    }
  } catch (err) {
    console.error('[transcription] maybeTranscribe failed:', err)
  }
}

export async function transcribeVoicemail(callSid: string, env: Env, services: Services) {
  // Check if transcription is globally enabled
  const transSettings = await services.settings.getTranscriptionSettings()
  if (!transSettings.globalEnabled) return

  // Get voicemail recording from telephony provider
  const adapter = await getTelephony(services.settings, undefined, {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return
  const audio = await adapter.getCallRecording(callSid)
  if (!audio) return

  try {
    const result = await env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(audio)],
    })

    if (result.text) {
      // Voicemails: envelope encryption for admin only
      const adminPubkey = env.ADMIN_DECRYPTION_PUBKEY || env.ADMIN_PUBKEY
      if (!adminPubkey) {
        console.error('[transcription] ADMIN_PUBKEY not configured — cannot encrypt voicemail')
        return
      }
      const { encryptedContent, readerEnvelopes } = encryptMessageForStorage(result.text, [
        adminPubkey,
      ])

      await services.records.createNote({
        callId: callSid,
        authorPubkey: 'system:voicemail',
        encryptedContent,
        adminEnvelopes: readerEnvelopes,
      })

      // Mark call record as having a transcription
      await services.records.updateCallRecord(callSid, {
        hasTranscription: true,
      })
    }
  } catch (err) {
    console.error('[transcription] transcribeVoicemail failed:', err)
  }
}
