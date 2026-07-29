import { AppError } from '../errors'
import { saveDoc } from '../document'
import { getMeta } from '../meta'
import { registerCollectionAction } from '../actions'

// IMP-005: bulk import — POST /api/table/:table:import { rows: [...] }.
// The first real collection-action registrant (#61 left the registry empty on
// purpose). Every row goes through saveDoc's full lifecycle — permissions,
// validation, id patterns, automation triggers — in insert mode, so an
// existing name conflicts instead of silently updating. Best-effort: bad rows
// are reported by index, good rows still land.
const MAX_ROWS = 10_000

interface FailedRow {
  index: number
  message: string
  fields?: Record<string, string>
}

registerCollectionAction('import', {
  effect: 'write',
  description: 'Bulk-insert rows ({ rows: [...] }); returns { inserted, failed }.',
  handler: async ({ table, args, user }) => {
    const rows = args.rows
    if (!Array.isArray(rows) || rows.length === 0)
      throw new AppError('ValidationError', 'Expected { rows: [...] } with at least one row')
    if (rows.length > MAX_ROWS)
      throw new AppError('ValidationError', `Import is capped at ${MAX_ROWS} rows per request`)

    const meta = await getMeta(table)
    if (meta.kind !== 'table')
      throw new AppError('ValidationError', `Cannot import into a ${meta.kind} Table`)

    let inserted = 0
    const failed: FailedRow[] = []
    for (const [index, row] of rows.entries()) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        failed.push({ index, message: 'row must be an object' })
        continue
      }
      try {
        await saveDoc(table, row as Record<string, unknown>, user.name, 'insert')
        inserted++
      } catch (err) {
        if (err instanceof AppError && err.type === 'PermissionError') throw err
        failed.push({
          index,
          message: err instanceof Error ? err.message : String(err),
          ...(err instanceof AppError && err.fields ? { fields: err.fields } : {}),
        })
      }
    }
    return { inserted, failed }
  },
})
