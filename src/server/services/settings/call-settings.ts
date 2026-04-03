import { eq } from 'drizzle-orm'
import type { Database } from '../../db'
import { callSettings, transcriptionSettings } from '../../db/schema'
import type { CallSettings, TranscriptionSettings } from '../../types'

export async function getCallSettings(db: Database, hubId?: string): Promise<CallSettings> {
  const hId = hubId ?? 'global'
  const rows = await db.select().from(callSettings).where(eq(callSettings.hubId, hId)).limit(1)
  let row = rows[0]

  // Fall back to global settings when no hub-specific row exists
  if (!row && hId !== 'global') {
    const globalRows = await db
      .select()
      .from(callSettings)
      .where(eq(callSettings.hubId, 'global'))
      .limit(1)
    row = globalRows[0]
  }

  return {
    queueTimeoutSeconds: row?.queueTimeoutSeconds ?? 90,
    voicemailMaxSeconds: row?.voicemailMaxSeconds ?? 120,
    voicemailMaxBytes: row?.voicemailMaxBytes ?? 2097152,
    voicemailMode: (row?.voicemailMode as 'auto' | 'always' | 'never') ?? 'auto',
    voicemailRetentionDays: row?.voicemailRetentionDays ?? null,
    callRecordingMaxBytes: row?.callRecordingMaxBytes ?? 20971520,
  }
}

export async function updateCallSettings(
  db: Database,
  data: Partial<CallSettings>,
  hubId?: string
): Promise<CallSettings> {
  const hId = hubId ?? 'global'
  const current = await getCallSettings(db, hId)
  const clamp = (v: number) => Math.max(30, Math.min(300, v))
  const clampBytes = (v: number) => Math.max(102400, Math.min(52428800, v)) // 100KB–50MB
  const validVoicemailModes = ['auto', 'always', 'never'] as const
  const updated: CallSettings = {
    queueTimeoutSeconds:
      data.queueTimeoutSeconds !== undefined
        ? clamp(data.queueTimeoutSeconds)
        : current.queueTimeoutSeconds,
    voicemailMaxSeconds:
      data.voicemailMaxSeconds !== undefined
        ? clamp(data.voicemailMaxSeconds)
        : current.voicemailMaxSeconds,
    voicemailMaxBytes:
      data.voicemailMaxBytes !== undefined
        ? clampBytes(data.voicemailMaxBytes)
        : current.voicemailMaxBytes,
    voicemailMode:
      data.voicemailMode !== undefined && validVoicemailModes.includes(data.voicemailMode)
        ? data.voicemailMode
        : current.voicemailMode,
    voicemailRetentionDays:
      data.voicemailRetentionDays !== undefined
        ? data.voicemailRetentionDays
        : current.voicemailRetentionDays,
    callRecordingMaxBytes:
      data.callRecordingMaxBytes !== undefined
        ? clampBytes(data.callRecordingMaxBytes)
        : current.callRecordingMaxBytes,
  }
  await db
    .insert(callSettings)
    .values({ hubId: hId, ...updated })
    .onConflictDoUpdate({
      target: callSettings.hubId,
      set: updated,
    })
  return updated
}

export async function getTranscriptionSettings(
  db: Database,
  hubId?: string
): Promise<TranscriptionSettings> {
  const hId = hubId ?? 'global'
  const rows = await db
    .select()
    .from(transcriptionSettings)
    .where(eq(transcriptionSettings.hubId, hId))
    .limit(1)
  const row = rows[0]
  return {
    globalEnabled: row?.globalEnabled ?? true,
    allowUserOptOut: row?.allowUserOptOut ?? false,
  }
}

export async function updateTranscriptionSettings(
  db: Database,
  data: Partial<TranscriptionSettings>,
  hubId?: string
): Promise<TranscriptionSettings> {
  const hId = hubId ?? 'global'
  const current = await getTranscriptionSettings(db, hId)
  const updated = { ...current, ...data }
  await db
    .insert(transcriptionSettings)
    .values({ hubId: hId, ...updated })
    .onConflictDoUpdate({
      target: transcriptionSettings.hubId,
      set: updated,
    })
  return updated
}
