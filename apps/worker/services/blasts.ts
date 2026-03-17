/**
 * BlastsService — replaces BlastDO.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'

export class BlastsService {
  constructor(protected db: Database) {}
}
