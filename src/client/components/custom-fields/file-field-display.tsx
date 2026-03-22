import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { getSecretKey } from '@/lib/key-manager'
import { downloadAndDecryptFile, triggerBrowserDownload } from '@/lib/file-upload'
import { getFileMetadata } from '@/lib/api'
import { decryptFileMetadata } from '@/lib/file-crypto'
import type { CustomFieldDefinition, EncryptedFileMetadata, FileFieldValue } from '@shared/types'
import { Download, File as FileIcon, Image as ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  definition: CustomFieldDefinition
  value: FileFieldValue
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Read-only display component for a file custom field value.
 * Fetches and decrypts metadata on mount to show filename/size.
 * Provides download button and image preview for image/* MIME types.
 */
export function FileFieldDisplay({ definition: _definition, value }: Props) {
  const { t } = useTranslation()
  const { publicKey } = useAuth()
  const [metadata, setMetadata] = useState<EncryptedFileMetadata | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)

  // Fetch and decrypt metadata on mount to show filename/size
  useEffect(() => {
    if (!publicKey) return

    let cancelled = false
    ;(async () => {
      try {
        const secretKey = getSecretKey()
        const metaResponse = await getFileMetadata(value.fileId)
        const myMeta = metaResponse.metadata.find((m) => m.pubkey === publicKey)
        if (!myMeta) {
          if (!cancelled) setUnavailable(true)
          return
        }
        const decrypted = decryptFileMetadata(
          myMeta.encryptedContent,
          myMeta.ephemeralPubkey,
          secretKey
        )
        if (!decrypted) {
          if (!cancelled) setUnavailable(true)
          return
        }
        if (!cancelled) setMetadata(decrypted)
      } catch {
        if (!cancelled) setUnavailable(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [value.fileId, publicKey])

  // Fetch image preview when metadata indicates an image
  useEffect(() => {
    if (!metadata?.mimeType.startsWith('image/') || !publicKey) return

    let objectUrl: string | null = null
    let cancelled = false

    ;(async () => {
      try {
        const secretKey = getSecretKey()
        const { blob } = await downloadAndDecryptFile(value.fileId, publicKey, secretKey)
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) setImagePreviewUrl(objectUrl)
      } catch {
        // Image preview is best-effort — don't mark the field unavailable
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [metadata?.mimeType, value.fileId, publicKey])

  async function handleDownload() {
    if (!publicKey || !metadata) return
    setDownloading(true)
    try {
      const secretKey = getSecretKey()
      const { blob } = await downloadAndDecryptFile(value.fileId, publicKey, secretKey)
      triggerBrowserDownload(blob, metadata.originalName)
    } catch {
      // Download errors are surfaced via the button state — no further action needed
    } finally {
      setDownloading(false)
    }
  }

  if (unavailable) {
    return (
      <span className="text-xs text-muted-foreground italic">{t('customFields.file.unavailable')}</span>
    )
  }

  if (!metadata) {
    return (
      <span className="text-xs text-muted-foreground animate-pulse">
        {t('customFields.file.uploading')}
      </span>
    )
  }

  return (
    <div className="space-y-2">
      {imagePreviewUrl && (
        <img
          src={imagePreviewUrl}
          alt={metadata.originalName}
          className="max-h-40 max-w-full rounded-md border border-border object-contain"
        />
      )}
      <div
        data-testid="file-field-display"
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
      >
        {metadata.mimeType.startsWith('image/') ? (
          <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm">{metadata.originalName}</p>
          <p className="text-xs text-muted-foreground">{formatFileSize(metadata.size)}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownload}
          disabled={downloading}
          aria-label={t('customFields.file.download')}
          data-testid="file-field-download-btn"
        >
          <Download className="h-4 w-4" />
          {t('customFields.file.download')}
        </Button>
      </div>
    </div>
  )
}
