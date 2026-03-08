/**
 * Desktop auto-update checker & dialog (Epic 289).
 *
 * Uses the updater module for scheduling and the Tauri updater plugin.
 * Shows a non-intrusive banner when an update is available, with an
 * option to open a full dialog with release notes, progress bar, and
 * "Skip This Version" support.
 *
 * Silent failures — never blocks the app with update errors.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, RefreshCw, ArrowRight, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  startUpdateScheduler,
  downloadAndInstall,
  relaunchApp,
  skipVersion,
  type UpdateInfo,
  type UpdateScheduler,
  type UpdateStatus,
} from '@/lib/updater'
import type { Update } from '@tauri-apps/plugin-updater'

export function UpdateChecker() {
  const { t } = useTranslation()
  const [state, setState] = useState<UpdateStatus>({ status: 'idle' })
  const [dialogOpen, setDialogOpen] = useState(false)
  const updateRef = useRef<Update | null>(null)
  const schedulerRef = useRef<UpdateScheduler | null>(null)

  // Handle update found
  const onUpdateAvailable = useCallback((info: UpdateInfo, update: Update) => {
    updateRef.current = update
    setState({ status: 'available', info })
  }, [])

  // Start scheduler on mount
  useEffect(() => {
    const scheduler = startUpdateScheduler(
      onUpdateAvailable,
      // Silent error handler — never show update errors to user
      () => {},
    )
    schedulerRef.current = scheduler

    return () => scheduler.stop()
  }, [onUpdateAvailable])

  // Download handler
  const handleDownload = useCallback(async () => {
    const update = updateRef.current
    if (!update) return

    try {
      setState({ status: 'downloading', progress: 0, total: 0 })

      await downloadAndInstall(update, (downloaded, total) => {
        setState({ status: 'downloading', progress: downloaded, total })
      })

      setState({ status: 'ready' })
    } catch {
      // Download failed — revert to available with error
      if (state.status === 'available' || state.status === 'downloading') {
        const info = state.status === 'available'
          ? state.info
          : {
              version: update.version,
              notes: update.body ?? '',
              date: update.date ?? null,
              currentVersion: __BUILD_VERSION__,
            }
        setState({ status: 'available', info })
      }
    }
  }, [state])

  // Restart handler
  const handleRelaunch = useCallback(async () => {
    try {
      await relaunchApp()
    } catch {
      // Relaunch failed — user can restart manually
    }
  }, [])

  // Dismiss banner (keep update available for dialog)
  const dismiss = useCallback(() => {
    setState({ status: 'dismissed' })
    setDialogOpen(false)
  }, [])

  // Skip this version
  const handleSkip = useCallback(async () => {
    if (state.status === 'available') {
      await skipVersion(state.info.version)
    }
    setState({ status: 'dismissed' })
    setDialogOpen(false)
    updateRef.current = null
  }, [state])

  // Open the detail dialog
  const openDialog = useCallback(() => {
    setDialogOpen(true)
  }, [])

  // Format bytes for display
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  const progressPercent =
    state.status === 'downloading' && state.total > 0
      ? Math.round((state.progress / state.total) * 100)
      : 0

  // Don't render anything if idle or dismissed
  if (state.status === 'idle' || state.status === 'checking' || state.status === 'dismissed' || state.status === 'error') {
    return null
  }

  return (
    <>
      {/* Top banner */}
      <div className="border-b border-border bg-primary/5 px-4 py-2" data-testid="update-banner">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-4">
          {state.status === 'available' && (
            <>
              <p className="text-sm text-foreground">
                <span className="font-medium">
                  {t('updates.available', { version: state.info.version })}
                </span>
                {state.info.notes && (
                  <span className="ml-2 text-muted-foreground">
                    — {state.info.notes.length > 80 ? state.info.notes.slice(0, 80) + '...' : state.info.notes}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={openDialog}
                  className="text-xs"
                  data-testid="update-details-btn"
                >
                  {t('updates.details')}
                </Button>
                <Button
                  size="sm"
                  onClick={handleDownload}
                  data-testid="update-download-btn"
                  className="text-xs"
                >
                  <Download className="mr-1 h-3 w-3" />
                  {t('updates.updateNow')}
                </Button>
                <button
                  onClick={dismiss}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                  aria-label={t('updates.later')}
                  data-testid="update-dismiss-btn"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}

          {state.status === 'downloading' && (
            <div className="flex flex-1 items-center gap-3">
              <p className="shrink-0 text-sm text-foreground">
                {t('updates.downloading')}
              </p>
              <Progress value={progressPercent} className="flex-1" />
              <span className="shrink-0 text-xs text-muted-foreground">
                {state.total > 0
                  ? `${formatBytes(state.progress)} / ${formatBytes(state.total)}`
                  : `${progressPercent}%`}
              </span>
            </div>
          )}

          {state.status === 'ready' && (
            <>
              <p className="text-sm text-foreground">
                {t('updates.ready')}
              </p>
              <Button size="sm" onClick={handleRelaunch} data-testid="update-restart-btn" className="text-xs">
                <RefreshCw className="mr-1 h-3 w-3" />
                {t('updates.restart')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="update-dialog">
          <DialogHeader>
            <DialogTitle>{t('updates.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {state.status === 'available' && (
                <>
                  {t('updates.versionChange', {
                    current: state.info.currentVersion,
                    new: state.info.version,
                  })}
                </>
              )}
              {state.status === 'downloading' && t('updates.downloading')}
              {state.status === 'ready' && t('updates.ready')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Version comparison */}
            {state.status === 'available' && (
              <>
                <div className="flex items-center justify-center gap-3 rounded-md bg-muted/50 py-3">
                  <span className="font-mono text-sm text-muted-foreground">
                    v{state.info.currentVersion}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-sm font-semibold text-primary">
                    v{state.info.version}
                  </span>
                </div>

                {/* Release notes */}
                {state.info.notes && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">{t('updates.releaseNotes')}</h4>
                    <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                      {state.info.notes}
                    </div>
                  </div>
                )}

                {state.info.date && (
                  <p className="text-xs text-muted-foreground">
                    {t('updates.publishedOn', {
                      date: new Date(state.info.date).toLocaleDateString(),
                    })}
                  </p>
                )}
              </>
            )}

            {/* Download progress */}
            {state.status === 'downloading' && (
              <div className="space-y-2">
                <Progress value={progressPercent} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatBytes(state.progress)}</span>
                  <span>
                    {state.total > 0 ? formatBytes(state.total) : t('updates.downloading')}
                  </span>
                </div>
              </div>
            )}

            {/* Ready to install */}
            {state.status === 'ready' && (
              <p className="text-center text-sm text-muted-foreground">
                {t('updates.readyDescription')}
              </p>
            )}
          </div>

          <DialogFooter>
            {state.status === 'available' && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  data-testid="update-skip-btn"
                >
                  {t('updates.skipVersion')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogOpen(false)}
                >
                  {t('updates.later')}
                </Button>
                <Button size="sm" onClick={() => { setDialogOpen(false); handleDownload() }} data-testid="update-install-btn">
                  <Download className="mr-1 h-3.5 w-3.5" />
                  {t('updates.updateNow')}
                </Button>
              </>
            )}

            {state.status === 'ready' && (
              <Button size="sm" onClick={handleRelaunch} data-testid="update-relaunch-btn">
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {t('updates.restart')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
