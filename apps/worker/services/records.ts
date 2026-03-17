/**
 * RecordsService — replaces RecordsDO.
 * Methods will be migrated from the DO as routes are updated.
 */
import type { Database } from '../db'
import type { AuditService } from './audit'

export class RecordsService {
  constructor(
    protected db: Database,
    protected audit: AuditService,
  ) {}
}
