import { eq, sql } from 'drizzle-orm'
import type { Database } from '../../db'
import { captchaState, rateLimitCounters, spamSettings } from '../../db/schema'
import type { SpamSettings } from '../../types'

export async function getSpamSettings(db: Database, hubId?: string): Promise<SpamSettings> {
  const hId = hubId ?? 'global'
  const rows = await db.select().from(spamSettings).where(eq(spamSettings.hubId, hId)).limit(1)
  let row = rows[0]
  // Fall back to global settings when hub-specific settings don't exist
  if (!row && hId !== 'global') {
    const globalRows = await db
      .select()
      .from(spamSettings)
      .where(eq(spamSettings.hubId, 'global'))
      .limit(1)
    row = globalRows[0]
  }
  return {
    voiceCaptchaEnabled: row?.voiceCaptchaEnabled ?? false,
    rateLimitEnabled: row?.rateLimitEnabled ?? true,
    maxCallsPerMinute: row?.maxCallsPerMinute ?? 3,
    blockDurationMinutes: row?.blockDurationMinutes ?? 30,
    captchaMaxAttempts: row?.captchaMaxAttempts ?? 3,
  }
}

export async function updateSpamSettings(
  db: Database,
  data: Partial<SpamSettings>,
  hubId?: string
): Promise<SpamSettings> {
  const hId = hubId ?? 'global'
  const current = await getSpamSettings(db, hId)
  const updated = { ...current, ...data }
  await db
    .insert(spamSettings)
    .values({ hubId: hId, ...updated })
    .onConflictDoUpdate({
      target: spamSettings.hubId,
      set: updated,
    })
  return updated
}

export async function checkRateLimit(
  db: Database,
  key: string,
  maxPerMinute: number
): Promise<boolean> {
  const now = new Date()
  const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000) // floor to current minute

  const [result] = await db
    .insert(rateLimitCounters)
    .values({ key, count: 1, windowStart })
    .onConflictDoUpdate({
      target: rateLimitCounters.key,
      set: {
        count: sql`CASE WHEN ${rateLimitCounters.windowStart} < ${windowStart}
            THEN 1
            ELSE ${rateLimitCounters.count} + 1
          END`,
        windowStart: sql`CASE WHEN ${rateLimitCounters.windowStart} < ${windowStart}
            THEN ${windowStart}
            ELSE ${rateLimitCounters.windowStart}
          END`,
      },
    })
    .returning()

  return result.count > maxPerMinute
}

export async function storeCaptcha(
  db: Database,
  callSid: string,
  expectedDigits: string,
  preserveAttempts = false
): Promise<void> {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
  await db
    .insert(captchaState)
    .values({ callSid, expectedDigits, attempts: 0, expiresAt })
    .onConflictDoUpdate({
      target: captchaState.callSid,
      set: preserveAttempts
        ? { expectedDigits, expiresAt }
        : { expectedDigits, attempts: 0, expiresAt },
    })
}

export async function verifyCaptcha(
  db: Database,
  callSid: string,
  digits: string,
  maxAttempts = 3
): Promise<{
  match: boolean
  expected: string
  shouldRetry: boolean
  remainingAttempts: number
}> {
  const rows = await db
    .select()
    .from(captchaState)
    .where(eq(captchaState.callSid, callSid))
    .limit(1)

  const row = rows[0]
  if (!row) return { match: false, expected: '', shouldRetry: false, remainingAttempts: 0 }
  if (row.expiresAt < new Date()) {
    // Expired — delete and reject
    await db.delete(captchaState).where(eq(captchaState.callSid, callSid))
    return {
      match: false,
      expected: row.expectedDigits,
      shouldRetry: false,
      remainingAttempts: 0,
    }
  }

  // Constant-time comparison
  const expected = row.expectedDigits
  let match = expected.length === digits.length ? 1 : 0
  for (let i = 0; i < expected.length; i++) {
    match &= expected.charCodeAt(i) === digits.charCodeAt(i) ? 1 : 0
  }

  if (match === 1) {
    // Correct — delete and pass
    await db.delete(captchaState).where(eq(captchaState.callSid, callSid))
    return { match: true, expected, shouldRetry: false, remainingAttempts: 0 }
  }

  // Wrong — increment attempts
  const newAttempts = (row.attempts ?? 0) + 1
  if (newAttempts >= maxAttempts) {
    // Max attempts reached — delete and reject
    await db.delete(captchaState).where(eq(captchaState.callSid, callSid))
    return { match: false, expected, shouldRetry: false, remainingAttempts: 0 }
  }

  // Still has retries — update attempt count, keep record
  await db
    .update(captchaState)
    .set({ attempts: newAttempts })
    .where(eq(captchaState.callSid, callSid))
  return {
    match: false,
    expected,
    shouldRetry: true,
    remainingAttempts: maxAttempts - newAttempts,
  }
}
