import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type CustomFieldDefinition, type EncryptedNote, getCustomFields, getNote } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decryptNoteV2, decryptTranscription } from '@/lib/crypto'
import * as keyManager from '@/lib/key-manager'
import { useToast } from '@/lib/toast'
import type { NotePayload } from '@shared/types'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Lock, Mic, Pencil, StickyNote } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/notes/$noteId')({
  component: NoteDetailPage,
})

interface DecryptedNote extends EncryptedNote {
  decrypted: string
  payload: NotePayload
  isTranscription: boolean
}

function NoteDetailPage() {
  const { t } = useTranslation()
  const { noteId } = Route.useParams()
  const { hasNsec, publicKey, isAdmin } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [note, setNote] = useState<DecryptedNote | null>(null)
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([getNote(noteId), getCustomFields().catch(() => ({ fields: [] }))])
      .then(async ([res, cfRes]) => {
        setCustomFields(cfRes.fields)

        const rawNote = res.note
        const isTranscription = rawNote.authorPubkey.startsWith('system:transcription')
        const unlocked = await keyManager.isUnlocked()
        const myPubkey = publicKey ?? ''
        let payload: NotePayload

        if (isTranscription && rawNote.ephemeralPubkey && hasNsec && unlocked) {
          const text =
            (await decryptTranscription(rawNote.encryptedContent, rawNote.ephemeralPubkey)) ||
            '[Decryption failed]'
          payload = { text }
        } else if (isTranscription && !rawNote.ephemeralPubkey) {
          payload = { text: rawNote.encryptedContent }
        } else if (hasNsec && unlocked) {
          const envelope = isAdmin
            ? (rawNote.adminEnvelopes?.find((e) => e.pubkey === myPubkey) ??
              rawNote.adminEnvelopes?.[0])
            : rawNote.authorEnvelope
          if (envelope) {
            payload = (await decryptNoteV2(rawNote.encryptedContent, envelope)) || {
              text: '[Decryption failed]',
            }
          } else {
            payload = { text: '[Decryption failed]' }
          }
        } else {
          payload = { text: '[No key]' }
        }

        setNote({ ...rawNote, decrypted: payload.text, payload, isTranscription })
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('403')) {
          setForbidden(true)
        } else {
          toast(t('common.error'), 'error')
        }
      })
      .finally(() => setLoading(false))
  }, [noteId, hasNsec, publicKey, isAdmin])

  const visibleFields = customFields.filter(
    (f) => isAdmin || f.visibleTo === 'contacts:envelope-summary'
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Lock className="mx-auto mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm">{t('notes.detail.forbidden')}</p>
      </div>
    )
  }

  if (!note) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <StickyNote className="mx-auto mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm">{t('notes.detail.notFound')}</p>
      </div>
    )
  }

  function handleBack() {
    if (note?.callId) {
      navigate({
        to: '/calls/$callId',
        params: { callId: note.callId },
        search: { page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false },
      })
    } else {
      navigate({ to: '/notes', search: { page: 1, callId: '', search: '' } })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <StickyNote className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">{t('notes.detail.title')}</h1>
        </div>
      </div>

      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex items-center justify-between text-sm font-normal">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {new Date(note.createdAt).toLocaleString()}
              </span>
              {note.isTranscription && (
                <Badge variant="secondary" className="gap-1">
                  <Mic className="h-3 w-3" />
                  {t('transcription.title')}
                </Badge>
              )}
              <Badge variant="outline" className="flex items-center gap-1 text-xs">
                <Lock className="h-3 w-3" />
                {t('notes.encryptionNote')}
              </Badge>
            </div>

            {/* Disabled edit button — editing happens from the call detail page */}
            <Button
              variant="ghost"
              size="icon-xs"
              disabled
              aria-label={t('common.edit')}
              title={t('notes.detail.editFromCallPage')}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </CardTitle>
        </CardHeader>

        <CardContent className="pt-4">
          <p className="whitespace-pre-wrap text-sm">{note.decrypted}</p>

          {/* Custom fields */}
          {note.payload.fields && visibleFields.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {visibleFields.map((field) => {
                const val = note.payload.fields?.[field.id]
                if (val === undefined || val === '') return null
                const displayVal =
                  field.type === 'checkbox' ? (val ? '\u2713' : '\u2717') : String(val)
                return (
                  <Badge key={field.id} variant="outline" className="text-xs">
                    {field.label}: {displayVal}
                  </Badge>
                )
              })}
            </div>
          )}

          {/* Call context link */}
          {note.callId && (
            <div className="mt-4 border-t pt-4">
              <p className="mb-1 text-xs text-muted-foreground">{t('notes.detail.callContext')}</p>
              <Link
                to="/calls/$callId"
                params={{ callId: note.callId }}
                search={{ page: 1, q: '', dateFrom: '', dateTo: '', voicemailOnly: false }}
                className="text-sm text-primary hover:underline"
              >
                {t('notes.detail.viewCall')}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
