import { AppError } from '../errors'
import { type Filter } from '../query'
import { narrowCounts, parseNarrowLists } from '../narrow-counts'
import { registerCollectionAction } from '../actions'

// #1289 option C: GET /api/table/:table:narrow?filters=…&lists=[{ path, pick? }]
// → { lists: [{ values: [{ value, count }] }] }, the Click To Narrow panel's
// counts for every list at once, scoped to what the viewer may read.
function jsonArg(raw: unknown, name: string): unknown {
  if (typeof raw !== 'string' || !raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new AppError('BadRequestError', `${name} must be valid JSON`)
  }
}

registerCollectionAction('narrow', {
  effect: 'read',
  description: 'Click To Narrow: per list, how many rows reach each value, under the other lists\' picks.',
  handler: async ({ table, args, user }) => {
    const filters = (jsonArg(args.filters, 'filters') ?? []) as Filter[]
    const lists = parseNarrowLists(jsonArg(args.lists, 'lists') ?? [])
    return narrowCounts(table, filters, lists, user.row_id, { withRetired: args.with_retired === 'true' })
  },
})
