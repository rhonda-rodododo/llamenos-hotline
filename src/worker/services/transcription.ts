import { encryptMessageForStorage } from '../lib/crypto'
import type { DurableObjects } from '../lib/do-access'
import { getTelephony } from '../lib/do-access'
import type { Env } from '../types'

/**
 * Call self-hosted Whisper server if WHISPER_SERVER_URL is configured.
 * Returns the transcribed text, or null if no server is configured.
 *
 * CF AI path has been removed — audio should never leave the deployment boundary.
 * Client-side WASM Whisper is the primary transcription method (Epic 78).
 * Self-hosted Whisper is the opt-in server-side fallback for post-call recordings.
 */
async function transcribeWithSelfHosted(
  audio: ArrayBuffer,
  env: Env
): Promise<string | null> {
  const whisperUrl = env.WHISPER_SERVER_URL
  if (!whisperUrl) return null

  const formData = new FormData()
  const blob = new Blob([audio], { type: 'audio/wav' })
  formData.append('file', blob, 'audio.wav')
  formData.append('model', 'Systran/faster-whisper-base')
  formData.append('response_format', 'json')

  const response = await fetch(whisperUrl, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Whisper transcription failed: ${response.status} ${response.statusText}`)
  }

  const result = (await response.json()) as { text: string }
  return result.text || null
}

export async function maybeTranscribe(
  parentCallSid: string,
  recordingSid: string,
  volunteerPubkey: string,
  env: Env,
  dos: DurableObjects
) {
  // Check if transcription is globally enabled
  const transRes = await dos.settings.fetch(new Request('http://do/settings/transcription'))
  const { globalEnabled } = (await transRes.json()) as { globalEnabled: boolean }
  if (!globalEnabled) return

  // Check if volunteer has transcription enabled
  const volRes = await dos.identity.fetch(new Request(`http://do/volunteer/${volunteerPubkey}`))
  if (!volRes.ok) return
  const volunteer = (await volRes.json()) as { transcriptionEnabled: boolean }
  if (!volunteer.transcriptionEnabled) return

  // Get recording audio directly by recording SID
  const adapter = await getTelephony(env, dos)
  if (!adapter) return
  const audio = await adapter.getRecordingAudio(recordingSid)
  if (!audio) return

  try {
    // Use self-hosted Whisper if configured; otherwise skip (client handles it)
    const text = await transcribeWithSelfHosted(audio, env)
    if (!text) return

    // Envelope encryption: single ciphertext, wrapped key for volunteer + admin
    const adminPubkey = env.ADMIN_DECRYPTION_PUBKEY || env.ADMIN_PUBKEY
    const readerPubkeys = [volunteerPubkey]
    if (adminPubkey !== volunteerPubkey) readerPubkeys.push(adminPubkey)

    const { encryptedContent, readerEnvelopes } = encryptMessageForStorage(
      text,
      readerPubkeys
    )
    await dos.records.fetch(
      new Request('http://do/notes', {
        method: 'POST',
        body: JSON.stringify({
          callId: parentCallSid,
          authorPubkey: 'system:transcription',
          encryptedContent,
          readerEnvelopes,
        }),
      })
    )

    // Mark call record as having a transcription and persist the recording SID
    await dos.calls.fetch(
      new Request(`http://do/calls/${parentCallSid}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify({ hasTranscription: true, recordingSid, hasRecording: true }),
      })
    )
  } catch (err) {
    console.error('[transcription] maybeTranscribe failed:', err)
  }
}

export async function transcribeVoicemail(callSid: string, env: Env, dos: DurableObjects) {
  // Check if transcription is globally enabled
  const transRes = await dos.settings.fetch(new Request('http://do/settings/transcription'))
  const { globalEnabled } = (await transRes.json()) as { globalEnabled: boolean }
  if (!globalEnabled) return

  // Get voicemail recording from telephony provider
  const adapter = await getTelephony(env, dos)
  if (!adapter) return
  const audio = await adapter.getCallRecording(callSid)
  if (!audio) return

  try {
    // Use self-hosted Whisper if configured; otherwise skip (client handles it)
    const text = await transcribeWithSelfHosted(audio, env)
    if (!text) return

    // Voicemails: envelope encryption for admin only
    const adminPubkey = env.ADMIN_DECRYPTION_PUBKEY || env.ADMIN_PUBKEY
    const { encryptedContent, readerEnvelopes } = encryptMessageForStorage(text, [
      adminPubkey,
    ])
    await dos.records.fetch(
      new Request('http://do/notes', {
        method: 'POST',
        body: JSON.stringify({
          callId: callSid,
          authorPubkey: 'system:voicemail',
          encryptedContent,
          readerEnvelopes,
        }),
      })
    )

    // Mark call record as having a transcription
    await dos.calls.fetch(
      new Request(`http://do/calls/${callSid}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify({ hasTranscription: true }),
      })
    )
  } catch (err) {
    console.error('[transcription] transcribeVoicemail failed:', err)
  }
}
