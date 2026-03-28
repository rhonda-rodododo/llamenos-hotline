import { PhoneInput } from '@/components/phone-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { type ContactRecord, checkContactDuplicate, createContact } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { ClientCryptoService } from '@/lib/crypto-service'
import * as keyManager from '@/lib/key-manager'
import { useToast } from '@/lib/toast'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { HMAC_PHONE_PREFIX, LABEL_CONTACT_PII, LABEL_CONTACT_SUMMARY } from '@shared/crypto-labels'
import type { HmacHash } from '@shared/crypto-types'
import { AlertTriangle, Loader2, Lock } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (contact: ContactRecord) => void
}

const CONTACT_TYPES = ['caller', 'organization', 'volunteer', 'other'] as const
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const

interface FormState {
  displayName: string
  contactType: string
  riskLevel: string
  tags: string
  notes: string
  // PII fields
  fullName: string
  phone: string
}

const INITIAL_FORM: FormState = {
  displayName: '',
  contactType: 'caller',
  riskLevel: 'low',
  tags: '',
  notes: '',
  fullName: '',
  phone: '',
}

/**
 * Hash a phone number for dedup using SHA-256 with the domain prefix.
 * The server stores whatever hash the client provides — we use SHA-256 with
 * HMAC_PHONE_PREFIX as a domain separator since the client doesn't have the
 * server HMAC secret.
 */
function hashPhone(phone: string): HmacHash {
  const input = utf8ToBytes(`${HMAC_PHONE_PREFIX}${phone}`)
  return bytesToHex(sha256(input)) as HmacHash
}

export function CreateContactDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { hasPermission } = useAuth()

  const canViewPii = hasPermission('contacts:read-pii')

  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [dupWarning, setDupWarning] = useState<{ exists: boolean; contactId?: string } | null>(null)
  const [checkingDup, setCheckingDup] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function resetForm() {
    setForm(INITIAL_FORM)
    setDupWarning(null)
    setError(null)
  }

  const handlePhoneBlur = useCallback(async () => {
    if (!form.phone) return
    setCheckingDup(true)
    setDupWarning(null)
    try {
      const hash = hashPhone(form.phone)
      const result = await checkContactDuplicate(hash)
      if (result.exists) {
        setDupWarning({ exists: true, contactId: result.contactId })
      }
    } catch {
      // Non-fatal — dedup check failure should not block creation
    } finally {
      setCheckingDup(false)
    }
  }, [form.phone])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.displayName.trim()) {
      setError(t('contacts.errorDisplayNameRequired', 'Display name is required'))
      return
    }

    if (!keyManager.isUnlocked()) {
      setError(
        t('contacts.errorKeyLocked', 'Encryption key is locked. Please unlock your key first.')
      )
      return
    }

    setSubmitting(true)
    try {
      const sk = keyManager.getSecretKey()
      const pk = keyManager.getPublicKeyHex()
      if (!pk) {
        setError(t('contacts.errorNoPubkey', 'Could not retrieve public key'))
        return
      }

      const crypto = new ClientCryptoService(sk, pk)
      // For now, encrypt for current user only — server will re-wrap for additional
      // recipients in a future task
      const summaryRecipients = [pk]
      const piiRecipients = [pk]

      const tags = form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      // Encrypt Tier 1: display name (required)
      const { encrypted: encryptedDisplayName, envelopes: displayNameEnvelopes } =
        crypto.envelopeEncrypt(form.displayName.trim(), summaryRecipients, LABEL_CONTACT_SUMMARY)

      // Encrypt notes if present
      let encryptedNotes: string | undefined
      let notesEnvelopes: ReturnType<typeof crypto.envelopeEncrypt>['envelopes'] | undefined
      if (form.notes.trim()) {
        const result = crypto.envelopeEncrypt(
          form.notes.trim(),
          summaryRecipients,
          LABEL_CONTACT_SUMMARY
        )
        encryptedNotes = result.encrypted
        notesEnvelopes = result.envelopes
      }

      // Encrypt Tier 2 fields if present
      let encryptedFullName: string | undefined
      let fullNameEnvelopes: ReturnType<typeof crypto.envelopeEncrypt>['envelopes'] | undefined
      let encryptedPhone: string | undefined
      let phoneEnvelopes: ReturnType<typeof crypto.envelopeEncrypt>['envelopes'] | undefined
      let identifierHash: HmacHash | undefined

      if (canViewPii) {
        if (form.fullName.trim()) {
          const result = crypto.envelopeEncrypt(
            form.fullName.trim(),
            piiRecipients,
            LABEL_CONTACT_PII
          )
          encryptedFullName = result.encrypted
          fullNameEnvelopes = result.envelopes
        }

        if (form.phone.trim()) {
          const result = crypto.envelopeEncrypt(form.phone.trim(), piiRecipients, LABEL_CONTACT_PII)
          encryptedPhone = result.encrypted
          phoneEnvelopes = result.envelopes
          identifierHash = hashPhone(form.phone.trim())
        }
      }

      const contact = await createContact({
        contactType: form.contactType,
        riskLevel: form.riskLevel,
        tags,
        identifierHash,
        encryptedDisplayName,
        displayNameEnvelopes,
        encryptedNotes,
        notesEnvelopes,
        encryptedFullName,
        fullNameEnvelopes,
        encryptedPhone,
        phoneEnvelopes,
      })

      toast(t('contacts.created', 'Contact created'), 'success')
      resetForm()
      onCreated(contact)
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!submitting) {
      if (!nextOpen) resetForm()
      onOpenChange(nextOpen)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('contacts.createTitle', 'New Contact')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tier 1 fields */}
          <div className="space-y-2">
            <Label htmlFor="displayName">
              {t('contacts.fields.displayName', 'Display Name')}{' '}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="displayName"
              value={form.displayName}
              onChange={(e) => setField('displayName', e.target.value)}
              placeholder={t('contacts.placeholders.displayName', 'e.g. Caller from 3/28')}
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contactType">
                {t('contacts.fields.contactType', 'Contact Type')}
              </Label>
              <Select value={form.contactType} onValueChange={(v) => setField('contactType', v)}>
                <SelectTrigger id="contactType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>
                      {t(`contacts.types.${ct}`, ct)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="riskLevel">{t('contacts.fields.riskLevel', 'Risk Level')}</Label>
              <Select value={form.riskLevel} onValueChange={(v) => setField('riskLevel', v)}>
                <SelectTrigger id="riskLevel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_LEVELS.map((rl) => (
                    <SelectItem key={rl} value={rl}>
                      {t(`contacts.riskLevels.${rl}`, rl)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">{t('contacts.fields.tags', 'Tags')}</Label>
            <Input
              id="tags"
              value={form.tags}
              onChange={(e) => setField('tags', e.target.value)}
              placeholder={t('contacts.placeholders.tags', 'Comma-separated, e.g. repeat, urgent')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">{t('contacts.fields.notes', 'Notes')}</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder={t('contacts.placeholders.notes', 'Optional notes about this contact')}
              rows={3}
            />
          </div>

          {/* Tier 2 PII fields — only visible with permission */}
          {canViewPii && (
            <div className="space-y-4 rounded-md border border-dashed p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="size-3" />
                <span>{t('contacts.piiSection', 'PII — encrypted, access-controlled')}</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fullName">{t('contacts.fields.fullName', 'Full Name')}</Label>
                <Input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => setField('fullName', e.target.value)}
                  placeholder={t('contacts.placeholders.fullName', 'Legal name')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">{t('contacts.fields.phone', 'Phone Number')}</Label>
                <PhoneInput
                  id="phone"
                  value={form.phone}
                  onChange={(v) => {
                    setField('phone', v)
                    // Reset dup warning when phone changes
                    if (dupWarning) setDupWarning(null)
                  }}
                  placeholder={t('contacts.placeholders.phone', '+1 555 000 0000')}
                />
                {/* Dedup check happens on blur via the wrapper div */}
                <div onBlur={handlePhoneBlur}>
                  {checkingDup && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      {t('contacts.checkingDup', 'Checking for duplicates...')}
                    </p>
                  )}
                  {dupWarning?.exists && (
                    <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="size-3" />
                      {t('contacts.dupWarning', 'A contact with this phone number already exists.')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="flex items-center gap-1 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !form.displayName.trim()}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('contacts.createButton', 'Create Contact')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
