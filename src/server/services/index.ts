import type { Database } from '../db'
import type { CryptoService } from '../lib/crypto-service'
import type { StorageManager } from '../types'
import { BlastService } from './blasts'
import { CallService } from './calls'
import { ContactService } from './contacts'
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
import { TeamsService } from './teams'

export type {
  BlastService,
  CallService,
  ContactService,
  ConversationService,
  FilesService,
  GdprService,
  IdentityService,
  PushService,
  RecordsService,
  ReportTypeService,
  SettingsService,
  ShiftService,
  TeamsService,
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
  contacts: ContactService
  teams: TeamsService
  providerHealth?: ProviderHealthService
  storage: StorageManager | null
  crypto: CryptoService
}

export function createServices(
  db: Database,
  crypto: CryptoService,
  storage: StorageManager | null = null
): Services {
  return {
    identity: new IdentityService(db, crypto),
    settings: new SettingsService(db, crypto),
    records: new RecordsService(db, crypto),
    shifts: new ShiftService(db, crypto),
    calls: new CallService(db, crypto),
    conversations: new ConversationService(db, crypto),
    blasts: new BlastService(db, crypto),
    files: new FilesService(db, storage),
    gdpr: new GdprService(db, crypto),
    reportTypes: new ReportTypeService(db, crypto),
    push: new PushService(db, crypto),
    contacts: new ContactService(db, crypto),
    teams: new TeamsService(db, crypto),
    storage,
    crypto,
  }
}
