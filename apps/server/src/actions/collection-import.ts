import { AppError } from '../errors'
import { checkRowForInsert, saveDoc } from '../document'
import { getMeta } from '../meta'
import { assertPermission } from '../permissions'
import { registerCollectionAction } from '../actions'

// IMP-005: bulk import — POST /api/table/:table:import { rows: [...] }.
// The first real collection-action registrant (#61 left the registry empty on
// purpose). Every row goes through saveDoc's full lifecycle — permissions,
// validation, id patterns, automation triggers — in insert mode, so an
// existing name conflicts instead of silently updating. Best-effort: bad rows
// are reported by index, good rows still land.
const MAX_ROWS = 10_000
// ADR 0008: failures kept in the Import Log's error summary (Q3 owns 'more').
const LOG_ERROR_SAMPLE = 20

interface FailedRow {
  index: number
  message: string
  fields?: Record<string, string>
}

registerCollectionAction('import', {
  effect: 'write',
  description:
    'Bulk-insert rows ({ rows: [...] }); returns { inserted, failed }. ' +
    'With dry_run: true, validates every row and writes nothing.',
  handler: async ({ table, args, user }) => {
    const rows = args.rows
    if (!Array.isArray(rows) || rows.length === 0)
      throw new AppError('ValidationError', 'Expected { rows: [...] } with at least one row')
    if (rows.length > MAX_ROWS)
      throw new AppError('ValidationError', `Import is capped at ${MAX_ROWS} rows per request`)

    const meta = await getMeta(table)
    if (meta.kind !== 'table')
      throw new AppError('ValidationError', `Cannot import into a ${meta.kind} Table`)
    // EDS: bulk import is not supported on source-bound Tables yet. The dry
    // run already refused (checkRowForInsert); the real import must agree
    // rather than fan 10k row-by-row writes at a foreign store.
    if (meta.data_source)
      throw new AppError(
        'ValidationError',
        `${table} is bound to data source ${meta.data_source}; bulk import is not supported on bound Tables yet`,
      )

    // IMP-007: dry run — same create gate, schema-level validation of every
    // row (types, reqd, choices, name rules, existing-name conflicts), zero
    // writes. Automation triggers don't run, so a trigger can still reject
    // individual rows at real import time.
    if (args.dry_run) {
      await assertPermission(user.name, table, 'create')
      const failed: FailedRow[] = []
      const seenNames = new Set<string>()
      for (const [index, row] of rows.entries()) {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) {
          failed.push({ index, message: 'row must be an object' })
          continue
        }
        try {
          const name = String((row as Record<string, unknown>).name ?? '').trim()
          if (name && seenNames.has(name))
            throw new AppError('ConflictError', `Duplicate name ${name} within the import`)
          await checkRowForInsert(meta, row as Record<string, unknown>)
          if (name) seenNames.add(name)
        } catch (err) {
          failed.push({
            index,
            message: err instanceof Error ? err.message : String(err),
            ...(err instanceof AppError && err.fields ? { fields: err.fields } : {}),
          })
        }
      }
      return { dry_run: true, valid: rows.length - failed.length, failed }
    }

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
    await writeImportLog(table, user.name, inserted, failed, args.context)
    return { inserted, failed }
  },
})

// IMP-011: one Import Log row per :import request, whatever the caller —
// the wizard passes file/sheet/chunk context, a plain API import logs bare
// counts. skipPermissions: the log is system-written; the importer needs no
// grant on Import Log itself. Best-effort — a logging failure (e.g. a
// database mid-upgrade without 0056) never breaks the import that happened.
async function writeImportLog(
  table: string,
  user: string,
  inserted: number,
  failed: FailedRow[],
  context: unknown,
): Promise<void> {
  const ctx = (typeof context === 'object' && context !== null ? context : {}) as Record<
    string,
    unknown
  >
  const str = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 140) : undefined)
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
  await saveDoc(
    'Import Log',
    {
      ref_table: table,
      inserted,
      failed: failed.length,
      error_summary: failed.length
        ? failed
            .slice(0, LOG_ERROR_SAMPLE)
            .map((f) => `#${f.index}: ${f.message}`)
            .join('\n') + (failed.length > 20 ? `\n… and ${failed.length - 20} more` : '')
        : undefined,
      file_name: str(ctx.file_name),
      sheet_name: str(ctx.sheet_name),
      table_created: ctx.table_created === true,
      part: int(ctx.part),
      parts: int(ctx.parts),
    },
    user,
    'insert',
    { skipPermissions: true },
  ).catch(() => {})
}
