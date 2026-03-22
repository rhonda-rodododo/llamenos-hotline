import { PhoneInput } from '@/components/phone-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { type Hub, archiveHub, createHub, listHubs, updateHub } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { createFileRoute } from '@tanstack/react-router'
import { Archive, Building2, Pencil, Phone, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/admin/hubs')({
  component: HubsPage,
})

function HubsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const { toast } = useToast()
  const [hubs, setHubs] = useState<Hub[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingHub, setEditingHub] = useState<Hub | null>(null)
  const [archivingHub, setArchivingHub] = useState<Hub | null>(null)

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
                  onEdit={() => setEditingHub(hub)}
                  onArchive={() => setArchivingHub(hub)}
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
    </div>
  )
}

function HubRow({
  hub,
  onEdit,
  onArchive,
}: { hub: Hub; onEdit: () => void; onArchive: () => void }) {
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
            {hub.name}
            <span className="ml-2 font-mono text-xs text-muted-foreground">/{hub.slug}</span>
          </p>
          {hub.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{hub.description}</p>
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
  onUpdated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hub: Hub
  onUpdated: (hub: Hub) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [name, setName] = useState(hub.name)
  const [description, setDescription] = useState(hub.description || '')
  const [phoneNumber, setPhoneNumber] = useState(hub.phoneNumber || '')
  const [saving, setSaving] = useState(false)

  // Reset form state when hub changes
  useEffect(() => {
    setName(hub.name)
    setDescription(hub.description || '')
    setPhoneNumber(hub.phoneNumber || '')
  }, [hub])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const res = await updateHub(hub.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
      })
      onUpdated(res.hub)
      toast(t('hubs.hubUpdated'), 'success')
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
              <span className="font-mono text-xs text-muted-foreground">/{hub.slug}</span>
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
