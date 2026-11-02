// #772 part 2: copy a warehouse table into an ordinary Featherbase table, and
// copy it again later. Every copy feeds the rows through the import engine as
// one import (one run id), so a person's correction is kept and a changed
// source value raises an import conflict, and the copy can be undone like any
// import. A row gone from the source is marked "deleted at source".
// First, approximate version: built to be tried end to end before hardening.
import { randomUUID } from 'node:crypto'
import { AppError } from '../errors'
import { getCollectionAction } from '../actions'
import { sql } from '../db'
import { getMeta } from '../meta'
import { createTable, tableRelation } from '../table-engine'
import type { SessionUser } from '../auth'
import { getSource } from './registry'
import { mapDuckType, quoteIdentifier, run } from './duckdb-driver'

/** Each import call takes at most this many rows (collection-import.ts MAX_ROWS). */
const PART = 10_000

export const DELETED_AT_SOURCE = 'deleted_at_source'

export interface CopyColumn { source: string; column_name: string; label?: string; description?: string }
export interface CopyResult {
  run_id: string; inserted: number; updated: number; failed: number; conflicts: number
  deleted_at_source: number; back_at_source: number; first_errors: string[]
}

const relation = (database: string, schema: string, table: string) =>
  [database, schema, table].map(quoteIdentifier).join('.')

/** How many rows, how many distinct values and how many empty ones a column has. */
export async function checkKey(sourceName: string, database: string, schema: string, table: string, column: string) {
  const cfg = await getSource(sourceName)
  const [r] = await run(cfg,
    `select count(*) as n, count(distinct ${quoteIdentifier(column)}) as d, count(*) filter (where ${quoteIdentifier(column)} is null) as e
     from ${relation(database, schema, table)}`, [])
  const rows = Number(r.n), distinct = Number(r.d), empty = Number(r.e)
  return { rows, distinct, empty, usable: rows > 0 && distinct === rows && empty === 0 }
}

/** Creates the Featherbase table and runs the first copy. */
export async function createCopy(
  user: SessionUser,
  input: { source: string; database: string; schema: string; table: string; name: string; key: string; columns: CopyColumn[] },
): Promise<{ table: string; result: CopyResult }> {
  const cfg = await getSource(input.source)
  const keyColumn = input.columns.find((c) => c.source === input.key)
  if (!keyColumn) throw new AppError('ValidationError', 'The key column must be one of the columns copied', { key: 'Keep the key column' })
  const check = await checkKey(input.source, input.database, input.schema, input.table, input.key)
  if (!check.usable)
    throw new AppError('ValidationError', `${input.key} cannot match rows: ${check.rows - check.distinct} rows repeat a value and ${check.empty} are empty`, { key: 'Pick a column whose every value is different' })
  const types = await run(cfg,
    `select column_name, data_type from duckdb_columns() where database_name = ? and schema_name = ? and table_name = ?`,
    [input.database, input.schema, input.table])
  const typeOf = new Map(types.map((t) => [String(t.column_name), mapDuckType(String(t.data_type))]))
  await createTable({
    name: input.name,
    id_pattern: 'prompt',
    description: `Copied from ${input.source} · ${input.database}.${input.schema}.${input.table}`,
    columns: [
      ...input.columns.map((c) => ({
        column_name: c.column_name,
        label: c.label || c.column_name,
        // Codes keep every digit: a warehouse text column stays text.
        column_type: typeOf.get(c.source) === 'Text' ? 'Long Text' : (typeOf.get(c.source) ?? 'Data'),
        description: c.description || undefined,
        source_column: c.source,
        unique: c.source === input.key || undefined,
      })),
      { column_name: DELETED_AT_SOURCE, label: 'Deleted at source', column_type: 'Check', read_only: true,
        description: 'Set when the row is no longer in the source table; cleared if it comes back' },
    ],
  })
  await sql`insert into featherbase.table_copy (target_table, data_source, database, source_schema, source_table, key_column)
            values (${input.name}, ${input.source}, ${input.database}, ${input.schema}, ${input.table}, ${keyColumn.column_name})`
  return { table: input.name, result: await copyAgain(user, input.name) }
}

export async function copyInfo(target: string) {
  const [copy] = await sql`select * from featherbase.table_copy where target_table = ${target}`
  return copy ?? null
}

/** Reads the source again and imports it as one run. */
export async function copyAgain(user: SessionUser, target: string): Promise<CopyResult> {
  const copy = await copyInfo(target)
  if (!copy) throw new AppError('NotFoundError', `${target} was not copied from a data source`)
  const cfg = await getSource(String(copy.data_source))
  const meta = await getMeta(target)
  const columns = meta.columns.filter((c) => c.source_column)
  const key = columns.find((c) => c.column_name === copy.key_column)
  if (!key?.source_column) throw new AppError('ValidationError', `The key column ${copy.key_column} of ${target} is missing`)
  const select = columns.map((c) => `${quoteIdentifier(c.source_column!)} as ${quoteIdentifier(c.column_name)}`).join(', ')
  const sourceRows = await run(cfg, `select ${select} from ${relation(String(copy.database), String(copy.source_schema), String(copy.source_table))}`, [])
  const rows = sourceRows.map((r) => ({ ...r, row_id: String(r[key.column_name]), [DELETED_AT_SOURCE]: false }))

  const runId = `copy-${randomUUID()}`
  const importer = getCollectionAction('import')!
  const result: CopyResult = { run_id: runId, inserted: 0, updated: 0, failed: 0, conflicts: 0, deleted_at_source: 0, back_at_source: 0, first_errors: [] }
  const relationName = await tableRelation(target)
  const [before] = await sql`select count(*)::int as n from ${sql(relationName)} where ${sql(DELETED_AT_SOURCE)} is true`
  for (let i = 0; i < rows.length; i += PART) {
    const part = await importer.handler({
      table: target,
      user,
      args: {
        rows: rows.slice(i, i + PART),
        key_column: 'row_id',
        // A cell the source has emptied is emptied here too (a correction still wins).
        empty_cells: 'clear',
        columns: [...columns.map((c) => c.column_name), DELETED_AT_SOURCE],
        context: { run_id: runId, file_name: `${copy.data_source} · ${copy.database}.${copy.source_schema}.${copy.source_table}`, part: i / PART + 1, parts: Math.ceil(rows.length / PART) },
      },
    }) as { inserted?: number; updated?: number; failed?: { index: number; message: string }[] }
    result.inserted += part.inserted ?? 0
    result.updated += part.updated ?? 0
    result.failed += part.failed?.length ?? 0
    for (const f of part.failed ?? []) if (result.first_errors.length < 5) result.first_errors.push(`${rows[i + f.index]?.row_id}: ${f.message}`)
  }
  // A row the source no longer has is marked, never dropped or left looking current.
  const keys = rows.map((r) => r.row_id)
  const gone = await sql`update ${sql(relationName)} set ${sql(DELETED_AT_SOURCE)} = true
                         where ${sql(DELETED_AT_SOURCE)} is not true and not (row_id = any(${keys}))`
  result.deleted_at_source = gone.count
  const [after] = await sql`select count(*)::int as n from ${sql(relationName)} where ${sql(DELETED_AT_SOURCE)} is true`
  result.back_at_source = Math.max(0, Number(before.n) + result.deleted_at_source - Number(after.n))
  const [conflicts] = await sql`select count(*)::int as n from featherbase.import_conflict where ref_table = ${target} and run_id = ${runId} and closed is not true`
  result.conflicts = Number(conflicts.n)
  await sql`update featherbase.table_copy set last_copied_at = now(), last_run_id = ${runId} where target_table = ${target}`
  return result
}
