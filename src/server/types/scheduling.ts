export interface Shift {
  id: string
  name: string
  startTime: string
  endTime: string
  days: number[]
  userPubkeys: string[]
  createdAt: string
}

export interface ShiftSchedule {
  id: string
  hubId: string
  name: string
  encryptedName?: string
  startTime: string
  endTime: string
  days: number[]
  userPubkeys: string[]
  ringGroupId?: string | null
  createdAt: Date
}

export interface CreateScheduleData {
  hubId?: string
  /** Plaintext name (legacy / server-side fallback). Prefer encryptedName for new clients. */
  name?: string
  startTime: string
  endTime: string
  days: number[]
  userPubkeys: string[]
  ringGroupId?: string
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
}

export interface ShiftOverride {
  id: string
  hubId: string
  scheduleId?: string | null
  date: string
  type: string
  userPubkeys?: string[] | null
  createdAt: Date
}

export interface CreateOverrideData {
  hubId?: string
  scheduleId?: string
  date: string
  type: 'cancel' | 'substitute'
  userPubkeys?: string[]
}

export interface RingGroup {
  id: string
  hubId: string
  name: string
  encryptedName?: string
  userPubkeys: string[]
  createdAt: Date
}

export interface CreateRingGroupData {
  hubId?: string
  name: string
  userPubkeys: string[]
  /** Hub-key encrypted name (client provides). */
  encryptedName?: string
}

export interface ActiveShift {
  pubkey: string
  hubId: string
  startedAt: Date
  ringGroupId?: string | null
}

export interface StartShiftData {
  pubkey: string
  hubId?: string
  ringGroupId?: string
}
