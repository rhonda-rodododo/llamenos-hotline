/**
 * IdentityService — replaces IdentityDO.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'

export class IdentityService {
  constructor(protected db: Database) {}
}
