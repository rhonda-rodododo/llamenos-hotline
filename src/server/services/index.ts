import type { Database } from '../db'
import { BlastService } from './blasts'
import { CallService } from './calls'
import { ConversationService } from './conversations'
import { IdentityService } from './identity'
import { RecordsService } from './records'
import { SettingsService } from './settings'
import { ShiftService } from './shifts'

export type {
  BlastService,
  CallService,
  ConversationService,
  IdentityService,
  RecordsService,
  SettingsService,
  ShiftService,
}

export interface Services {
  identity: IdentityService
  settings: SettingsService
  records: RecordsService
  shifts: ShiftService
  calls: CallService
  conversations: ConversationService
  blasts: BlastService
}

export function createServices(db: Database): Services {
  return {
    identity: new IdentityService(db),
    settings: new SettingsService(db),
    records: new RecordsService(db),
    shifts: new ShiftService(db),
    calls: new CallService(db),
    conversations: new ConversationService(db),
    blasts: new BlastService(db),
  }
}
