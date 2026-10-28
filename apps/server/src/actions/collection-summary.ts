import { AppError } from '../errors'
import { summarizeDocs, type Filter } from '../query'
import { registerCollectionAction } from '../actions'

// #330: GET /api/table/:table:summary?filters=…&group_by=<column>&sums=["a","b"]
// → { count, sums, groups } over every matching row, permission-scoped like
// the list, so the summary view's totals are never limited to the page of
// rows it shows.
function jsonArg<T>(raw: unknown, name: string): T | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new AppError('BadRequestError', `${name} must be valid JSON`)
  }
}

registerCollectionAction('summary', {
  effect: 'read',
  description: 'Scoped count and column sums, overall and per group, over list filters.',
  handler: async ({ table, args, user }) => {
    const filters = jsonArg<Filter[]>(args.filters, 'filters') ?? []
    const sums = jsonArg<unknown>(args.sums, 'sums') ?? []
    if (!Array.isArray(sums) || !sums.every((s) => typeof s === 'string'))
      throw new AppError('BadRequestError', 'sums must be a JSON list of column names')
    const groupBy = typeof args.group_by === 'string' && args.group_by ? args.group_by : undefined
    return summarizeDocs(table, filters, groupBy, sums, user.row_id)
  },
})
