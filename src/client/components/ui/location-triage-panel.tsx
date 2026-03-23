import { Button } from '@/components/ui/button'
import type { LocationFieldValue } from '@shared/types'
import { MapPin } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface LocationTriagePanelProps {
  text: string
  onPopulate: (value: LocationFieldValue) => void
}

/**
 * Extracts location hints from text using common address/intersection patterns.
 * Returns the first match found.
 */
function extractLocationHint(text: string): string | null {
  if (!text || text.length < 5) return null

  // Match patterns like "123 Main St", "500 E Broadway Ave", etc.
  const streetAddress = text.match(
    /\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Cir|Pkwy|Hwy)\b\.?/i
  )
  if (streetAddress) return streetAddress[0]

  // Match intersections like "Main St and Broadway", "5th & Pine"
  const intersection = text.match(
    /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\s+(?:St|Ave|Blvd|Dr|Rd)\s*(?:and|&|at|\/)\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\s*(?:St|Ave|Blvd|Dr|Rd)?\b/i
  )
  if (intersection) return intersection[0]

  return null
}

/**
 * Displays a pre-populate button when a location hint is found in text.
 * Used alongside LocationField in conversation and note views.
 */
export function LocationTriagePanel({ text, onPopulate }: LocationTriagePanelProps) {
  const { t } = useTranslation()
  const hint = useMemo(() => extractLocationHint(text), [text])

  if (!hint) return null

  function handlePopulate() {
    if (!hint) return
    onPopulate({
      address: hint,
      source: 'manual',
    })
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-3 py-2">
      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-xs text-muted-foreground">{hint}</span>
      <Button type="button" variant="outline" size="sm" onClick={handlePopulate}>
        {t('locationField.useAsLocation', { defaultValue: 'Use as location' })}
      </Button>
    </div>
  )
}
