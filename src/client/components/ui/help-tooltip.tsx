import { useTranslation } from 'react-i18next'
import { HelpCircle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface HelpTooltipProps {
  helpKey: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}

export function HelpTooltip({ helpKey, side = 'top', className }: HelpTooltipProps) {
  const { t } = useTranslation()
  const text = t(`help.${helpKey}`)

  // Don't render if the key isn't translated (returns the key path itself)
  if (text === `help.${helpKey}`) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn('inline-flex shrink-0 text-muted-foreground hover:text-foreground transition-colors', className)}
          aria-label={text}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
