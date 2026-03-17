/**
 * ConversationsService — replaces ConversationDO.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'

export class ConversationsService {
  constructor(protected db: Database) {}
}
