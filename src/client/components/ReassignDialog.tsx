import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Conversation } from '@/lib/api'
import { useUpdateConversation } from '@/lib/queries/conversations'
import { useVolunteers } from '@/lib/queries/volunteers'
import { useToast } from '@/lib/toast'
import { useDecryptedArray } from '@/lib/use-decrypted'
import { AlertCircle, Loader2, User, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ReassignDialogProps {
  conversation: Conversation
  open: boolean
  onOpenChange: (open: boolean) => void
  onReassigned?: () => void
}

export function ReassignDialog({
  conversation,
  open,
  onOpenChange,
  onReassigned,
}: ReassignDialogProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null)

  const volunteersQuery = useVolunteers()
  const rawVolunteers = volunteersQuery.data ?? []
  const loading = volunteersQuery.isLoading

  const updateConversation = useUpdateConversation()
  const reassigning = updateConversation.isPending

  // useVolunteers already decrypts PII fields, but use useDecryptedArray as
  // a pass-through to satisfy TypeScript — the data is already decrypted
  const decryptedVolunteers = useDecryptedArray(rawVolunteers)

  // Filter to eligible volunteers: active, messaging enabled, not the current assignee
  const eligibleVolunteers = decryptedVolunteers.filter(
    (v) => v.active && v.messagingEnabled !== false && v.pubkey !== conversation.assignedTo
  )

  // Check if volunteer can handle this channel
  const canHandleChannel = (vol: (typeof eligibleVolunteers)[number]) => {
    if (!vol.supportedMessagingChannels || vol.supportedMessagingChannels.length === 0) {
      return true // Empty array means all channels
    }
    return vol.supportedMessagingChannels.includes(conversation.channelType as string)
  }

  // Sort volunteers: capable first, then alphabetically
  const sortedVolunteers = [...eligibleVolunteers].sort((a, b) => {
    const aCanHandle = canHandleChannel(a)
    const bCanHandle = canHandleChannel(b)
    if (aCanHandle && !bCanHandle) return -1
    if (!aCanHandle && bCanHandle) return 1
    return a.name.localeCompare(b.name)
  })

  const handleReassign = async () => {
    if (!selectedPubkey) return
    try {
      await updateConversation.mutateAsync({
        conversationId: conversation.id,
        data: { assignedTo: selectedPubkey },
      })
      toast(t('conversations.reassigned', { defaultValue: 'Conversation reassigned' }))
      onOpenChange(false)
      onReassigned?.()
    } catch {
      toast(
        t('conversations.reassignError', { defaultValue: 'Failed to reassign conversation' }),
        'error'
      )
    }
  }

  const handleUnassign = async () => {
    try {
      await updateConversation.mutateAsync({
        conversationId: conversation.id,
        data: { status: 'waiting' },
      })
      toast(t('conversations.unassigned', { defaultValue: 'Conversation unassigned' }))
      onOpenChange(false)
      onReassigned?.()
    } catch {
      toast(
        t('conversations.unassignError', { defaultValue: 'Failed to unassign conversation' }),
        'error'
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('conversations.reassignTitle', { defaultValue: 'Reassign Conversation' })}
          </DialogTitle>
          <DialogDescription>
            {t('conversations.reassignDescription', {
              defaultValue: 'Select a volunteer to handle this conversation.',
            })}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : eligibleVolunteers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {t('conversations.noVolunteersAvailable', {
                defaultValue: 'No volunteers available',
              })}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-64">
            <div className="space-y-2 pr-4">
              {sortedVolunteers.map((vol) => {
                const capable = canHandleChannel(vol)
                const isSelected = selectedPubkey === vol.pubkey

                return (
                  <button
                    key={vol.pubkey}
                    type="button"
                    onClick={() => setSelectedPubkey(vol.pubkey)}
                    disabled={!capable}
                    className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : capable
                          ? 'border-border hover:bg-muted/50'
                          : 'border-border bg-muted/30 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {vol.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{vol.name}</span>
                        {vol.onBreak && (
                          <Badge
                            variant="outline"
                            className="text-xs border-yellow-500/50 text-yellow-600"
                          >
                            {t('dashboard.onBreak', { defaultValue: 'On break' })}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        {!capable && (
                          <span className="text-amber-600">
                            {t('conversations.channelNotSupported', {
                              defaultValue: 'Channel not supported',
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {conversation.status === 'active' && (
            <Button
              variant="outline"
              onClick={() => void handleUnassign()}
              disabled={reassigning}
              className="text-amber-600 border-amber-500/50 hover:bg-amber-50 dark:hover:bg-amber-950/20"
            >
              {t('conversations.unassign', { defaultValue: 'Return to queue' })}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={reassigning}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={() => void handleReassign()} disabled={!selectedPubkey || reassigning}>
            {reassigning && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {t('conversations.reassign', { defaultValue: 'Reassign' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
