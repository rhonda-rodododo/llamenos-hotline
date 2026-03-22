import { eq, sql } from 'drizzle-orm'
import type { FileKeyEnvelope, FileRecord, EncryptedMetaItem } from '../../shared/types'
import { fileRecords } from '../db/schema'
import type { Database } from '../db'
import type { BlobStorage } from '../types'
import { AppError } from '../lib/errors'

export class FilesService {
  constructor(
    protected readonly db: Database,
    private readonly blob: BlobStorage | null,
  ) {}

  get hasBlob(): boolean {
    return this.blob !== null
  }

  // ------------------------------------------------------------------ DB: FileRecord CRUD

  async createFileRecord(
    data: Omit<FileRecord, 'completedChunks' | 'createdAt' | 'completedAt'>,
  ): Promise<FileRecord> {
    const now = new Date()
    const [row] = await this.db
      .insert(fileRecords)
      .values({
        id: data.id,
        conversationId: data.conversationId,
        messageId: data.messageId ?? null,
        uploadedBy: data.uploadedBy,
        recipientEnvelopes: data.recipientEnvelopes,
        encryptedMetadata: data.encryptedMetadata,
        totalSize: data.totalSize,
        totalChunks: data.totalChunks,
        status: data.status,
        completedChunks: 0,
        createdAt: now,
      })
      .returning()
    return this.#rowToFileRecord(row)
  }

  async getFileRecord(id: string): Promise<FileRecord | null> {
    const rows = await this.db
      .select()
      .from(fileRecords)
      .where(eq(fileRecords.id, id))
      .limit(1)
    return rows[0] ? this.#rowToFileRecord(rows[0]) : null
  }

  /**
   * Atomically increment completedChunks. Returns the updated counts.
   * Uses sql`` to avoid read-modify-write races.
   */
  async incrementChunk(id: string): Promise<{ completedChunks: number; totalChunks: number }> {
    const [row] = await this.db
      .update(fileRecords)
      .set({ completedChunks: sql`${fileRecords.completedChunks} + 1` })
      .where(eq(fileRecords.id, id))
      .returning({
        completedChunks: fileRecords.completedChunks,
        totalChunks: fileRecords.totalChunks,
      })
    if (!row) throw new AppError(404, 'Upload not found')
    return { completedChunks: row.completedChunks, totalChunks: row.totalChunks }
  }

  async completeUpload(id: string): Promise<FileRecord> {
    const [row] = await this.db
      .update(fileRecords)
      .set({ status: 'complete', completedAt: new Date() })
      .where(eq(fileRecords.id, id))
      .returning()
    if (!row) throw new AppError(404, 'Upload not found')
    return this.#rowToFileRecord(row)
  }

  async failUpload(id: string): Promise<void> {
    await this.db
      .update(fileRecords)
      .set({ status: 'failed' })
      .where(eq(fileRecords.id, id))
  }

  async getFilesByConversation(conversationId: string): Promise<FileRecord[]> {
    const rows = await this.db
      .select()
      .from(fileRecords)
      .where(eq(fileRecords.conversationId, conversationId))
    return rows.map((r) => this.#rowToFileRecord(r))
  }

  async addRecipientEnvelope(
    id: string,
    envelope: FileKeyEnvelope,
    meta: EncryptedMetaItem,
  ): Promise<void> {
    const record = await this.getFileRecord(id)
    if (!record) throw new AppError(404, 'File not found')
    await this.db
      .update(fileRecords)
      .set({
        recipientEnvelopes: [...record.recipientEnvelopes, envelope],
        encryptedMetadata: [...record.encryptedMetadata, meta],
      })
      .where(eq(fileRecords.id, id))
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToFileRecord(r: typeof fileRecords.$inferSelect): FileRecord {
    return {
      id: r.id,
      conversationId: r.conversationId,
      messageId: r.messageId ?? undefined,
      uploadedBy: r.uploadedBy,
      recipientEnvelopes: (r.recipientEnvelopes as FileKeyEnvelope[]) ?? [],
      encryptedMetadata: (r.encryptedMetadata as EncryptedMetaItem[]) ?? [],
      totalSize: r.totalSize,
      totalChunks: r.totalChunks,
      status: r.status as FileRecord['status'],
      completedChunks: r.completedChunks,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString(),
    }
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(fileRecords)
  }

  // ------------------------------------------------------------------ Blob: Chunks

  async putChunk(uploadId: string, chunkIndex: number, data: ArrayBuffer): Promise<void> {
    const key = `files/${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    await this.#requireBlob().put(key, data)
  }

  async getChunk(uploadId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
    const key = `files/${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    const obj = await this.#requireBlob().get(key)
    return obj ? obj.arrayBuffer() : null
  }

  async deleteChunk(uploadId: string, chunkIndex: number): Promise<void> {
    const key = `files/${uploadId}/chunk-${String(chunkIndex).padStart(6, '0')}`
    await this.#requireBlob().delete(key)
  }

  async deleteAllChunks(uploadId: string, totalChunks: number): Promise<void> {
    const blob = this.#requireBlob()
    for (let i = 0; i < totalChunks; i++) {
      const key = `files/${uploadId}/chunk-${String(i).padStart(6, '0')}`
      await blob.delete(key)
    }
  }

  // ------------------------------------------------------------------ Blob: Assembled content

  async putAssembled(uploadId: string, data: Uint8Array): Promise<void> {
    await this.#requireBlob().put(`files/${uploadId}/content`, data)
  }

  async getAssembled(uploadId: string): Promise<{ body: ReadableStream; size: number } | null> {
    return this.#requireBlob().get(`files/${uploadId}/content`)
  }

  async deleteAssembled(uploadId: string): Promise<void> {
    await this.#requireBlob().delete(`files/${uploadId}/content`)
  }

  // ------------------------------------------------------------------ Blob: Envelopes & Metadata (blob copies for backward compat)

  async storeEnvelopesBlob(uploadId: string, envelopes: FileKeyEnvelope[]): Promise<void> {
    await this.#requireBlob().put(`files/${uploadId}/envelopes`, JSON.stringify(envelopes))
  }

  async storeMetadataBlob(uploadId: string, meta: EncryptedMetaItem[]): Promise<void> {
    await this.#requireBlob().put(`files/${uploadId}/metadata`, JSON.stringify(meta))
  }

  // ------------------------------------------------------------------ Private: blob guard

  #requireBlob(): BlobStorage {
    if (!this.blob) throw new AppError(503, 'File storage not configured')
    return this.blob
  }
}
