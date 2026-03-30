import { RecordingPlayer } from '@/components/recording-player'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type AuditLogEntry, type CallRecord, type EncryptedNote, getCallDetail } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decryptCallRecord, decryptNoteV2, decryptTranscription } from '@/lib/crypto'
import { decryptObjectFields } from '@/lib/decrypt-fields'
import * as keyManager from '@/lib/key-manager'
import { useVolunteers } from '@/lib/queries/volunteers'
import { useToast } from '@/lib/toast'
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'
import type { NotePayload } from '@shared/types'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Clock,
  Mic,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  ScrollText,
  StickyNote,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/calls/$callId')({
  component: CallDetailPage,
})

interface DecryptedNote extends EncryptedNote {
  decrypted: string
  payload: NotePayload
  isTranscription: boolean
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function CallDetailPage() {
  const { t } = useTranslation()
  const { callId } = Route.useParams()
  const { isAdmin, hasNsec, publicKey } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [call, setCall] = useState<CallRecord | null>(null)
  const [notes, setNotes] = useState<DecryptedNote[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  // useVolunteers decrypts PII fields (name) in the query fn
  const { data: volunteers = [] } = useVolunteers()

  useEffect(() => {
    setLoading(true)
    getCallDetail(callId)
      .then(async (detail) => {
        setCall(detail.call)
        setAuditEntries(detail.auditEntries)

        const unlocked = await keyManager.isUnlocked()
        const myPubkey = publicKey ?? ''
        const decrypted: DecryptedNote[] = []
        for (const note of detail.notes) {
          const isTranscription = note.authorPubkey.startsWith('system:transcription')
          let payload: NotePayload
          if (isTranscription && note.ephemeralPubkey && hasNsec && unlocked) {
            const text =
              (await decryptTranscription(note.encryptedContent, note.ephemeralPubkey)) ||
              '[Decryption failed]'
            payload = { text }
          } else if (isTranscription && !note.ephemeralPubkey) {
            payload = { text: note.encryptedContent }
          } else if (hasNsec && unlocked) {
            const envelope = isAdmin
              ? (note.adminEnvelopes?.find((e) => e.pubkey === myPubkey) ??
                note.adminEnvelopes?.[0])
              : note.authorEnvelope
            if (envelope) {
              payload = (await decryptNoteV2(note.encryptedContent, envelope)) || {
                text: '[Decryption failed]',
              }
            } else {
              payload = { text: '[Decryption failed]' }
            }
          } else {
            payload = { text: '[No key]' }
          }
          decrypted.push({ ...note, decrypted: payload.text, payload, isTranscription })
        }
        setNotes(decrypted)
      })
      .catch(() => toast(t('common.error'), 'error'))
      .finally(() => setLoading(false))
  }, [callId, hasNsec, publicKey, isAdmin])

  // Decrypt call record client-side (E2EE metadata + envelope-encrypted fields)
  const [decryptedCallWithFields, setDecryptedCall] = useState<CallRecord | null>(null)
  useEffect(() => {
    if (!call || !hasNsec || !publicKey) {
      setDecryptedCall(call)
      return
    }
    void (async () => {
      const unlocked = await keyManager.isUnlocked()
      let result = { ...call }

      // Decrypt E2EE admin envelope (answeredBy, callerNumber)
      if (
        call.answeredBy === undefined &&
        call.encryptedContent &&
        call.adminEnvelopes?.length &&
        unlocked
      ) {
        const meta = await decryptCallRecord(call.encryptedContent, call.adminEnvelopes, publicKey)
        if (meta) {
          result = { ...result, answeredBy: meta.answeredBy, callerNumber: meta.callerNumber }
        }
      }

      // Decrypt ECIES envelope fields (e.g. encryptedCallerLast4 → callerLast4)
      if (unlocked) {
        await decryptObjectFields(
          result as unknown as Record<string, unknown>,
          publicKey,
          LABEL_VOLUNTEER_PII
        )
      }

      setDecryptedCall(result)
    })()
  }, [call, hasNsec, publicKey])

  // useVolunteers already decrypts name/phone in the query fn
  const nameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const v of volunteers) map.set(v.pubkey, v.name)
    return map
  }, [volunteers])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!decryptedCallWithFields) {
    return (
      <div className="py-8 text-center text-muted-foreground">{t('calls.detail.notFound')}</div>
    )
  }

  const volunteerName = decryptedCallWithFields.answeredBy
    ? nameMap.get(decryptedCallWithFields.answeredBy) ||
      decryptedCallWithFields.answeredBy.slice(0, 8)
    : null

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() =>
            navigate({
              to: '/calls',
              search: { page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false },
            })
          }
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <PhoneIncoming className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">{t('calls.detail.title')}</h1>
        </div>
      </div>

      {/* Two-column layout on larger screens */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Call metadata */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('calls.detail.metadata')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              {decryptedCallWithFields.status === 'unanswered' ? (
                <>
                  <PhoneMissed className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">{t('callHistory.unanswered')}</span>
                </>
              ) : (
                <>
                  <PhoneIncoming className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {t('callHistory.answeredBy')}: {volunteerName || '-'}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{new Date(decryptedCallWithFields.startedAt).toLocaleString()}</span>
            </div>

            {decryptedCallWithFields.duration !== undefined && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(decryptedCallWithFields.duration)}
                </Badge>
              </div>
            )}

            {(() => {
              const cl4 = decryptedCallWithFields.callerLast4 ?? ''
              return cl4 && cl4 !== '[encrypted]' ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <code className="font-mono text-xs">***{cl4}</code>
                </div>
              ) : cl4 === '[encrypted]' ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <code className="font-mono text-xs">{cl4}</code>
                </div>
              ) : null
            })()}

            {decryptedCallWithFields.hasRecording && (
              <div className="pt-2">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {t('calls.detail.recording')}
                </p>
                <RecordingPlayer callId={decryptedCallWithFields.id} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Notes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <StickyNote className="h-4 w-4" />
              {t('calls.detail.notes')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {notes.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                <StickyNote className="mx-auto mb-2 h-6 w-6 opacity-40" />
                {t('notes.noNotes')}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {notes.map((note) => (
                  <div key={note.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {new Date(note.createdAt).toLocaleString()}
                          </span>
                          {note.isTranscription && (
                            <Badge variant="secondary" className="gap-1">
                              <Mic className="h-3 w-3" />
                              {t('transcription.title')}
                            </Badge>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{note.decrypted}</p>
                      </div>
                      <Link
                        to="/notes/$noteId"
                        params={{ noteId: note.id }}
                        search={{ page: 1, callId: callId, search: '' }}
                        className="shrink-0 text-xs text-primary hover:underline"
                      >
                        {t('notes.permalink')}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audit timeline (admin only) */}
      {isAdmin && auditEntries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" />
              {t('calls.detail.audit')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {auditEntries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {entry.event}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {entry.details &&
                      typeof entry.details === 'object' &&
                      Object.keys(entry.details).length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {Object.entries(entry.details)
                            .filter(([k]) => k !== 'callId')
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(', ')}
                        </p>
                      )}
                    {typeof entry.details?.noteId === 'string' && (
                      <Link
                        to="/notes/$noteId"
                        params={{ noteId: entry.details.noteId }}
                        search={{ page: 1, callId: callId, search: '' }}
                        className="mt-1 block text-xs text-primary hover:underline"
                      >
                        {t('notes.viewPermalink')}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
