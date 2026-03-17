/**
 * SettingsService — replaces SettingsDO.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'

export class SettingsService {
  constructor(protected db: Database) {}
}
