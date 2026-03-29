import { ConfirmDialog } from '@/components/confirm-dialog'
import { ContactRelationshipSection } from '@/components/contacts/contact-relationship-section'
import { ContactTimeline } from '@/components/contacts/contact-timeline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type ContactRecord,
  type ContactRelationshipRecord,
  deleteContact,
  getContact,
  getContactTimeline,
  listContactRelationships,
  listContacts,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useDecryptedArray, useDecryptedObject } from '@/lib/use-decrypted'
import { LABEL_CONTACT_PII, LABEL_CONTACT_SUMMARY } from '@shared/crypto-labels'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, BookUser, Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** ContactRecord augmented with fields populated by decryptObjectFields */
type DecryptedContact = ContactRecord & {
  displayName?: string
  notes?: string
  fullName?: string
  phone?: string
}

export const Route = createFileRoute('/contacts/$contactId')({
  component: ContactProfilePage,
})

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/10 text-green-500 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-500 border-red-500/20',
}

type Timeline = {
  calls: unknown[]
  conversations: unknown[]
  notes: unknown[]
}

function ContactProfilePage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const { contactId } = Route.useParams()

  const [contact, setContact] = useState<ContactRecord | null>(null)
  const [timeline, setTimeline] = useState<Timeline>({ calls: [], conversations: [], notes: [] })
  const [relationships, setRelationships] = useState<ContactRelationshipRecord[]>([])
  const [allContacts, setAllContacts] = useState<ContactRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const canReadPii = hasPermission('contacts:read-pii')
  const canDelete = hasPermission('contacts:delete')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getContact(contactId),
      getContactTimeline(contactId),
      listContactRelationships(),
      listContacts(),
    ])
      .then(([c, tl, rels, allC]) => {
        setContact(c)
        setTimeline(tl)
        setRelationships(rels)
        setAllContacts(allC.contacts)
      })
      .catch(() => toast.error(t('common.error')))
      .finally(() => setLoading(false))
  }, [contactId, t])

  // Decrypt summary-tier fields (displayName, notes)
  const summaryDecrypted = useDecryptedObject(
    contact,
    LABEL_CONTACT_SUMMARY
  ) as DecryptedContact | null
  // Decrypt PII-tier fields (fullName, phone)
  const piiDecrypted = useDecryptedObject(contact, LABEL_CONTACT_PII) as DecryptedContact | null

  const displayName = summaryDecrypted?.displayName ?? '[encrypted]'
  const decryptedNotes = summaryDecrypted?.notes || null
  const decryptedFullName = canReadPii ? piiDecrypted?.fullName || null : null
  const decryptedPhone = canReadPii ? piiDecrypted?.phone || null : null

  // Decrypt all contacts' display names for relationship labels
  const decryptedAllContacts = useDecryptedArray(
    allContacts,
    LABEL_CONTACT_SUMMARY
  ) as DecryptedContact[]

  // Build a map of contactId → display name for relationships
  const contactNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of decryptedAllContacts) {
      map.set(c.id, c.displayName ?? '[encrypted]')
    }
    return map
  }, [decryptedAllContacts])

  function getContactTypeLabel(type: string): string {
    if (type === 'partner-org') return t('contacts.partnerOrg')
    if (type === 'referral-resource') return t('contacts.referralResource')
    return t(`contacts.${type}`, { defaultValue: type })
  }

  async function handleDelete() {
    await deleteContact(contactId)
    toast.success(t('contacts.deleted'))
    navigate({ to: '/contacts', search: { contactType: '', riskLevel: '', q: '' } })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[350px_1fr]">
          <div className="space-y-4">
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() =>
            navigate({ to: '/contacts', search: { contactType: '', riskLevel: '', q: '' } })
          }
        >
          <ArrowLeft className="h-4 w-4" />
          {t('nav.contacts', { defaultValue: 'Contacts' })}
        </button>
        <div className="py-8 text-center text-muted-foreground">{t('common.noData')}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-testid="contact-back-btn"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() =>
              navigate({ to: '/contacts', search: { contactType: '', riskLevel: '', q: '' } })
            }
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <BookUser className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-xl font-bold">{displayName}</h1>
          {contact.riskLevel && contact.riskLevel !== 'low' && (
            <Badge
              variant="outline"
              className={`shrink-0 text-xs capitalize ${RISK_COLORS[contact.riskLevel] ?? ''}`}
            >
              {t(`contacts.${contact.riskLevel}`, { defaultValue: contact.riskLevel })}
            </Badge>
          )}
        </div>
        {canDelete && (
          <Button
            data-testid="contact-delete-btn"
            variant="destructive"
            size="sm"
            onClick={() => setDeleteOpen(true)}
          >
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        )}
      </div>

      {/* Layout: sidebar + timeline */}
      <div className="grid gap-4 lg:grid-cols-[350px_1fr]">
        {/* Left sidebar */}
        <div className="space-y-4">
          {/* Summary card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('contacts.summary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs capitalize">
                  {getContactTypeLabel(contact.contactType)}
                </Badge>
                {contact.riskLevel && (
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${RISK_COLORS[contact.riskLevel] ?? ''}`}
                  >
                    {t(`contacts.${contact.riskLevel}`, { defaultValue: contact.riskLevel })}
                  </Badge>
                )}
              </div>

              {contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {decryptedNotes && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {t('contacts.notes')}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{decryptedNotes}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {contact.lastInteractionAt && (
                  <span>
                    {t('contacts.lastInteraction')}:{' '}
                    {new Date(contact.lastInteractionAt).toLocaleDateString()}
                  </span>
                )}
                <span>
                  {t('common.created', { defaultValue: 'Created' })}:{' '}
                  {new Date(contact.createdAt).toLocaleDateString()}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* PII card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('contacts.pii')}</CardTitle>
            </CardHeader>
            <CardContent>
              {!canReadPii ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4 shrink-0" />
                  {t('contacts.piiEncrypted')}
                </div>
              ) : (
                <div className="space-y-2">
                  {decryptedFullName ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('contacts.fullName')}
                      </p>
                      <p className="text-sm">{decryptedFullName}</p>
                    </div>
                  ) : null}
                  {decryptedPhone ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('contacts.phone')}
                      </p>
                      <p className="font-mono text-sm">{decryptedPhone}</p>
                    </div>
                  ) : null}
                  {!decryptedFullName && !decryptedPhone && (
                    <p className="text-sm text-muted-foreground">
                      {t('common.noData', { defaultValue: 'No data' })}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Support contacts */}
          <ContactRelationshipSection
            contactId={contactId}
            relationships={relationships}
            contactNames={contactNames}
            onNavigate={(cid) =>
              navigate({
                to: '/contacts/$contactId',
                params: { contactId: cid },
                search: { contactType: '', riskLevel: '', q: '' },
              })
            }
          />
        </div>

        {/* Right panel: timeline */}
        <ContactTimeline
          calls={timeline.calls}
          conversations={timeline.conversations}
          notes={timeline.notes}
        />
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('contacts.deleteConfirm')}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
