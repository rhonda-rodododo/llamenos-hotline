import { FileFieldDisplay } from '@/components/custom-fields/file-field-display'
import { Badge } from '@/components/ui/badge'
import type { CustomFieldDefinition, FileFieldValue } from '@shared/types'

interface Props {
  fields: CustomFieldDefinition[]
  values: Record<string, string | string[] | number | boolean | FileFieldValue>
}

/**
 * Read-only badge display for custom field values.
 * Used in note cards, report details, and conversation notes.
 * File fields render as a FileFieldDisplay with download button.
 */
export function CustomFieldBadges({ fields, values }: Props) {
  const items = fields
    .map((field) => {
      const val = values[field.id]
      if (val === undefined || val === '') return null

      // File fields render as a separate component (not a simple badge)
      if (field.type === 'file') {
        const fileVal = val as FileFieldValue
        if (!fileVal?.fileId) return null
        return (
          <div key={field.id} className="w-full">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{field.label}</p>
            <FileFieldDisplay definition={field} value={fileVal} />
          </div>
        )
      }

      const displayVal =
        field.type === 'checkbox'
          ? val
            ? '\u2713'
            : '\u2717'
          : Array.isArray(val)
            ? val.join(', ')
            : String(val)
      return (
        <Badge key={field.id} variant="outline" className="text-xs">
          {field.label}: {displayVal}
        </Badge>
      )
    })
    .filter(Boolean)

  if (items.length === 0) return null

  return <div className="mt-2 flex flex-wrap gap-2">{items}</div>
}
