import { and, eq, isNull } from 'drizzle-orm'
import type { CreateReportTypeInput, ReportType, UpdateReportTypeInput } from '../../shared/types'
import type { Database } from '../db'
import { reportTypes } from '../db/schema'
import { AppError } from '../lib/errors'

export class ReportTypeService {
  constructor(private readonly db: Database) {}

  async listReportTypes(hubId: string): Promise<ReportType[]> {
    const rows = await this.db
      .select()
      .from(reportTypes)
      .where(eq(reportTypes.hubId, hubId))
      .orderBy(reportTypes.createdAt)
    return rows.map(this.#rowToReportType)
  }

  async getReportType(hubId: string, id: string): Promise<ReportType | null> {
    const rows = await this.db
      .select()
      .from(reportTypes)
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .limit(1)
    return rows[0] ? this.#rowToReportType(rows[0]) : null
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

    const [row] = await this.db
      .insert(reportTypes)
      .values({
        id,
        hubId,
        name: data.name,
        description: data.description ?? null,
        isDefault: data.isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return this.#rowToReportType(row)
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

    const [row] = await this.db
      .update(reportTypes)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        updatedAt: now,
      })
      .where(and(eq(reportTypes.id, id), eq(reportTypes.hubId, hubId)))
      .returning()

    return this.#rowToReportType(row)
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

    return this.#rowToReportType(row)
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

    return this.#rowToReportType(row)
  }

  #rowToReportType(r: typeof reportTypes.$inferSelect): ReportType {
    return {
      id: r.id,
      hubId: r.hubId,
      name: r.name,
      description: r.description ?? undefined,
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
