import { and, eq, lt } from 'drizzle-orm'
import {
  inviteCodes,
  provisionRooms,
  serverSessions,
  volunteers,
  webauthnChallenges,
  webauthnCredentials,
  webauthnSettings,
} from '../db/schema'
import type { Database } from '../db'
import { AppError } from '../lib/errors'
import type {
  AddWebAuthnCredentialData,
  CreateInviteData,
  CreateProvisionRoomData,
  CreateSessionData,
  CreateVolunteerData,
  CreateWebAuthnChallengeData,
  ProvisionRoomStatus,
  RedeemInviteData,
  SetHubRoleData,
  SetProvisionPayloadData,
  UpdateVolunteerData,
  UpdateWebAuthnCounterData,
} from '../types'
import type { MessagingChannelType } from '../../shared/types'
import type {
  InviteCode,
  ServerSession,
  Volunteer,
  WebAuthnCredential,
  WebAuthnSettings,
} from '../types'

/** Fields volunteers can update on their own profile */
const VOLUNTEER_SAFE_FIELDS = new Set([
  'name',
  'phone',
  'spokenLanguages',
  'uiLanguage',
  'profileCompleted',
  'transcriptionEnabled',
  'onBreak',
  'callPreference',
])

export class IdentityService {
  constructor(protected readonly db: Database) {}

  // ------------------------------------------------------------------ Volunteers

  async getVolunteers(): Promise<Volunteer[]> {
    const rows = await this.db.select().from(volunteers)
    return rows.map((r) => this.#rowToVolunteer(r))
  }

  async getVolunteer(pubkey: string): Promise<Volunteer | null> {
    const rows = await this.db
      .select()
      .from(volunteers)
      .where(eq(volunteers.pubkey, pubkey))
      .limit(1)
    return rows[0] ? this.#rowToVolunteer(rows[0]) : null
  }

  async createVolunteer(data: CreateVolunteerData): Promise<Volunteer> {
    const [row] = await this.db
      .insert(volunteers)
      .values({
        pubkey: data.pubkey,
        name: data.name,
        phone: data.phone,
        roles: data.roleIds ?? data.roles ?? ['role-volunteer'],
        encryptedSecretKey: data.encryptedSecretKey,
        active: true,
        transcriptionEnabled: true,
        spokenLanguages: ['en'],
        uiLanguage: 'en',
        profileCompleted: false,
        onBreak: false,
        callPreference: 'phone',
      })
      .returning()
    return this.#rowToVolunteer(row)
  }

  async updateVolunteer(
    pubkey: string,
    data: UpdateVolunteerData,
    isAdmin = false,
  ): Promise<Volunteer> {
    const existing = await this.getVolunteer(pubkey)
    if (!existing) throw new AppError(404, 'Volunteer not found')

    const allowed: Record<string, unknown> = {}
    if (isAdmin) {
      Object.assign(allowed, data)
    } else {
      for (const key of Object.keys(data) as Array<keyof UpdateVolunteerData>) {
        if (VOLUNTEER_SAFE_FIELDS.has(key)) {
          allowed[key] = data[key]
        }
      }
    }

    const [row] = await this.db
      .update(volunteers)
      .set({
        ...(allowed.name !== undefined ? { name: allowed.name as string } : {}),
        ...(allowed.phone !== undefined ? { phone: allowed.phone as string } : {}),
        ...(allowed.roles !== undefined ? { roles: allowed.roles as string[] } : {}),
        ...(allowed.active !== undefined ? { active: allowed.active as boolean } : {}),
        ...(allowed.transcriptionEnabled !== undefined
          ? { transcriptionEnabled: allowed.transcriptionEnabled as boolean }
          : {}),
        ...(allowed.spokenLanguages !== undefined
          ? { spokenLanguages: allowed.spokenLanguages as string[] }
          : {}),
        ...(allowed.uiLanguage !== undefined ? { uiLanguage: allowed.uiLanguage as string } : {}),
        ...(allowed.profileCompleted !== undefined
          ? { profileCompleted: allowed.profileCompleted as boolean }
          : {}),
        ...(allowed.onBreak !== undefined ? { onBreak: allowed.onBreak as boolean } : {}),
        ...(allowed.callPreference !== undefined
          ? { callPreference: allowed.callPreference as string }
          : {}),
        ...(allowed.encryptedSecretKey !== undefined
          ? { encryptedSecretKey: allowed.encryptedSecretKey as string }
          : {}),
        ...(allowed.supportedMessagingChannels !== undefined
          ? { supportedMessagingChannels: allowed.supportedMessagingChannels as string[] }
          : {}),
        ...(allowed.messagingEnabled !== undefined
          ? { messagingEnabled: allowed.messagingEnabled as boolean }
          : {}),
      })
      .where(eq(volunteers.pubkey, pubkey))
      .returning()
    return this.#rowToVolunteer(row)
  }

  async deleteVolunteer(pubkey: string): Promise<void> {
    await this.db.delete(volunteers).where(eq(volunteers.pubkey, pubkey))
  }

  async hasAdmin(): Promise<boolean> {
    const rows = await this.db
      .select({ roles: volunteers.roles })
      .from(volunteers)
      .where(eq(volunteers.active, true))
    return rows.some((r) => (r.roles as string[]).includes('role-super-admin'))
  }

  async bootstrapAdmin(pubkey: string): Promise<Volunteer> {
    return await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ roles: volunteers.roles })
        .from(volunteers)
        .where(eq(volunteers.active, true))
      const adminExists = existing.some((r) => (r.roles as string[]).includes('role-super-admin'))
      if (adminExists) throw new AppError(403, 'Admin already exists')

      const [row] = await tx
        .insert(volunteers)
        .values({
          pubkey,
          name: 'Admin',
          phone: '',
          roles: ['role-super-admin'],
          encryptedSecretKey: '',
          active: true,
          transcriptionEnabled: true,
          spokenLanguages: ['en', 'es'],
          uiLanguage: 'en',
          profileCompleted: false,
          onBreak: false,
          callPreference: 'phone',
        })
        .returning()
      return this.#rowToVolunteer(row)
    })
  }

  async setHubRole(data: SetHubRoleData): Promise<Volunteer> {
    const vol = await this.getVolunteer(data.pubkey)
    if (!vol) throw new AppError(404, 'Volunteer not found')

    const hubRoles = vol.hubRoles ?? []
    const idx = hubRoles.findIndex((hr) => hr.hubId === data.hubId)
    if (idx >= 0) {
      hubRoles[idx].roleIds = data.roleIds
    } else {
      hubRoles.push({ hubId: data.hubId, roleIds: data.roleIds })
    }

    const [row] = await this.db
      .update(volunteers)
      .set({ hubRoles })
      .where(eq(volunteers.pubkey, data.pubkey))
      .returning()
    return this.#rowToVolunteer(row)
  }

  async removeHubRole(pubkey: string, hubId: string): Promise<Volunteer> {
    const vol = await this.getVolunteer(pubkey)
    if (!vol) throw new AppError(404, 'Volunteer not found')

    const hubRoles = (vol.hubRoles ?? []).filter((hr) => hr.hubId !== hubId)
    const [row] = await this.db
      .update(volunteers)
      .set({ hubRoles })
      .where(eq(volunteers.pubkey, pubkey))
      .returning()
    return this.#rowToVolunteer(row)
  }

  // ------------------------------------------------------------------ Invites

  async getInvites(): Promise<InviteCode[]> {
    const rows = await this.db
      .select()
      .from(inviteCodes)
      .where(lt(inviteCodes.usedAt, new Date(0)))
    // Get all non-used (usedAt is null)
    const all = await this.db.select().from(inviteCodes)
    return all
      .filter((r) => r.usedAt === null)
      .map((r) => this.#rowToInvite(r))
  }

  async createInvite(data: CreateInviteData): Promise<InviteCode> {
    const code = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const [row] = await this.db
      .insert(inviteCodes)
      .values({
        code,
        name: data.name,
        phone: data.phone,
        roleIds: data.roleIds ?? ['role-volunteer'],
        createdBy: data.createdBy,
        expiresAt,
      })
      .returning()
    return this.#rowToInvite(row)
  }

  async validateInvite(code: string): Promise<{ valid: boolean; error?: string; name?: string; roleIds?: string[] }> {
    const rows = await this.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code))
      .limit(1)
    const row = rows[0]
    if (!row) return { valid: false, error: 'not_found' }
    if (row.usedAt !== null) return { valid: false, error: 'already_used' }
    if (row.expiresAt < new Date()) return { valid: false, error: 'expired' }
    return { valid: true, name: row.name, roleIds: row.roleIds as string[] }
  }

  async redeemInvite(data: RedeemInviteData): Promise<Volunteer> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, data.code))
        .limit(1)
      const invite = rows[0]
      if (!invite) throw new AppError(400, 'Invalid invite code')
      if (invite.usedAt !== null) throw new AppError(400, 'Invite already used')
      if (invite.expiresAt < new Date()) throw new AppError(400, 'Invite expired')

      // Mark invite as used
      await tx
        .update(inviteCodes)
        .set({ usedAt: new Date(), usedBy: data.pubkey })
        .where(eq(inviteCodes.code, data.code))

      // Create volunteer
      const [row] = await tx
        .insert(volunteers)
        .values({
          pubkey: data.pubkey,
          name: invite.name,
          phone: invite.phone,
          roles: (invite.roleIds as string[]) ?? ['role-volunteer'],
          encryptedSecretKey: '',
          active: true,
          transcriptionEnabled: true,
          spokenLanguages: ['en'],
          uiLanguage: 'en',
          profileCompleted: false,
          onBreak: false,
          callPreference: 'phone',
        })
        .returning()
      return this.#rowToVolunteer(row)
    })
  }

  async revokeInvite(code: string): Promise<void> {
    await this.db.delete(inviteCodes).where(eq(inviteCodes.code, code))
  }

  // ------------------------------------------------------------------ WebAuthn Credentials

  async getWebAuthnCredentials(pubkey: string): Promise<WebAuthnCredential[]> {
    const rows = await this.db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.pubkey, pubkey))
    return rows.map((r) => this.#rowToCredential(r))
  }

  async getAllWebAuthnCredentials(): Promise<Array<WebAuthnCredential & { ownerPubkey: string }>> {
    const rows = await this.db.select().from(webauthnCredentials)
    return rows.map((r) => ({ ...this.#rowToCredential(r), ownerPubkey: r.pubkey }))
  }

  async addWebAuthnCredential(data: AddWebAuthnCredentialData): Promise<void> {
    const cred = data.credential
    await this.db.insert(webauthnCredentials).values({
      id: cred.id,
      pubkey: data.pubkey,
      publicKey: cred.publicKey,
      counter: String(cred.counter),
      transports: cred.transports,
      backedUp: cred.backedUp,
      label: cred.label,
      lastUsedAt: new Date(cred.lastUsedAt),
    })
  }

  async deleteWebAuthnCredential(pubkey: string, credId: string): Promise<void> {
    const rows = await this.db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.pubkey, pubkey), eq(webauthnCredentials.id, credId)))
      .limit(1)
    if (!rows[0]) throw new AppError(404, 'Credential not found')
    await this.db
      .delete(webauthnCredentials)
      .where(and(eq(webauthnCredentials.pubkey, pubkey), eq(webauthnCredentials.id, credId)))
  }

  async updateWebAuthnCounter(data: UpdateWebAuthnCounterData): Promise<void> {
    const rows = await this.db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.pubkey, data.pubkey), eq(webauthnCredentials.id, data.credId)))
      .limit(1)
    if (!rows[0]) throw new AppError(404, 'Credential not found')
    await this.db
      .update(webauthnCredentials)
      .set({ counter: String(data.counter), lastUsedAt: new Date(data.lastUsedAt) })
      .where(and(eq(webauthnCredentials.pubkey, data.pubkey), eq(webauthnCredentials.id, data.credId)))
  }

  // ------------------------------------------------------------------ WebAuthn Challenges

  async storeWebAuthnChallenge(data: CreateWebAuthnChallengeData): Promise<void> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    await this.db
      .insert(webauthnChallenges)
      .values({
        id: data.id,
        pubkey: data.pubkey ?? null,
        challenge: data.challenge,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: webauthnChallenges.id,
        set: { challenge: data.challenge, expiresAt },
      })
  }

  async getWebAuthnChallenge(id: string): Promise<string> {
    const rows = await this.db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.id, id))
      .limit(1)
    const row = rows[0]
    if (!row) throw new AppError(404, 'Challenge not found')
    // Delete on read (one-shot)
    await this.db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, id))
    if (row.expiresAt < new Date()) throw new AppError(410, 'Challenge expired')
    return row.challenge
  }

  // ------------------------------------------------------------------ WebAuthn Settings

  async getWebAuthnSettings(): Promise<WebAuthnSettings> {
    const rows = await this.db
      .select()
      .from(webauthnSettings)
      .where(eq(webauthnSettings.id, 'global'))
      .limit(1)
    const row = rows[0]
    return {
      requireForAdmins: row?.requireForAdmins ?? false,
      requireForVolunteers: row?.requireForVolunteers ?? false,
    }
  }

  async updateWebAuthnSettings(data: Partial<WebAuthnSettings>): Promise<WebAuthnSettings> {
    const current = await this.getWebAuthnSettings()
    const updated = { ...current, ...data }
    await this.db
      .insert(webauthnSettings)
      .values({ id: 'global', ...updated })
      .onConflictDoUpdate({
        target: webauthnSettings.id,
        set: updated,
      })
    return updated
  }

  // ------------------------------------------------------------------ Sessions

  async createSession(data: CreateSessionData): Promise<ServerSession> {
    const tokenBytes = new Uint8Array(32)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)
    const [row] = await this.db
      .insert(serverSessions)
      .values({ token, pubkey: data.pubkey, expiresAt })
      .returning()

    return {
      token: row.token,
      pubkey: row.pubkey,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }
  }

  async validateSession(token: string): Promise<ServerSession> {
    const rows = await this.db
      .select()
      .from(serverSessions)
      .where(eq(serverSessions.token, token))
      .limit(1)
    const row = rows[0]
    if (!row) throw new AppError(401, 'Invalid session')
    if (row.expiresAt < new Date()) {
      await this.db.delete(serverSessions).where(eq(serverSessions.token, token))
      throw new AppError(401, 'Session expired')
    }

    // Sliding expiry: extend if less than 7h remain (renew threshold = 1h used of 8h)
    const SESSION_DURATION_MS = 8 * 60 * 60 * 1000
    const RENEWAL_THRESHOLD_MS = SESSION_DURATION_MS - 1 * 60 * 60 * 1000
    const remaining = row.expiresAt.getTime() - Date.now()
    if (remaining < RENEWAL_THRESHOLD_MS) {
      const newExpiry = new Date(Date.now() + SESSION_DURATION_MS)
      await this.db
        .update(serverSessions)
        .set({ expiresAt: newExpiry })
        .where(eq(serverSessions.token, token))
      return {
        token: row.token,
        pubkey: row.pubkey,
        createdAt: row.createdAt.toISOString(),
        expiresAt: newExpiry.toISOString(),
      }
    }

    return {
      token: row.token,
      pubkey: row.pubkey,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }
  }

  async revokeSession(token: string): Promise<void> {
    await this.db.delete(serverSessions).where(eq(serverSessions.token, token))
  }

  async revokeAllSessions(pubkey: string): Promise<number> {
    const rows = await this.db
      .select({ token: serverSessions.token })
      .from(serverSessions)
      .where(eq(serverSessions.pubkey, pubkey))
    if (rows.length === 0) return 0
    await this.db.delete(serverSessions).where(eq(serverSessions.pubkey, pubkey))
    return rows.length
  }

  // ------------------------------------------------------------------ Provision Rooms

  async createProvisionRoom(data: CreateProvisionRoomData): Promise<{ roomId: string; token: string }> {
    const roomId = crypto.randomUUID()
    const tokenBytes = new Uint8Array(16)
    crypto.getRandomValues(tokenBytes)
    const token = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    await this.db.insert(provisionRooms).values({
      roomId,
      ephemeralPubkey: data.ephemeralPubkey,
      token,
      status: 'waiting',
      expiresAt,
    })
    return { roomId, token }
  }

  async getProvisionRoom(id: string, token: string): Promise<ProvisionRoomStatus> {
    const rows = await this.db
      .select()
      .from(provisionRooms)
      .where(eq(provisionRooms.roomId, id))
      .limit(1)
    const row = rows[0]
    if (!row) throw new AppError(404, 'Room not found')
    if (row.token !== token) throw new AppError(403, 'Invalid token')
    if (row.expiresAt < new Date()) {
      await this.db.delete(provisionRooms).where(eq(provisionRooms.roomId, id))
      return { status: 'expired' }
    }
    if (row.encryptedNsec) {
      // Consume payload on read
      await this.db.delete(provisionRooms).where(eq(provisionRooms.roomId, id))
      return {
        status: 'ready',
        ephemeralPubkey: row.ephemeralPubkey,
        encryptedNsec: row.encryptedNsec,
        primaryPubkey: row.primaryPubkey ?? undefined,
      }
    }
    return { status: 'waiting', ephemeralPubkey: row.ephemeralPubkey }
  }

  async setProvisionPayload(id: string, data: SetProvisionPayloadData): Promise<void> {
    const rows = await this.db
      .select()
      .from(provisionRooms)
      .where(eq(provisionRooms.roomId, id))
      .limit(1)
    const row = rows[0]
    if (!row) throw new AppError(404, 'Room not found')
    if (row.token !== data.token) throw new AppError(403, 'Invalid token')
    if (row.expiresAt < new Date()) {
      await this.db.delete(provisionRooms).where(eq(provisionRooms.roomId, id))
      throw new AppError(410, 'Room expired')
    }
    await this.db
      .update(provisionRooms)
      .set({
        encryptedNsec: data.encryptedNsec,
        primaryPubkey: data.primaryPubkey,
        status: 'ready',
      })
      .where(eq(provisionRooms.roomId, id))
  }

  // ------------------------------------------------------------------ Test Reset

  async resetForTest(): Promise<void> {
    await this.db.delete(serverSessions)
    await this.db.delete(webauthnCredentials)
    await this.db.delete(webauthnChallenges)
    await this.db.delete(provisionRooms)
    await this.db.delete(inviteCodes)
    await this.db.delete(volunteers)
  }

  // ------------------------------------------------------------------ Private helpers

  #rowToVolunteer(r: typeof volunteers.$inferSelect): Volunteer {
    return {
      pubkey: r.pubkey,
      name: r.name,
      phone: r.phone,
      roles: r.roles as string[],
      hubRoles: r.hubRoles as Array<{ hubId: string; roleIds: string[] }>,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      encryptedSecretKey: r.encryptedSecretKey,
      transcriptionEnabled: r.transcriptionEnabled,
      spokenLanguages: r.spokenLanguages as string[],
      uiLanguage: r.uiLanguage,
      profileCompleted: r.profileCompleted,
      onBreak: r.onBreak,
      callPreference: (r.callPreference as 'phone' | 'browser' | 'both'),
      supportedMessagingChannels: r.supportedMessagingChannels as MessagingChannelType[] | undefined,
      messagingEnabled: r.messagingEnabled ?? undefined,
    }
  }

  #rowToInvite(r: typeof inviteCodes.$inferSelect): InviteCode {
    return {
      code: r.code,
      name: r.name,
      phone: r.phone,
      roleIds: r.roleIds as string[],
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      usedAt: r.usedAt?.toISOString(),
      usedBy: r.usedBy ?? undefined,
    }
  }

  #rowToCredential(r: typeof webauthnCredentials.$inferSelect): WebAuthnCredential {
    return {
      id: r.id,
      publicKey: r.publicKey,
      counter: Number(r.counter),
      transports: r.transports as string[],
      backedUp: r.backedUp,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
    }
  }
}

