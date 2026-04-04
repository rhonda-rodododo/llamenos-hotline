import type { Database } from '../db'
import type { CryptoService } from '../lib/crypto-service'
import type { StorageManager } from '../types'
import { BlastService } from './blasts'
import { CallService } from './calls'
import { ContactService } from './contacts'
import { ConversationService } from './conversations'
import { FilesService } from './files'
import { FirehoseService } from './firehose'
import type { FirehoseAgentService } from './firehose-agent'
import { GdprService } from './gdpr'
import { IdentityService } from './identity'
import { IntakesService } from './intakes'
import type { ProviderHealthService } from './provider-health'
import { PushService } from './push'
import { RecordsService } from './records'
import { ReportTypeService } from './report-types'
import { SettingsService } from './settings'
import { ShiftService } from './shifts'
import { TagsService } from './tags'
import { TeamsService } from './teams'

export type {
  BlastService,
  FirehoseService,
  FirehoseAgentService,
  CallService,
  ContactService,
  ConversationService,
  FilesService,
  GdprService,
  IdentityService,
  IntakesService,
  PushService,
  RecordsService,
  ReportTypeService,
  SettingsService,
  ShiftService,
  TagsService,
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
  intakes: IntakesService
  tags: TagsService
  teams: TeamsService
  firehose: FirehoseService
  firehoseAgent?: FirehoseAgentService
  providerHealth?: ProviderHealthService
  storage: StorageManager | null
  crypto: CryptoService
}

export function createServices(
  db: Database,
  crypto: CryptoService,
  storage: StorageManager | null = null
): Services {
  const settings = new SettingsService(db, crypto)
  const contactService = new ContactService(db, crypto)
  const teamsService = new TeamsService(db, crypto)

  // Late-bind cross-service dependencies to avoid circular constructor coupling
  contactService.setTeamsService(teamsService)

  return {
    identity: new IdentityService(db, crypto),
    settings,
    records: new RecordsService(db, crypto),
    shifts: new ShiftService(db, crypto, settings),
    calls: new CallService(db, crypto),
    conversations: new ConversationService(db, crypto),
    blasts: new BlastService(db, crypto, settings),
    files: new FilesService(db, storage),
    gdpr: new GdprService(db, crypto),
    reportTypes: new ReportTypeService(db, crypto, settings),
    push: new PushService(db, crypto),
    contacts: contactService,
    intakes: new IntakesService(db, crypto),
    tags: new TagsService(db, crypto),
    teams: teamsService,
    firehose: new FirehoseService(db, crypto),
    storage,
    crypto,
  }
}
