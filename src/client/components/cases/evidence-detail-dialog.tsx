import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/lib/toast'
import {
  getEvidenceCustody,
  logEvidenceAccess,
  verifyEvidenceIntegrity,
  type EvidenceMetadata,
  type EvidenceClassification,
  type CustodyEntry,
  type CustodyAction,
} from '@/lib/api'
import { formatTimestamp } from '@/lib/format'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Image,
  Video,
  FileText,
  AudioLines,
  File,
  Download,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Eye,
  Upload as UploadIcon,
  Share2,
  FileOutput,
  CheckCircle,
} from 'lucide-react'

// --- Classification config (repeated here for self-containment) ---

const CLASSIFICATION_CONFIG: Record<EvidenceClassification, {
  icon: React.ComponentType<{ className?: string }>
  label: string
  color: string
}> = {
  photo: { icon: Image, label: 'Photo', color: '#3b82f6' },
  video: { icon: Video, label: 'Video', color: '#8b5cf6' },
  document: { icon: FileText, label: 'Document', color: '#f59e0b' },
  audio: { icon: AudioLines, label: 'Audio', color: '#22c55e' },
  other: { icon: File, label: 'Other', color: '#6b7280' },
}

const CUSTODY_ACTION_LABELS: Record<CustodyAction, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  uploaded: { label: 'Uploaded', icon: UploadIcon },
  viewed: { label: 'Viewed', icon: Eye },
  downloaded: { label: 'Downloaded', icon: Download },
  shared: { label: 'Shared', icon: Share2 },
  exported: { label: 'Exported', icon: FileOutput },
  integrity_verified: { label: 'Integrity Verified', icon: CheckCircle },
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export interface EvidenceDetailDialogProps {
  evidence: EvidenceMetadata | null
  open: boolean
  onOpenChange: (open: boolean) => void
  volunteerNames: Record<string, string>
}

export function EvidenceDetailDialog({
  evidence,
  open,
  onOpenChange,
  volunteerNames,
}: EvidenceDetailDialogProps) {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [custodyChain, setCustodyChain] = useState<CustodyEntry[]>([])
  const [custodyLoading, setCustodyLoading] = useState(false)
  const [integrityResult, setIntegrityResult] = useState<{
    valid: boolean
    originalHash: string
    currentHash: string
  } | null>(null)
  const [verifying, setVerifying] = useState(false)

  // Load custody chain when dialog opens
  useEffect(() => {
    if (!evidence || !open) {
      setCustodyChain([])
      setIntegrityResult(null)
      return
    }

    setCustodyLoading(true)
    getEvidenceCustody(evidence.id)
      .then(result => setCustodyChain(result.custodyChain))
      .catch(() => toast(t('cases.evidence.custodyError', { defaultValue: 'Failed to load custody chain' }), 'error'))
      .finally(() => setCustodyLoading(false))

    // Log "viewed" access event
    logEvidenceAccess(evidence.id, {
      action: 'viewed',
      integrityHash: evidence.integrityHash,
    }).catch(() => { /* non-critical */ })
  }, [evidence, open, t, toast])

  // --- Download handler ---
  const handleDownload = useCallback(async () => {
    if (!evidence) return
    // Log download access event
    try {
      await logEvidenceAccess(evidence.id, {
        action: 'downloaded',
        integrityHash: evidence.integrityHash,
        notes: 'Downloaded from evidence detail dialog',
      })
      toast(t('cases.evidence.downloadStarted', { defaultValue: 'Download initiated' }))
    } catch {
      toast(t('cases.evidence.downloadError', { defaultValue: 'Failed to start download' }), 'error')
    }
  }, [evidence, t, toast])

  // --- Verify integrity ---
  const handleVerifyIntegrity = useCallback(async () => {
    if (!evidence) return
    setVerifying(true)
    try {
      const result = await verifyEvidenceIntegrity(evidence.id, evidence.integrityHash)
      setIntegrityResult(result)
      if (result.valid) {
        toast(t('cases.evidence.integrityValid', { defaultValue: 'Integrity verified — file is unmodified' }))
      } else {
        toast(t('cases.evidence.integrityInvalid', { defaultValue: 'Integrity check failed — file may be modified' }), 'error')
      }
    } catch {
      toast(t('cases.evidence.integrityError', { defaultValue: 'Failed to verify integrity' }), 'error')
    } finally {
      setVerifying(false)
    }
  }, [evidence, t, toast])

  if (!evidence) return null

  const classConfig = CLASSIFICATION_CONFIG[evidence.classification]
  const ClassIcon = classConfig.icon

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="evidence-detail-dialog" className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span style={{ color: classConfig.color }}>
              <ClassIcon className="h-5 w-5" />
            </span>
            {evidence.filename}
          </DialogTitle>
          <DialogDescription>
            {t('cases.evidence.detailDescription', { defaultValue: 'Evidence details and chain of custody' })}
          </DialogDescription>
        </DialogHeader>

        {/* File preview area */}
        <div data-testid="evidence-preview" className="flex items-center justify-center rounded-lg bg-muted py-8">
          {evidence.classification === 'photo' && evidence.mimeType.startsWith('image/') ? (
            <div className="flex flex-col items-center gap-2">
              <Image className="h-16 w-16 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">
                {t('cases.evidence.previewEncrypted', { defaultValue: 'Encrypted file — decrypt to preview' })}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <ClassIcon className="h-16 w-16 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">{classConfig.label}</p>
            </div>
          )}
        </div>

        {/* Metadata table */}
        <div data-testid="evidence-metadata" className="space-y-2">
          <h3 className="text-sm font-semibold">
            {t('cases.evidence.metadata', { defaultValue: 'Metadata' })}
          </h3>
          <div className="rounded-lg border border-border divide-y divide-border text-sm">
            <MetadataRow
              label={t('cases.evidence.filename', { defaultValue: 'Filename' })}
              value={evidence.filename}
            />
            <MetadataRow
              label={t('cases.evidence.type', { defaultValue: 'Type' })}
              value={evidence.mimeType}
            />
            <MetadataRow
              label={t('cases.evidence.size', { defaultValue: 'Size' })}
              value={formatFileSize(evidence.sizeBytes)}
            />
            <MetadataRow
              label={t('cases.evidence.classification', { defaultValue: 'Classification' })}
            >
              <Badge
                variant="outline"
                className="gap-1"
                style={{ borderColor: classConfig.color, color: classConfig.color }}
              >
                <ClassIcon className="h-3 w-3" />
                {classConfig.label}
              </Badge>
            </MetadataRow>
            <MetadataRow
              label={t('cases.evidence.integrityHash', { defaultValue: 'Integrity Hash (SHA-256)' })}
              value={evidence.integrityHash}
              mono
            />
            <MetadataRow
              label={t('cases.evidence.uploadedBy', { defaultValue: 'Uploaded By' })}
              value={
                volunteerNames[evidence.uploadedBy]
                ?? evidence.uploadedBy.slice(0, 16) + '...'
              }
            />
            <MetadataRow
              label={t('cases.evidence.uploadedAt', { defaultValue: 'Upload Date' })}
              value={formatTimestamp(evidence.uploadedAt)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            data-testid="evidence-download-btn"
            onClick={handleDownload}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            {t('cases.evidence.download', { defaultValue: 'Download' })}
          </Button>

          <Button
            size="sm"
            variant="outline"
            data-testid="evidence-verify-btn"
            onClick={handleVerifyIntegrity}
            disabled={verifying}
            className="gap-1.5"
          >
            {verifying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : integrityResult?.valid ? (
              <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
            ) : integrityResult && !integrityResult.valid ? (
              <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
            ) : (
              <Shield className="h-3.5 w-3.5" />
            )}
            {t('cases.evidence.verifyIntegrity', { defaultValue: 'Verify Integrity' })}
          </Button>
        </div>

        {/* Chain of Custody */}
        <div data-testid="evidence-custody-chain" className="space-y-2">
          <h3 className="text-sm font-semibold">
            {t('cases.evidence.custodyChain', { defaultValue: 'Chain of Custody' })}
          </h3>

          {custodyLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : custodyChain.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t('cases.evidence.noCustody', { defaultValue: 'No custody entries recorded' })}
            </p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t('cases.evidence.action', { defaultValue: 'Action' })}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t('cases.evidence.actor', { defaultValue: 'Actor' })}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t('cases.evidence.timestamp', { defaultValue: 'Timestamp' })}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {custodyChain.map(entry => {
                    const actionConfig = CUSTODY_ACTION_LABELS[entry.action]
                    const ActionIcon = actionConfig.icon
                    return (
                      <tr key={entry.id} data-testid="custody-chain-row">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <ActionIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{actionConfig.label}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {volunteerNames[entry.actorPubkey]
                            ?? entry.actorPubkey.slice(0, 12) + '...'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatTimestamp(entry.timestamp)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --- Helper: metadata row ---

function MetadataRow({
  label,
  value,
  mono,
  children,
}: {
  label: string
  value?: string
  mono?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-4 px-3 py-2">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      {children ?? (
        <span
          className={`flex-1 break-all ${mono ? 'font-mono text-xs' : ''}`}
          title={value}
        >
          {value}
        </span>
      )}
    </div>
  )
}
