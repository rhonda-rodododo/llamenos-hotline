/**
 * ContactsService — replaces contacts methods in RecordsDO.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'

export class ContactsService {
  constructor(protected db: Database) {}
}
