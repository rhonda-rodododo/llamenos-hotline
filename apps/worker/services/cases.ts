/**
 * CasesService — replaces case management methods in RecordsDO.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'

export class CasesService {
  constructor(protected db: Database) {}
}
