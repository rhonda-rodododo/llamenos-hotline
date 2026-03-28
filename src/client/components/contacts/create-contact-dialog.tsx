import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function CreateContactDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('contacts.createTitle')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Coming in Task 9...</p>
      </DialogContent>
    </Dialog>
  )
}
