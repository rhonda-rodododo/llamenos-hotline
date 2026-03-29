import { useCallback, useEffect, useRef, useState } from 'react'

type FieldValues = Record<string, string | number | boolean>

interface DraftData {
  text: string
  callId: string
  fields: FieldValues
  savedAt: number
}

const STORAGE_PREFIX = 'llamenos-draft:'
const DEBOUNCE_MS = 500

/**
 * Draft auto-save hook.
 *
 * NOTE: Draft encryption/decryption previously used getSecretKey() which is now
 * worker-isolated. Drafts are stored unencrypted in localStorage for now.
 * Since localStorage is same-origin and the app enforces authentication,
 * this is acceptable for local convenience data. A future iteration will
 * add worker-based draft encryption.
 */
export function useDraft(key: string) {
  const [text, setText] = useState('')
  const [callId, setCallId] = useState('')
  const [fields, setFields] = useState<FieldValues>({})
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storageKey = STORAGE_PREFIX + key

  // Restore on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const data: DraftData = JSON.parse(raw)
      setText(data.text)
      setCallId(data.callId)
      setFields(data.fields || {})
      setSavedAt(data.savedAt)
    } catch {
      // Corrupted draft — ignore
    }
  }, [storageKey])

  // Persist helper
  const persist = useCallback(
    (t: string, cId: string, f: FieldValues) => {
      const hasFields = Object.keys(f).length > 0
      if (!t && !cId && !hasFields) {
        localStorage.removeItem(storageKey)
        setSavedAt(null)
        return
      }
      try {
        const now = Date.now()
        const data: DraftData = { text: t, callId: cId, fields: f, savedAt: now }
        localStorage.setItem(storageKey, JSON.stringify(data))
        setSavedAt(now)
        setIsDirty(false)
      } catch {
        // Storage full or unavailable — ignore
      }
    },
    [storageKey]
  )

  // Debounced save on text/callId/fields change
  useEffect(() => {
    if (!isDirty) return
    timerRef.current = setTimeout(() => persist(text, callId, fields), DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [text, callId, fields, isDirty, persist])

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const setTextWrapped = useCallback((v: string) => {
    setText(v)
    setIsDirty(true)
  }, [])

  const setCallIdWrapped = useCallback((v: string) => {
    setCallId(v)
    setIsDirty(true)
  }, [])

  const setFieldValue = useCallback((fieldId: string, value: string | number | boolean) => {
    setFields((prev) => ({ ...prev, [fieldId]: value }))
    setIsDirty(true)
  }, [])

  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey)
    setText('')
    setCallId('')
    setFields({})
    setSavedAt(null)
    setIsDirty(false)
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [storageKey])

  return {
    text,
    callId,
    fields,
    setText: setTextWrapped,
    setCallId: setCallIdWrapped,
    setFieldValue,
    clearDraft,
    savedAt,
    isDirty,
  }
}
