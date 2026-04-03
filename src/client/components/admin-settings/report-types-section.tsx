import { SettingsSection } from '@/components/settings-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  type CustomFieldDefinition,
  archiveReportType,
  createReportType,
  setDefaultReportType,
  unarchiveReportType,
  updateReportType,
} from '@/lib/api'
import { useConfig } from '@/lib/config'
import { encryptHubField } from '@/lib/hub-field-crypto'
import { queryKeys } from '@/lib/queries/keys'
import { queryClient } from '@/lib/query-client'
import { useToast } from '@/lib/toast'
import type { ReportType } from '@shared/types'
import { Archive, ArchiveRestore, Plus, Save, Star, Tags } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  reportTypes: ReportType[]
  customFields: CustomFieldDefinition[]
  onChange: (types: ReportType[]) => void
  expanded: boolean
  onToggle: (open: boolean) => void
  statusSummary?: string
}

interface EditingState {
  id?: string
  name: string
  description: string
  isDefault: boolean
}

export function ReportTypesSection({
  reportTypes,
  customFields,
  onChange,
  expanded,
  onToggle,
  statusSummary,
}: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [saving, setSaving] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const activeTypes = reportTypes.filter((rt) => !rt.archivedAt)
  const archivedTypes = reportTypes.filter((rt) => !!rt.archivedAt)

  function getFieldCount(reportTypeId: string): number {
    return customFields.filter(
      (f) =>
        (f.context === 'reports' || f.context === 'all') &&
        (f.reportTypeIds === undefined ||
          f.reportTypeIds.length === 0 ||
          f.reportTypeIds.includes(reportTypeId))
    ).length
  }

  async function handleSave() {
    if (!editing?.name?.trim()) return
    setSaving(true)
    try {
      if (editing.id) {
        // Update existing
        const trimmedName = editing.name.trim()
        const trimmedDesc = editing.description.trim()
        const { reportType: updated } = await updateReportType(editing.id, {
          name: trimmedName,
          description: trimmedDesc || undefined,
          encryptedName: encryptHubField(trimmedName, hubId),
          encryptedDescription: trimmedDesc ? encryptHubField(trimmedDesc, hubId) : undefined,
        })
        onChange(reportTypes.map((rt) => (rt.id === editing.id ? updated : rt)))
        // Handle isDefault separately if changed
        const existing = reportTypes.find((rt) => rt.id === editing.id)
        if (editing.isDefault && !existing?.isDefault) {
          const { reportType: withDefault } = await setDefaultReportType(editing.id)
          onChange(
            reportTypes.map((rt) => {
              if (rt.id === editing.id) return withDefault
              return { ...rt, isDefault: false }
            })
          )
        }
      } else {
        // Create new
        const trimmedName = editing.name.trim()
        const trimmedDesc = editing.description.trim()
        const { reportType: created } = await createReportType({
          name: trimmedName,
          description: trimmedDesc || undefined,
          isDefault: editing.isDefault,
          encryptedName: encryptHubField(trimmedName, hubId),
          encryptedDescription: trimmedDesc ? encryptHubField(trimmedDesc, hubId) : undefined,
        })
        const newList = editing.isDefault
          ? [...reportTypes.map((rt) => ({ ...rt, isDefault: false })), created]
          : [...reportTypes, created]
        onChange(newList)
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.reportTypes() })
      setEditing(null)
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive(id: string) {
    if (
      !confirm(
        t('settings.reportTypes.archiveConfirm', { defaultValue: 'Archive this report type?' })
      )
    )
      return
    try {
      await archiveReportType(id)
      onChange(
        reportTypes.map((rt) =>
          rt.id === id ? { ...rt, archivedAt: new Date().toISOString(), isDefault: false } : rt
        )
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.reportTypes() })
      toast(t('settings.reportTypes.archived'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  async function handleUnarchive(id: string) {
    try {
      const { reportType: updated } = await unarchiveReportType(id)
      onChange(reportTypes.map((rt) => (rt.id === id ? updated : rt)))
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.reportTypes() })
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const { reportType: updated } = await setDefaultReportType(id)
      onChange(
        reportTypes.map((rt) => {
          if (rt.id === id)
            return {
              ...rt,
              ...updated,
              name: rt.name || updated.name,
              description: rt.description || updated.description,
            }
          return { ...rt, isDefault: false }
        })
      )
      toast(t('common.success'), 'success')
    } catch {
      toast(t('common.error'), 'error')
    }
  }

  function renderType(rt: ReportType, archived = false) {
    const fieldCount = getFieldCount(rt.id)
    return (
      <div
        key={rt.id}
        data-testid="report-type-row"
        className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${archived ? 'border-border opacity-60' : 'border-border'}`}
      >
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{rt.name}</p>
            {rt.isDefault && (
              <Badge variant="secondary" className="text-[10px]" data-testid="default-badge">
                <Star className="mr-0.5 h-2.5 w-2.5" />
                {t('settings.reportTypes.default')}
              </Badge>
            )}
            {archived && (
              <Badge variant="outline" className="text-[10px]">
                {t('settings.reportTypes.archived')}
              </Badge>
            )}
          </div>
          {rt.encryptedDescription && (
            <p className="text-xs text-muted-foreground">{rt.description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {t('settings.reportTypes.fields')}: {fieldCount}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {!archived && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setEditing({
                    id: rt.id,
                    name: rt.name || '',
                    description: rt.description || '',
                    isDefault: rt.isDefault,
                  })
                }
              >
                {t('common.edit')}
              </Button>
              {!rt.isDefault && (
                <Button
                  data-testid="set-default-btn"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSetDefault(rt.id)}
                  title={t('settings.reportTypes.setDefault')}
                >
                  <Star className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                data-testid="archive-report-type-btn"
                variant="ghost"
                size="sm"
                onClick={() => handleArchive(rt.id)}
                title={t('settings.reportTypes.archive')}
              >
                <Archive className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </>
          )}
          {archived && (
            <Button
              data-testid="unarchive-report-type-btn"
              variant="ghost"
              size="sm"
              onClick={() => handleUnarchive(rt.id)}
              title={t('settings.reportTypes.unarchive')}
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <SettingsSection
      id="report-types"
      title={t('settings.reportTypes.title')}
      description={t('settings.reportTypes.description', {
        defaultValue: 'Configure report categories and bind custom fields to each type.',
      })}
      icon={<Tags className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded}
      onToggle={onToggle}
      basePath="/admin/settings"
      statusSummary={statusSummary}
    >
      {activeTypes.length === 0 && !editing ? (
        <p className="text-sm text-muted-foreground">{t('settings.reportTypes.empty')}</p>
      ) : (
        <div className="space-y-2">{activeTypes.map((rt) => renderType(rt))}</div>
      )}

      {/* Archived types toggle */}
      {archivedTypes.length > 0 && (
        <div className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived
              ? t('settings.reportTypes.hideArchived', { defaultValue: 'Hide archived' })
              : `${t('settings.reportTypes.showArchived', { defaultValue: 'Show archived' })} (${archivedTypes.length})`}
          </Button>
          {showArchived && (
            <div className="mt-2 space-y-2">{archivedTypes.map((rt) => renderType(rt, true))}</div>
          )}
        </div>
      )}

      {/* Create/Edit form */}
      {editing ? (
        <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h4 className="text-sm font-medium">
            {editing.id ? t('common.edit') : t('settings.reportTypes.new')}
          </h4>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rt-name">{t('settings.reportTypes.name')}</Label>
              <Input
                id="rt-name"
                data-testid="report-type-name-input"
                value={editing.name}
                onChange={(e) =>
                  setEditing((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                }
                placeholder={t('settings.reportTypes.namePlaceholder', {
                  defaultValue: 'e.g. Crisis Report',
                })}
                maxLength={128}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rt-description">{t('settings.reportTypes.description')}</Label>
              <Textarea
                id="rt-description"
                data-testid="report-type-description-input"
                value={editing.description}
                onChange={(e) =>
                  setEditing((prev) => (prev ? { ...prev, description: e.target.value } : prev))
                }
                placeholder={t('settings.reportTypes.descriptionPlaceholder', {
                  defaultValue: 'Brief description of when to use this type',
                })}
                rows={2}
                className="resize-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                data-testid="report-type-default-switch"
                checked={editing.isDefault}
                onCheckedChange={(checked) =>
                  setEditing((prev) => (prev ? { ...prev, isDefault: checked } : prev))
                }
              />
              <Label className="text-sm">{t('settings.reportTypes.setDefault')}</Label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              data-testid="report-type-save-btn"
              disabled={saving || !editing.name.trim()}
              onClick={handleSave}
            >
              <Save className="h-4 w-4" />
              {saving ? t('common.loading') : t('common.save')}
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          data-testid="add-report-type-btn"
          variant="outline"
          onClick={() =>
            setEditing({ name: '', description: '', isDefault: activeTypes.length === 0 })
          }
        >
          <Plus className="h-4 w-4" />
          {t('settings.reportTypes.new')}
        </Button>
      )}
    </SettingsSection>
  )
}
