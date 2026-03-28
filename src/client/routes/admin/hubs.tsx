import { PhoneInput } from '@/components/phone-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  type Hub,
  type HubExportCategory,
  archiveHub,
  createHub,
  deleteHub,
  exportHubData,
  listHubs,
  updateHub,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decryptHubField, encryptHubField } from '@/lib/hub-field-crypto'
import { useToast } from '@/lib/toast'
import { createFileRoute } from '@tanstack/react-router'
import {
  Archive,
  Building2,
  Download,
  Pencil,
  Phone,
  Plus,
  Shield,
  ShieldOff,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/admin/hubs')({
  component: HubsPage,
})

function HubsPage() {
  const { t } = useTranslation()
  const auth = useAuth()
  const { hasPermission } = auth
  const { toast } = useToast()
  const isSuperAdmin = auth.roles.includes('role-super-admin')
  const [hubs, setHubs] = useState<Hub[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingHub, setEditingHub] = useState<Hub | null>(null)
  const [archivingHub, setArchivingHub] = useState<Hub | null>(null)
  const [deletingHub, setDeletingHub] = useState<Hub | null>(null)

  useEffect(() => {
    loadHubs()
  }, [])

  async function loadHubs() {
    try {
      const res = await listHubs()
      setHubs(res.hubs)
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setLoading(false)
    }
  }

  if (!hasPermission('system:manage-hubs')) {
    return (
      <div className="text-muted-foreground">
        {t('hubs.accessDenied', { defaultValue: 'Access denied' })}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold sm:text-2xl">{t('hubs.title')}</h1>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4" />
          {t('hubs.createHub')}
        </Button>
      </div>

      {/* Hub list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-4">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                  <div className="ml-auto h-4 w-20 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : hubs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">{t('hubs.noHubs')}</div>
          ) : (
            <div className="divide-y divide-border">
              {hubs.map((hub) => (
                <HubRow
                  key={hub.id}
                  hub={hub}
                  isSuperAdmin={isSuperAdmin}
                  onEdit={() => setEditingHub(hub)}
                  onArchive={() => setArchivingHub(hub)}
                  onDelete={() => setDeletingHub(hub)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create hub dialog */}
      <CreateHubDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={(hub) => {
          setHubs((prev) => [...prev, hub])
          setShowCreateDialog(false)
        }}
      />

      {/* Edit hub dialog */}
      {editingHub && (
        <EditHubDialog
          open={!!editingHub}
          onOpenChange={(open) => {
            if (!open) setEditingHub(null)
          }}
          hub={editingHub}
          isSuperAdmin={isSuperAdmin}
          onUpdated={(updated) => {
            setHubs((prev) => prev.map((h) => (h.id === updated.id ? updated : h)))
            setEditingHub(null)
          }}
        />
      )}

      {/* Archive hub dialog */}
      <ArchiveHubDialog
        open={!!archivingHub}
        onOpenChange={(open) => {
          if (!open) setArchivingHub(null)
        }}
        hub={archivingHub}
        onArchived={(id) => {
          setHubs((prev) => prev.filter((h) => h.id !== id))
          setArchivingHub(null)
        }}
      />

      {/* Delete hub dialog */}
      <DeleteHubDialog
        open={!!deletingHub}
        onOpenChange={(open) => {
          if (!open) setDeletingHub(null)
        }}
        hub={deletingHub}
        onDeleted={(id) => {
          setHubs((prev) => prev.filter((h) => h.id !== id))
          setDeletingHub(null)
        }}
      />
    </div>
  )
}

function HubRow({
  hub,
  isSuperAdmin,
  onEdit,
  onArchive,
  onDelete,
}: {
  hub: Hub
  isSuperAdmin: boolean
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  const statusColors: Record<Hub['status'], string> = {
    active: 'border-green-500/50 text-green-700 dark:text-green-400',
    suspended: 'border-yellow-500/50 text-yellow-700 dark:text-yellow-400',
    archived: 'border-red-500/50 text-red-700 dark:text-red-400',
  }

  return (
    <div
      data-testid="hub-row"
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
          <Building2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {decryptHubField(hub.encryptedName, hub.id)}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{hub.id}</span>
          </p>
          {hub.encryptedDescription && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {decryptHubField(hub.encryptedDescription, hub.id)}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {hub.phoneNumber && (
          <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
            <Phone className="h-3 w-3" />
            {hub.phoneNumber}
          </span>
        )}
        <Badge variant="outline" className={statusColors[hub.status]}>
          {t(`hubs.status.${hub.status}`)}
        </Badge>
        {isSuperAdmin && (
          <Badge
            variant="outline"
            className={
              hub.allowSuperAdminAccess
                ? 'border-blue-500/50 text-blue-700 dark:text-blue-400'
                : 'border-orange-500/50 text-orange-700 dark:text-orange-400'
            }
            data-testid="hub-access-badge"
          >
            {hub.allowSuperAdminAccess ? (
              <Shield className="mr-1 h-3 w-3" />
            ) : (
              <ShieldOff className="mr-1 h-3 w-3" />
            )}
            {hub.allowSuperAdminAccess
              ? t('hubs.accessControl.enabled')
              : t('hubs.accessControl.restricted')}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {new Date(hub.createdAt).toLocaleDateString()}
        </span>
        <Button variant="ghost" size="xs" onClick={onEdit}>
          <Pencil className="h-3 w-3" />
          {t('common.edit')}
        </Button>
        {hub.status !== 'archived' && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onArchive}
            className="text-destructive hover:text-destructive"
          >
            <Archive className="h-3 w-3" />
            {t('hubs.archive')}
          </Button>
        )}
        {hub.status === 'archived' && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
            data-testid="hub-delete-btn"
          >
            <Trash2 className="h-3 w-3" />
            {t('hubs.delete')}
          </Button>
        )}
      </div>
    </div>
  )
}

function CreateHubDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (hub: Hub) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [saving, setSaving] = useState(false)

  function resetForm() {
    setName('')
    setDescription('')
    setPhoneNumber('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const res = await createHub({
        name: name.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(phoneNumber.trim() && { phoneNumber: phoneNumber.trim() }),
      })
      onCreated(res.hub)
      resetForm()
      toast(t('hubs.hubCreated'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) resetForm()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('hubs.createHub')}</DialogTitle>
          <DialogDescription>{t('hubs.createHubDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hub-name">{t('hubs.hubName')}</Label>
            <Input
              id="hub-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('hubs.hubNamePlaceholder')}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hub-description">{t('hubs.hubDescription')}</Label>
            <Textarea
              id="hub-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('hubs.hubDescriptionPlaceholder')}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hub-phone">{t('hubs.hubPhoneNumber')}</Label>
            <PhoneInput id="hub-phone" value={phoneNumber} onChange={setPhoneNumber} />
            <p className="text-xs text-muted-foreground">{t('hubs.hubPhoneNumberHelp')}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                resetForm()
              }}
              disabled={saving}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? t('common.loading') : t('hubs.createHub')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditHubDialog({
  open,
  onOpenChange,
  hub,
  isSuperAdmin,
  onUpdated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hub: Hub
  isSuperAdmin: boolean
  onUpdated: (hub: Hub) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const decryptedName = decryptHubField(hub.encryptedName, hub.id)
  const decryptedDesc = decryptHubField(hub.encryptedDescription, hub.id)
  const [name, setName] = useState(decryptedName)
  const [description, setDescription] = useState(decryptedDesc)
  const [phoneNumber, setPhoneNumber] = useState(hub.phoneNumber || '')
  const [saving, setSaving] = useState(false)
  const [showAccessConfirm, setShowAccessConfirm] = useState<'enable' | 'disable' | null>(null)
  const [togglingAccess, setTogglingAccess] = useState(false)

  // Reset form state when hub changes
  useEffect(() => {
    setName(decryptHubField(hub.encryptedName, hub.id))
    setDescription(decryptHubField(hub.encryptedDescription, hub.id))
    setPhoneNumber(hub.phoneNumber || '')
  }, [hub])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const trimmedName = name.trim()
      const trimmedDesc = description.trim()
      const res = await updateHub(hub.id, {
        name: trimmedName,
        description: trimmedDesc || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        encryptedName: encryptHubField(trimmedName, hub.id),
        encryptedDescription: trimmedDesc ? encryptHubField(trimmedDesc, hub.id) : undefined,
      })
      onUpdated(res.hub)
      toast(t('hubs.hubUpdated'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleAccessToggleRequest() {
    if (hub.allowSuperAdminAccess) {
      setShowAccessConfirm('disable')
    } else {
      setShowAccessConfirm('enable')
    }
  }

  async function handleAccessToggleConfirm() {
    const newValue = showAccessConfirm === 'enable'
    setTogglingAccess(true)
    try {
      const res = await updateHub(hub.id, { allowSuperAdminAccess: newValue })
      onUpdated(res.hub)
      toast(t('hubs.hubUpdated'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setTogglingAccess(false)
      setShowAccessConfirm(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('hubs.editHub')}</DialogTitle>
            <DialogDescription>{t('hubs.editHubDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-hub-name">{t('hubs.hubName')}</Label>
              <Input
                id="edit-hub-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-hub-description">{t('hubs.hubDescription')}</Label>
              <Textarea
                id="edit-hub-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-hub-phone">{t('hubs.hubPhoneNumber')}</Label>
              <PhoneInput id="edit-hub-phone" value={phoneNumber} onChange={setPhoneNumber} />
              <p className="text-xs text-muted-foreground">{t('hubs.hubPhoneNumberHelp')}</p>
            </div>

            {/* Status display (read-only) */}
            <div className="space-y-2">
              <Label>{t('common.status')}</Label>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    hub.status === 'active'
                      ? 'border-green-500/50 text-green-700 dark:text-green-400'
                      : hub.status === 'suspended'
                        ? 'border-yellow-500/50 text-yellow-700 dark:text-yellow-400'
                        : 'border-red-500/50 text-red-700 dark:text-red-400'
                  }
                >
                  {t(`hubs.status.${hub.status}`)}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{hub.id}</span>
              </div>
            </div>

            {/* Access Control section */}
            <div className="space-y-3 rounded-lg border p-4" data-testid="hub-access-control">
              <div className="flex items-center gap-2">
                {hub.allowSuperAdminAccess ? (
                  <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                ) : (
                  <ShieldOff className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                )}
                <Label className="text-sm font-semibold">{t('hubs.accessControl.title')}</Label>
              </div>
              <p className="text-xs text-muted-foreground">{t('hubs.accessControl.description')}</p>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="access-toggle" className="text-sm">
                  {t('hubs.accessControl.allowSuperAdmin')}
                </Label>
                {isSuperAdmin ? (
                  <Badge
                    variant="outline"
                    className={
                      hub.allowSuperAdminAccess
                        ? 'border-blue-500/50 text-blue-700 dark:text-blue-400'
                        : 'border-orange-500/50 text-orange-700 dark:text-orange-400'
                    }
                  >
                    {hub.allowSuperAdminAccess
                      ? t('hubs.accessControl.enabled')
                      : t('hubs.accessControl.restricted')}
                  </Badge>
                ) : (
                  <Switch
                    id="access-toggle"
                    checked={hub.allowSuperAdminAccess ?? false}
                    onCheckedChange={handleAccessToggleRequest}
                    data-testid="hub-access-toggle"
                  />
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Access control confirmation dialog */}
      <Dialog
        open={showAccessConfirm !== null}
        onOpenChange={(v) => {
          if (!v) setShowAccessConfirm(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('hubs.accessControl.title')}</DialogTitle>
            <DialogDescription>
              {showAccessConfirm === 'enable'
                ? t('hubs.accessControl.enableConfirm')
                : t('hubs.accessControl.disableConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAccessConfirm(null)}
              disabled={togglingAccess}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant={showAccessConfirm === 'disable' ? 'destructive' : 'default'}
              onClick={handleAccessToggleConfirm}
              disabled={togglingAccess}
              data-testid="hub-access-confirm-btn"
            >
              {togglingAccess ? t('common.loading') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const EXPORT_CATEGORIES: { key: HubExportCategory; labelKey: string }[] = [
  { key: 'notes', labelKey: 'hub.export.categories.notes' },
  { key: 'calls', labelKey: 'hub.export.categories.calls' },
  { key: 'conversations', labelKey: 'hub.export.categories.conversations' },
  { key: 'audit', labelKey: 'hub.export.categories.audit' },
  { key: 'voicemails', labelKey: 'hub.export.categories.voicemails' },
  { key: 'attachments', labelKey: 'hub.export.categories.attachments' },
]

function DeleteHubDialog({
  open,
  onOpenChange,
  hub,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hub: Hub | null
  onDeleted: (hubId: string) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [confirmName, setConfirmName] = useState('')
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState<Set<HubExportCategory>>(
    new Set(EXPORT_CATEGORIES.map((c) => c.key))
  )

  if (!hub) return null

  const canDelete = confirmName === hub.name

  function toggleCategory(category: HubExportCategory) {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  async function handleExport() {
    if (!hub || selectedCategories.size === 0) return
    setExporting(true)
    try {
      const blob = await exportHubData(hub.id, [...selectedCategories])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hub-${hub.id}-export.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleConfirm() {
    if (!hub || !canDelete) return
    setSaving(true)
    try {
      await deleteHub(hub.id)
      onDeleted(hub.id)
      onOpenChange(false)
      toast(t('hubs.hubDeleted'), 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('active calls')) {
        toast(t('hubs.deleteHubActiveCallsError'), 'error')
      } else {
        toast(t('common.error'), 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    onOpenChange(false)
    setConfirmName('')
    setSelectedCategories(new Set(EXPORT_CATEGORIES.map((c) => c.key)))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose()
        else onOpenChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('hubs.deleteHub')}</DialogTitle>
          <DialogDescription>{t('hubs.deleteHubConfirm', { name: hub.name })}</DialogDescription>
        </DialogHeader>

        {/* Export section */}
        <div className="space-y-3 rounded-lg border p-4" data-testid="hub-export-section">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            <Label className="text-sm font-semibold">{t('hub.export.title')}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t('hub.export.description')}</p>
          <div className="space-y-2">
            <p className="text-xs font-medium">{t('hub.export.selectCategories')}</p>
            {EXPORT_CATEGORIES.map(({ key, labelKey }) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`export-${key}`}
                  checked={selectedCategories.has(key)}
                  onCheckedChange={() => toggleCategory(key)}
                  disabled={exporting}
                  data-testid={`export-category-${key}`}
                />
                <Label htmlFor={`export-${key}`} className="text-sm">
                  {t(labelKey)}
                </Label>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || selectedCategories.size === 0}
            data-testid="hub-export-download-btn"
          >
            <Download className="mr-1 h-3 w-3" />
            {exporting ? t('hub.export.downloading') : t('hub.export.download')}
          </Button>
        </div>

        {/* Confirm deletion */}
        <div className="space-y-2">
          <Label htmlFor="delete-hub-confirm">{t('hubs.deleteHubNameLabel')}</Label>
          <Input
            id="delete-hub-confirm"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={hub.name}
            data-testid="delete-hub-confirm-input"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={saving || !canDelete}
            data-testid="delete-hub-confirm-btn"
          >
            {saving ? t('common.loading') : t('hubs.deleteHub')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveHubDialog({
  open,
  onOpenChange,
  hub,
  onArchived,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hub: Hub | null
  onArchived: (hubId: string) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  if (!hub) return null

  async function handleConfirm() {
    if (!hub) return
    setSaving(true)
    try {
      await archiveHub(hub.id)
      onArchived(hub.id)
      onOpenChange(false)
      toast(t('hubs.hubArchived'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('hubs.archiveHub')}</DialogTitle>
          <DialogDescription>{t('hubs.archiveHubConfirm', { name: hub.name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={saving}>
            {saving ? t('common.loading') : t('hubs.archiveHub')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
