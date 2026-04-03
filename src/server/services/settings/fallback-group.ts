import { eq } from 'drizzle-orm'
import type { Database } from '../../db'
import { fallbackGroup } from '../../db/schema'

export async function getFallbackGroup(db: Database, hubId?: string): Promise<string[]> {
  const hId = hubId ?? 'global'
  const rows = await db.select().from(fallbackGroup).where(eq(fallbackGroup.hubId, hId)).limit(1)
  if (rows[0]) return (rows[0].userPubkeys as string[]) ?? []
  // Fall back to global fallback group when hub-specific is not configured
  if (hId !== 'global') {
    const globalRows = await db
      .select()
      .from(fallbackGroup)
      .where(eq(fallbackGroup.hubId, 'global'))
      .limit(1)
    return (globalRows[0]?.userPubkeys as string[]) ?? []
  }
  return []
}

export async function setFallbackGroup(
  db: Database,
  pubkeys: string[],
  hubId?: string
): Promise<void> {
  const hId = hubId ?? 'global'
  await db
    .insert(fallbackGroup)
    .values({ hubId: hId, userPubkeys: pubkeys })
    .onConflictDoUpdate({
      target: fallbackGroup.hubId,
      set: { userPubkeys: pubkeys },
    })
}
