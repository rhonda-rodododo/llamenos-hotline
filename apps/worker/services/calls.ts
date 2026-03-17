/**
 * CallsService — replaces CallRouterDO.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'

export class CallsService {
  constructor(protected db: Database) {}
}
