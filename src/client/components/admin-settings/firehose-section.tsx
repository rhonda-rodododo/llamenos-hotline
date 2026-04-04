import { SettingsSection } from '@/components/settings-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useConfig } from '@/lib/config'
import { encryptHubField } from '@/lib/hub-field-crypto'
import {
  useCreateFirehoseConnection,
  useDeleteFirehoseConnection,
  useFirehoseConnections,
  useFirehoseStatus,
  useUpdateFirehoseConnection,
} from '@/lib/queries/firehose'
import { useReportTypes } from '@/lib/queries/reports'
import { useToast } from '@/lib/toast'
import type {
  CreateFirehoseConnectionInput,
  FirehoseConnection,
  FirehoseConnectionStatus,
  UpdateFirehoseConnectionInput,
} from '@shared/schemas/firehose'
import { Loader2, Pause, Play, Plus, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<FirehoseConnectionStatus, string> = {
  pending: 'border-yellow-400 text-yellow-700 dark:text-yellow-400',
  active: 'border-green-500 text-green-700 dark:text-green-400',
  paused: 'border-orange-400 text-orange-700 dark:text-orange-400',
  disabled: 'border-border text-muted-foreground',
}

function StatusBadge({ status }: { status: FirehoseConnectionStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASSES[status]}>
      {status}
    </Badge>
  )
}

// ── Create dialog state ───────────────────────────────────────────────────────

interface CreateForm {
  displayName: string
  reportTypeId: string
  geoContext: string
  geoContextCountryCodes: string
  extractionIntervalSec: number
}

const DEFAULT_CREATE: CreateForm = {
  displayName: '',
  reportTypeId: '',
  geoContext: '',
  geoContextCountryCodes: '',
  extractionIntervalSec: 60,
}

// ── Edit dialog state ─────────────────────────────────────────────────────────

interface EditForm {
  id: string
  geoContext: string
  geoContextCountryCodes: string
  extractionIntervalSec: number
  systemPromptSuffix: string
  bufferTtlDays: number
  inferenceEndpoint: string
  notifyViaSignal: boolean
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  expanded: boolean
  onToggle: (open: boolean) => void
  statusSummary?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FirehoseSection({ expanded, onToggle, statusSummary }: Props) {
  const { toast } = useToast()
  const { currentHubId } = useConfig()
  const hubId = currentHubId ?? 'global'

  const { data: connections = [], isLoading: connectionsLoading } = useFirehoseConnections(hubId)
  const { data: healthList = [] } = useFirehoseStatus()
  const { data: reportTypes = [] } = useReportTypes(hubId)

  const createMutation = useCreateFirehoseConnection()
  const updateMutation = useUpdateFirehoseConnection()
  const deleteMutation = useDeleteFirehoseConnection()

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(DEFAULT_CREATE)

  const [editTarget, setEditTarget] = useState<EditForm | null>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────

  function healthFor(id: string) {
    return healthList.find((h) => h.id === id)
  }

  function reportTypeName(id: string) {
    return reportTypes.find((rt) => rt.id === id)?.name ?? id
  }

  function parseCountryCodes(raw: string): string[] {
    return raw
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c.length === 2)
  }

  // ── Create ───────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!createForm.displayName.trim() || !createForm.reportTypeId) return

    const input: CreateFirehoseConnectionInput = {
      displayName: createForm.displayName.trim(),
      encryptedDisplayName: encryptHubField(createForm.displayName.trim(), hubId) ?? undefined,
      reportTypeId: createForm.reportTypeId,
      extractionIntervalSec: createForm.extractionIntervalSec,
    }
    if (createForm.geoContext.trim()) input.geoContext = createForm.geoContext.trim()
    const codes = parseCountryCodes(createForm.geoContextCountryCodes)
    if (codes.length > 0) input.geoContextCountryCodes = codes

    try {
      await createMutation.mutateAsync(input)
      toast('Firehose connection created', 'success')
      setShowCreate(false)
      setCreateForm(DEFAULT_CREATE)
    } catch {
      toast('Failed to create connection', 'error')
    }
  }

  // ── Edit ─────────────────────────────────────────────────────────────────

  function openEdit(conn: FirehoseConnection) {
    setEditTarget({
      id: conn.id,
      geoContext: conn.geoContext ?? '',
      geoContextCountryCodes: (conn.geoContextCountryCodes ?? []).join(', '),
      extractionIntervalSec: conn.extractionIntervalSec,
      systemPromptSuffix: conn.systemPromptSuffix ?? '',
      bufferTtlDays: conn.bufferTtlDays,
      inferenceEndpoint: conn.inferenceEndpoint ?? '',
      notifyViaSignal: conn.notifyViaSignal,
    })
  }

  async function handleEdit() {
    if (!editTarget) return

    const input: UpdateFirehoseConnectionInput = {
      extractionIntervalSec: editTarget.extractionIntervalSec,
      bufferTtlDays: editTarget.bufferTtlDays,
      notifyViaSignal: editTarget.notifyViaSignal,
      geoContext: editTarget.geoContext.trim() || null,
      systemPromptSuffix: editTarget.systemPromptSuffix.trim() || null,
      inferenceEndpoint: editTarget.inferenceEndpoint.trim() || null,
    }
    const codes = parseCountryCodes(editTarget.geoContextCountryCodes)
    input.geoContextCountryCodes = codes.length > 0 ? codes : null

    try {
      await updateMutation.mutateAsync({ id: editTarget.id, data: input })
      toast('Connection updated', 'success')
      setEditTarget(null)
    } catch {
      toast('Failed to update connection', 'error')
    }
  }

  // ── Pause / Resume ───────────────────────────────────────────────────────

  async function handleTogglePause(conn: FirehoseConnection) {
    const newStatus = conn.status === 'paused' ? 'active' : 'paused'
    try {
      await updateMutation.mutateAsync({ id: conn.id, data: { status: newStatus } })
      toast(newStatus === 'paused' ? 'Connection paused' : 'Connection resumed', 'success')
    } catch {
      toast('Failed to update status', 'error')
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete firehose connection "${name}"? This cannot be undone.`)) return
    try {
      await deleteMutation.mutateAsync(id)
      toast('Connection deleted', 'success')
    } catch {
      toast('Failed to delete connection', 'error')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const activeCount = connections.filter((c) => c.status === 'active').length

  return (
    <SettingsSection
      id="firehose"
      title="Firehose Connections"
      description="Connect Signal group channels as live intake feeds. Incoming messages are extracted and routed as reports."
      icon={<Settings2 className="h-5 w-5 text-muted-foreground" />}
      expanded={expanded}
      onToggle={onToggle}
      basePath="/admin/settings"
      statusSummary={statusSummary}
    >
      {/* Connection list */}
      {connectionsLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading connections…
        </div>
      ) : connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No firehose connections configured.</p>
      ) : (
        <div className="space-y-2">
          {connections.map((conn) => {
            const health = healthFor(conn.id)
            const isPaused = conn.status === 'paused'
            const isUpdating =
              updateMutation.isPending &&
              (updateMutation.variables as { id: string } | undefined)?.id === conn.id
            const isDeleting =
              deleteMutation.isPending &&
              (deleteMutation.variables as string | undefined) === conn.id

            return (
              <div
                key={conn.id}
                data-testid={`firehose-connection-${conn.id}`}
                className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{conn.displayName || '(unnamed)'}</p>
                    <StatusBadge status={conn.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>Type: {reportTypeName(conn.reportTypeId)}</span>
                    {conn.geoContext && <span>Geo: {conn.geoContext}</span>}
                    {conn.signalGroupId && <span>Signal group: {conn.signalGroupId}</span>}
                    {health && (
                      <>
                        <span>Buffer: {health.bufferSize} msgs</span>
                        <span>Extractions: {health.extractionCount}</span>
                      </>
                    )}
                    <span>Interval: {conn.extractionIntervalSec}s</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTogglePause(conn)}
                    disabled={conn.status === 'disabled' || isUpdating}
                    title={isPaused ? 'Resume' : 'Pause'}
                  >
                    {isUpdating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isPaused ? (
                      <Play className="h-3.5 w-3.5" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(conn)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(conn.id, conn.displayName)}
                    disabled={isDeleting}
                    title="Delete"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Status summary line */}
      {!connectionsLoading && connections.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {activeCount} active of {connections.length} total
        </p>
      )}

      {/* Add new button */}
      <Button variant="outline" onClick={() => setShowCreate(true)}>
        <Plus className="h-4 w-4" />
        New connection
      </Button>

      {/* ── Create dialog ── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Firehose Connection</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="fh-display-name">Display name</Label>
              <Input
                id="fh-display-name"
                data-testid="firehose-display-name"
                value={createForm.displayName}
                onChange={(e) => setCreateForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="e.g. Latin America Feed"
                maxLength={128}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="fh-report-type">Report type</Label>
              <Select
                value={createForm.reportTypeId}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, reportTypeId: v }))}
              >
                <SelectTrigger id="fh-report-type" data-testid="firehose-report-type">
                  <SelectValue placeholder="Select a report type" />
                </SelectTrigger>
                <SelectContent>
                  {reportTypes
                    .filter((rt) => !rt.archivedAt)
                    .map((rt) => (
                      <SelectItem key={rt.id} value={rt.id}>
                        {rt.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="fh-geo-context">Geographic context</Label>
              <Input
                id="fh-geo-context"
                data-testid="firehose-geo-context"
                value={createForm.geoContext}
                onChange={(e) => setCreateForm((f) => ({ ...f, geoContext: e.target.value }))}
                placeholder="e.g. Colombia, Bogotá region"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="fh-country-codes">
                Country codes (comma-separated, ISO 3166-1 alpha-2)
              </Label>
              <Input
                id="fh-country-codes"
                value={createForm.geoContextCountryCodes}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, geoContextCountryCodes: e.target.value }))
                }
                placeholder="CO, VE, EC"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="fh-interval">
                Extraction interval: {createForm.extractionIntervalSec}s
              </Label>
              <Input
                id="fh-interval"
                type="number"
                min={30}
                max={300}
                step={10}
                value={createForm.extractionIntervalSec}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    extractionIntervalSec: Math.min(300, Math.max(30, Number(e.target.value))),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">30–300 seconds</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                data-testid="firehose-create-submit"
                disabled={
                  !createForm.displayName.trim() ||
                  !createForm.reportTypeId ||
                  createMutation.isPending
                }
                onClick={handleCreate}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  'Create connection'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Firehose Connection</DialogTitle>
          </DialogHeader>

          {editTarget && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="fh-edit-geo-context">Geographic context</Label>
                <Input
                  id="fh-edit-geo-context"
                  value={editTarget.geoContext}
                  onChange={(e) => setEditTarget((f) => f && { ...f, geoContext: e.target.value })}
                  placeholder="e.g. Colombia, Bogotá region"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-country-codes">Country codes</Label>
                <Input
                  id="fh-edit-country-codes"
                  value={editTarget.geoContextCountryCodes}
                  onChange={(e) =>
                    setEditTarget((f) => f && { ...f, geoContextCountryCodes: e.target.value })
                  }
                  placeholder="CO, VE"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-interval">
                  Extraction interval: {editTarget.extractionIntervalSec}s
                </Label>
                <Input
                  id="fh-edit-interval"
                  type="number"
                  min={30}
                  max={300}
                  step={10}
                  value={editTarget.extractionIntervalSec}
                  onChange={(e) =>
                    setEditTarget(
                      (f) =>
                        f && {
                          ...f,
                          extractionIntervalSec: Math.min(
                            300,
                            Math.max(30, Number(e.target.value))
                          ),
                        }
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-system-prompt">System prompt suffix</Label>
                <Textarea
                  id="fh-edit-system-prompt"
                  rows={3}
                  className="resize-none"
                  value={editTarget.systemPromptSuffix}
                  onChange={(e) =>
                    setEditTarget((f) => f && { ...f, systemPromptSuffix: e.target.value })
                  }
                  placeholder="Additional instructions appended to the extraction prompt"
                  maxLength={2000}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-buffer-ttl">Buffer TTL (days)</Label>
                <Input
                  id="fh-edit-buffer-ttl"
                  type="number"
                  min={1}
                  max={30}
                  value={editTarget.bufferTtlDays}
                  onChange={(e) =>
                    setEditTarget(
                      (f) =>
                        f && {
                          ...f,
                          bufferTtlDays: Math.min(30, Math.max(1, Number(e.target.value))),
                        }
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="fh-edit-inference">Inference endpoint override</Label>
                <Input
                  id="fh-edit-inference"
                  value={editTarget.inferenceEndpoint}
                  onChange={(e) =>
                    setEditTarget((f) => f && { ...f, inferenceEndpoint: e.target.value })
                  }
                  placeholder="https://vllm.internal/v1 (leave blank for default)"
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="fh-edit-signal"
                  checked={editTarget.notifyViaSignal}
                  onCheckedChange={(checked) =>
                    setEditTarget((f) => f && { ...f, notifyViaSignal: checked })
                  }
                />
                <Label htmlFor="fh-edit-signal" className="text-sm">
                  Send Signal DM notifications on new extractions
                </Label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditTarget(null)}>
                  Cancel
                </Button>
                <Button disabled={updateMutation.isPending} onClick={handleEdit}>
                  {updateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save changes'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
