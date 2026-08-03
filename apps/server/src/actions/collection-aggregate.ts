import { AppError } from '../errors'
import { aggregateDocs, type Filter } from '../query'
import { registerCollectionAction } from '../actions'

// NAV-002: GET /api/table/:table:aggregate?filters=…&sum=<column>
// → { count, sum } over the SAME permission-scoped filter language the
// list accepts (including 'related' relationship filters), so a pane
// footer shows the true totals, not a sum over the rows it fetched.
registerCollectionAction('aggregate', {
  effect: 'read',
  description: 'Scoped count (and optional column sum) over list filters.',
  handler: async ({ table, args, user }) => {
    let filters: Filter[] = []
    const raw = args.filters
    if (typeof raw === 'string' && raw) {
      try {
        filters = JSON.parse(raw) as Filter[]
      } catch {
        throw new AppError('BadRequestError', 'filters must be valid JSON')
      }
    }
    const sumField = typeof args.sum === 'string' && args.sum ? args.sum : undefined
    return aggregateDocs(table, filters, sumField, user.name)
  },
})
