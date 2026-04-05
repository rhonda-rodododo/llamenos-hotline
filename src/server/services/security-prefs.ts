import { eq } from 'drizzle-orm'
import type { Database } from '../db'
import { type UserSecurityPrefsRow, userSecurityPrefs } from '../db/schema/security-prefs'

export type DigestCadence = 'off' | 'daily' | 'weekly'

const DEFAULTS = {
  lockDelayMs: 30000,
  disappearingTimerDays: 1,
  digestCadence: 'weekly' as DigestCadence,
  alertOnNewDevice: true,
  alertOnPasskeyChange: true,
  alertOnPinChange: true,
}

export class SecurityPrefsService {
  constructor(private db: Database) {}

  async get(userPubkey: string): Promise<UserSecurityPrefsRow> {
    const rows = await this.db
      .select()
      .from(userSecurityPrefs)
      .where(eq(userSecurityPrefs.userPubkey, userPubkey))
      .limit(1)
    if (rows[0]) return rows[0]
    const inserted = await this.db
      .insert(userSecurityPrefs)
      .values({ userPubkey, ...DEFAULTS })
      .returning()
    return inserted[0]
  }

  async update(
    userPubkey: string,
    patch: Partial<Omit<UserSecurityPrefsRow, 'userPubkey' | 'updatedAt'>>
  ): Promise<UserSecurityPrefsRow> {
    await this.get(userPubkey)
    const rows = await this.db
      .update(userSecurityPrefs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(userSecurityPrefs.userPubkey, userPubkey))
      .returning()
    return rows[0]
  }
}
