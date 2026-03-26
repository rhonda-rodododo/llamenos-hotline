import type { Database } from '../db'
import type { StorageManager } from '../types'
import { BlastService } from './blasts'
import { CallService } from './calls'
import { ConversationService } from './conversations'
import { FilesService } from './files'
import { GdprService } from './gdpr'
import { IdentityService } from './identity'
import type { ProviderHealthService } from './provider-health'
import { PushService } from './push'
import { RecordsService } from './records'
import { ReportTypeService } from './report-types'
import { SettingsService } from './settings'
import { ShiftService } from './shifts'

export type {
  BlastService,
  CallService,
  ConversationService,
  FilesService,
  GdprService,
  IdentityService,
  PushService,
  RecordsService,
  ReportTypeService,
  SettingsService,
  ShiftService,
  ProviderHealthService,
}

export interface Services {
  identity: IdentityService
  settings: SettingsService
  records: RecordsService
  shifts: ShiftService
  calls: CallService
  conversations: ConversationService
  blasts: BlastService
  files: FilesService
  gdpr: GdprService
  reportTypes: ReportTypeService
  push: PushService
  providerHealth?: ProviderHealthService
  storage: StorageManager | null
}

export function createServices(
  db: Database,
  storage: StorageManager | null = null,
  serverSecret = ''
): Services {
  return {
    identity: new IdentityService(db),
    settings: new SettingsService(db, serverSecret),
    records: new RecordsService(db),
    shifts: new ShiftService(db),
    calls: new CallService(db),
    conversations: new ConversationService(db),
    blasts: new BlastService(db),
    files: new FilesService(db, storage),
    gdpr: new GdprService(db),
    reportTypes: new ReportTypeService(db),
    push: new PushService(db),
    storage,
  }
}
