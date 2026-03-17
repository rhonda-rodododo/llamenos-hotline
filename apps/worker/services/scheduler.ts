/**
 * TaskScheduler — periodic background task runner.
 * Methods will be added as scheduled tasks are defined.
 */
import type { Database } from '../db'

export class TaskScheduler {
  constructor(protected db: Database) {}

  start(): void {}

  stop(): void {}
}
