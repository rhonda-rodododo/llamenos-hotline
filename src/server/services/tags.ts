import type { Ciphertext } from '@shared/crypto-types'
import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '../db'
import { hubs } from '../db/schema/settings'
import { tags } from '../db/schema/tags'
import type { CryptoService } from '../lib/crypto-service'

export type TagRow = typeof tags.$inferSelect

export class TagsService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  async createTag(data: {
    hubId: string
    name: string
    encryptedLabel: Ciphertext
    color?: string
    encryptedCategory?: Ciphertext | null
    createdBy: string
  }): Promise<TagRow> {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(tags)
      .values({
        id,
        hubId: data.hubId,
        name: data.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        encryptedLabel: data.encryptedLabel,
        color: data.color ?? '#6b7280',
        encryptedCategory: data.encryptedCategory ?? null,
        createdBy: data.createdBy,
        createdAt: new Date(),
      })
      .returning()
    return row
  }

  async listTags(hubId: string): Promise<TagRow[]> {
    return this.db.select().from(tags).where(eq(tags.hubId, hubId)).orderBy(tags.name)
  }

  async getTag(id: string, hubId: string): Promise<TagRow | null> {
    const rows = await this.db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.hubId, hubId)))
      .limit(1)
    return rows[0] ?? null
  }

  async getTagByName(name: string, hubId: string): Promise<TagRow | null> {
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const rows = await this.db
      .select()
      .from(tags)
      .where(and(eq(tags.name, slug), eq(tags.hubId, hubId)))
      .limit(1)
    return rows[0] ?? null
  }

  async updateTag(
    id: string,
    hubId: string,
    data: {
      encryptedLabel?: Ciphertext
      color?: string
      encryptedCategory?: Ciphertext | null
    }
  ): Promise<TagRow | null> {
    const [row] = await this.db
      .update(tags)
      .set({
        ...(data.encryptedLabel !== undefined ? { encryptedLabel: data.encryptedLabel } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.encryptedCategory !== undefined
          ? { encryptedCategory: data.encryptedCategory }
          : {}),
      })
      .where(and(eq(tags.id, id), eq(tags.hubId, hubId)))
      .returning()
    return row ?? null
  }

  async deleteTag(id: string, hubId: string): Promise<boolean> {
    const [row] = await this.db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.hubId, hubId)))
      .returning({ id: tags.id })
    return !!row
  }

  async getOrCreateTag(
    hubId: string,
    name: string,
    createdBy: string,
    encryptedLabel: Ciphertext
  ): Promise<TagRow> {
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const existing = await this.getTagByName(slug, hubId)
    if (existing) return existing
    return this.createTag({ hubId, name: slug, encryptedLabel, createdBy })
  }

  async isStrictTags(hubId: string): Promise<boolean> {
    const rows = await this.db
      .select({ strictTags: hubs.strictTags })
      .from(hubs)
      .where(eq(hubs.id, hubId))
      .limit(1)
    return rows[0]?.strictTags ?? true
  }

  async getTagUsageCount(id: string, hubId: string): Promise<number> {
    const tag = await this.getTag(id, hubId)
    if (!tag) return 0
    const result = await this.db.execute(
      sql`SELECT COUNT(*) AS count FROM contacts WHERE hub_id = ${hubId} AND tags @> ${JSON.stringify([tag.name])}::jsonb AND deleted_at IS NULL`
    )
    return Number((result as Array<{ count: unknown }>)[0]?.count ?? 0)
  }

  /**
   * Seed default tags when a hub is created. Labels are passed as pre-encrypted Ciphertext
   * because hub-key encryption happens on the client side — the server never holds the hub key
   * plaintext.
   */
  async seedDefaultTags(
    hubId: string,
    createdBy: string,
    encryptedLabels: {
      name: string
      label: Ciphertext
      color: string
      category?: Ciphertext
    }[]
  ): Promise<void> {
    for (const tag of encryptedLabels) {
      await this.createTag({
        hubId,
        name: tag.name,
        encryptedLabel: tag.label,
        color: tag.color,
        encryptedCategory: tag.category ?? null,
        createdBy,
      }).catch(() => {}) // Skip if already exists (unique constraint)
    }
  }

  async resetForTest(hubId: string): Promise<void> {
    await this.db.delete(tags).where(eq(tags.hubId, hubId))
  }
}
