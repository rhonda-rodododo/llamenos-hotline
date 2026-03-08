import { z } from 'zod'
import { paginationSchema } from './common'

export const callHistoryQuerySchema = paginationSchema.extend({
  search: z.string().max(100).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
})
