import type { Database } from '../db'
import type { BlobStorage } from '../types'
import { BlastService } from './blasts'
import { CallService } from './calls'
import { ConversationService } from './conversations'
import { FilesService } from './files'
import { GdprService } from './gdpr'
import { IdentityService } from './identity'
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
  RecordsService,
  ReportTypeService,
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
  files: FilesService
  gdpr: GdprService
  reportTypes: ReportTypeService
}

export function createServices(db: Database, blob: BlobStorage | null = null, serverSecret = ''): Services {
  return {
    identity: new IdentityService(db),
    settings: new SettingsService(db, serverSecret),
    records: new RecordsService(db),
    shifts: new ShiftService(db),
    calls: new CallService(db),
    conversations: new ConversationService(db),
    blasts: new BlastService(db),
    files: new FilesService(db, blob),
    gdpr: new GdprService(db),
    reportTypes: new ReportTypeService(db),
  }
}
