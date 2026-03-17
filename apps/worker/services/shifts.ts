/**
 * ShiftsService — replaces ShiftManagerDO.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'

export class ShiftsService {
  constructor(protected db: Database) {}
}
