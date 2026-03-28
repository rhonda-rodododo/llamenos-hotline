import type { Ciphertext } from '@shared/crypto-types'
import { and, eq, isNull } from 'drizzle-orm'
import type { CreateReportTypeInput, ReportType, UpdateReportTypeInput } from '../../shared/types'
import type { Database } from '../db'
import { hubKeys, reportTypes } from '../db/schema'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'

export class ReportTypeService {
  constructor(
    private readonly db: Database,
    private readonly crypto: CryptoService
  ) {}

  async #getHubKey(hubId: string): Promise<Uint8Array | null> {
    if (!hubId || hubId === 'global') return null
    const envelopes = await this.db.select().from(hubKeys).where(eq(hubKeys.hubId, hubId))
    if (envelopes.length === 0) return null
    try {
      return this.crypto.unwrapHubKey(
        envelopes.map((r) => ({
          pubkey: r.pubkey,
          wrappedKey: r.encryptedKey,
          ephemeralPubkey: r.ephemeralPubkey ?? '',
        }))
      )
    } catch {
      return null
    }
  }

  async listReportTypes(hubId: string): Promise<ReportType[]> {
    const rows = await this.db
      .select()
      .from(reportTypes)
      .where(eq(reportTypes.hubId, hubId))
      .orderBy(reportTypes.createdAt)
    const hubKey = await this.#getHubKey(hubId)
    return rows.map((r) => {
      const name = this.crypto.decryptField(
        r.encryptedName as Ciphertext,
        hubKey,
        'llamenos:report-type-name'
      )
      const description = r.encryptedDescription
        ? this.crypto.decryptField(
            r.encryptedDescription as Ciphertext,
            hubKey,
            'llamenos:report-type-name'
          ) || undefined
        : undefined
      return this.#rowToReportType(r, name, description)
    })
  }

  async getReportType(hubId: string, id: string): Promise<ReportType | null> {
    const rows = await this.db
      .select()
      .from(reportTypes)
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .limit(1)
    if (!rows[0]) return null
    const r = rows[0]
    const hubKey = await this.#getHubKey(hubId)
    const name = this.crypto.decryptField(
      r.encryptedName as Ciphertext,
      hubKey,
      'llamenos:report-type-name'
    )
    const description = r.encryptedDescription
      ? this.crypto.decryptField(
          r.encryptedDescription as Ciphertext,
          hubKey,
          'llamenos:report-type-name'
        ) || undefined
      : undefined
    return this.#rowToReportType(r, name, description)
  }

  async createReportType(hubId: string, data: CreateReportTypeInput): Promise<ReportType> {
    const id = crypto.randomUUID()
    const now = new Date()

    // If this is set as default, clear existing defaults first
    if (data.isDefault) {
      await this.db
        .update(reportTypes)
        .set({ isDefault: false, updatedAt: now })
        .where(
          and(
            eq(reportTypes.hubId, hubId),
            eq(reportTypes.isDefault, true),
            isNull(reportTypes.archivedAt)
          )
        )
    }

    // Encrypt name/description — hub key for hub-scoped, server key as fallback
    const hubKey = await this.#getHubKey(hubId)
    const encryptedName = hubKey
      ? this.crypto.hubEncrypt(data.name, hubKey)
      : this.crypto.serverEncrypt(data.name, 'llamenos:report-type-name')
    const encryptedDescription = data.description
      ? hubKey
        ? this.crypto.hubEncrypt(data.description, hubKey)
        : this.crypto.serverEncrypt(data.description, 'llamenos:report-type-name')
      : null

    const [row] = await this.db
      .insert(reportTypes)
      .values({
        id,
        hubId,
        encryptedName,
        encryptedDescription,
        isDefault: data.isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return this.#rowToReportType(row, data.name, data.description)
  }

  async updateReportType(
    hubId: string,
    id: string,
    data: UpdateReportTypeInput
  ): Promise<ReportType> {
    const existing = await this.getReportType(hubId, id)
    if (!existing) throw new AppError(404, 'Report type not found')

    const now = new Date()

    // If setting as default, clear other defaults
    if (data.isDefault) {
      await this.db
        .update(reportTypes)
        .set({ isDefault: false, updatedAt: now })
        .where(
          and(
            eq(reportTypes.hubId, hubId),
            eq(reportTypes.isDefault, true),
            isNull(reportTypes.archivedAt)
          )
        )
    }

    // Encrypt updated name/description — hub key for hub-scoped, server key as fallback
    const hubKey = await this.#getHubKey(hubId)
    const encFields: Record<string, unknown> = {}
    if (data.name !== undefined) {
      encFields.encryptedName = hubKey
        ? this.crypto.hubEncrypt(data.name, hubKey)
        : this.crypto.serverEncrypt(data.name, 'llamenos:report-type-name')
    }
    if (data.description !== undefined) {
      encFields.encryptedDescription = data.description
        ? hubKey
          ? this.crypto.hubEncrypt(data.description, hubKey)
          : this.crypto.serverEncrypt(data.description, 'llamenos:report-type-name')
        : null
    }

    const [row] = await this.db
      .update(reportTypes)
      .set({
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...encFields,
        updatedAt: now,
      })
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .returning()

    const name = this.crypto.decryptField(
      row.encryptedName as Ciphertext,
      hubKey,
      'llamenos:report-type-name'
    )
    const description = row.encryptedDescription
      ? this.crypto.decryptField(
          row.encryptedDescription as Ciphertext,
          hubKey,
          'llamenos:report-type-name'
        ) || undefined
      : undefined
    return this.#rowToReportType(row, name, description)
  }

  async archiveReportType(hubId: string, id: string): Promise<void> {
    const existing = await this.getReportType(hubId, id)
    if (!existing) throw new AppError(404, 'Report type not found')

    const now = new Date()
    await this.db
      .update(reportTypes)
      .set({
        archivedAt: now,
        // Can't be default if archived
        isDefault: false,
        updatedAt: now,
      })
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
  }

  async unarchiveReportType(hubId: string, id: string): Promise<ReportType> {
    const existing = await this.getReportType(hubId, id)
    if (!existing) throw new AppError(404, 'Report type not found')

    const now = new Date()
    const [row] = await this.db
      .update(reportTypes)
      .set({ archivedAt: null, updatedAt: now })
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .returning()

    const hubKey = await this.#getHubKey(hubId)
    const name = this.crypto.decryptField(
      row.encryptedName as Ciphertext,
      hubKey,
      'llamenos:report-type-name'
    )
    const description = row.encryptedDescription
      ? this.crypto.decryptField(
          row.encryptedDescription as Ciphertext,
          hubKey,
          'llamenos:report-type-name'
        ) || undefined
      : undefined
    return this.#rowToReportType(row, name, description)
  }

  async setDefaultReportType(hubId: string, id: string): Promise<ReportType> {
    const existing = await this.getReportType(hubId, id)
    if (!existing) throw new AppError(404, 'Report type not found')
    if (existing.archivedAt)
      throw new AppError(400, 'Cannot set an archived report type as default')

    const now = new Date()

    // Clear existing defaults for hub
    await this.db
      .update(reportTypes)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(reportTypes.hubId, hubId), eq(reportTypes.isDefault, true)))

    // Set this one as default
    const [row] = await this.db
      .update(reportTypes)
      .set({ isDefault: true, updatedAt: now })
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .returning()

    const hubKey = await this.#getHubKey(hubId)
    const name = this.crypto.decryptField(
      row.encryptedName as Ciphertext,
      hubKey,
      'llamenos:report-type-name'
    )
    const description = row.encryptedDescription
      ? this.crypto.decryptField(
          row.encryptedDescription as Ciphertext,
          hubKey,
          'llamenos:report-type-name'
        ) || undefined
      : undefined
    return this.#rowToReportType(row, name, description)
  }

  #rowToReportType(
    r: typeof reportTypes.$inferSelect,
    decryptedName?: string,
    decryptedDescription?: string
  ): ReportType {
    return {
      id: r.id,
      hubId: r.hubId,
      name: decryptedName ?? '',
      description: decryptedDescription,
      encryptedName: r.encryptedName ?? undefined,
      encryptedDescription: r.encryptedDescription ?? undefined,
      isDefault: r.isDefault,
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  }

  async resetForTest(): Promise<void> {
    await this.db.delete(reportTypes)
  }
}
