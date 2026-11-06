// #772 part 2: copy a warehouse table into an ordinary Featherbase table, and
// copy it again later. Every copy feeds the rows through the import engine as
// one import (one run id), so a person's correction is kept and a changed
// source value raises an import conflict, and the copy can be undone like any
// import. A row gone from the source is marked "deleted at source".
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '../errors'
import { importRows, writeImportLog } from '../actions/collection-import'
import { actionTransaction } from '../action-transaction'
import { appOperation, assertStillServing, servingIdentity } from '../app-lifecycle'
import { sql } from '../db'
import { getMeta, type TableMeta } from '../meta'
import { createTable, tableRelation } from '../table-engine'
import type { SessionUser } from '../auth'
import { assertAllowed, getSource } from './registry'
import { mapDuckType, quoteIdentifier, run, stream } from './duckdb-driver'
import type { SourceConfig } from './types'

/** Each import call takes at most this many rows (collection-import.ts MAX_ROWS). */
const PART = 10_000

export const DELETED_AT_SOURCE = 'deleted_at_source'

export interface CopyColumn { source: string; column_name: string; label?: string; description?: string }
export interface CopyResult {
  run_id: string; inserted: number; updated: number; failed: number; conflicts: number
  changed: number; unchanged: number
  deleted_at_source: number; back_at_source: number; first_errors: string[]
}

const relation = (database: string, schema: string, table: string) =>
  [database, schema, table].map(quoteIdentifier).join('.')

/** Source I/O precedes all app mutations, including first-time Table creation. */
async function withSourceRows<T>(cfg: SourceConfig, query: string, key: string, apply: (folder: string, parts: number) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), 'fb-copy-'))
  try {
    let parts = 0
    for await (const chunk of stream(cfg, query)) {
      for (let i = 0; i < chunk.length; i += PART) {
        const rows = chunk.slice(i, i + PART).map(r => ({ ...r, row_id: String(r[key] ?? '').trim(), [DELETED_AT_SOURCE]: false }))
        await writeFile(join(folder, String(++parts)), JSON.stringify(rows))
      }
    }
    return await apply(folder, parts)
  } finally { await rm(folder, { recursive: true, force: true }) }
}

const READ_STATUS = new Set(['conn_status', 'last_checked_at', 'last_error', 'updated_at', 'updated_by'])

/** #971: a Data Source's settings as they stand, without the status every read
 *  updates. A deploy may change them while a copy reads, so the apply compares. */
async function sourceSettings(name: string): Promise<string | undefined> {
  const [row] = await sql`select * from data_source where row_id = ${name}`
  return JSON.stringify(row, (key, value) => READ_STATUS.has(key) ? undefined : value)
}

async function assertSourceUnchanged(name: string, settings: string | undefined): Promise<void> {
  if (await sourceSettings(name) !== settings)
    throw new AppError('ConflictError', `Data source ${name} changed while the source was read; try the copy again`)
}

/** How many rows, how many distinct values and how many empty ones a column has. */
export async function checkKey(sourceName: string, database: string, schema: string, table: string, column: string) {
  const cfg = await getSource(sourceName)
  assertAllowed(cfg, `${database}.${schema}`, table)
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
  const settings = await sourceSettings(input.source)
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
  const rawTypeOf = new Map(types.map((t) => [String(t.column_name), String(t.data_type).toUpperCase()]))
  // Codes keep every digit: a warehouse string stays a string. Only the key is
  // bounded (it becomes the row id); any other VARCHAR is unbounded text, so a
  // long note never fails the whole copy against Data's 140 characters.
  const nativeType = (source: string) => {
    // Every chosen column exists: the source read above already refused any other.
    const mapped = typeOf.get(source)!
    const raw = String(rawTypeOf.get(source))
    if (mapped === 'Text') return 'Long Text'
    // Native numbers travel as JavaScript doubles: a DECIMAL wider than 15
    // digits, or an integer type wider than BIGINT, would be silently rounded.
    // Copy those as text so every digit survives.
    const decimal = /^DECIMAL\((\d+),\s*\d+\)$/.exec(raw)
    if ((decimal && Number(decimal[1]) > 15) || raw === 'HUGEINT' || raw === 'UHUGEINT' || raw === 'UBIGINT')
      return source === input.key ? 'Data' : 'Text'
    if (source !== input.key && raw === 'VARCHAR') return 'Text'
    return mapped
  }
  const select = input.columns.map(c => `${quoteIdentifier(c.source)} as ${quoteIdentifier(c.column_name)}`).join(', ')
  return withSourceRows(cfg, `select ${select} from ${relation(input.database, input.schema, input.table)}`, keyColumn.column_name, (folder, parts) => appOperation(() => actionTransaction(async () => {
    await assertSourceUnchanged(input.source, settings)
    await createTable({
      name: input.name,
      id_pattern: 'prompt',
      description: `Copied from ${input.source} · ${input.database}.${input.schema}.${input.table}`,
      columns: [
        ...input.columns.map((c) => ({
          column_name: c.column_name,
          label: c.label || c.column_name,
          column_type: nativeType(c.source),
          description: c.description || undefined,
          source_column: c.source,
          unique: c.source === input.key || undefined,
        })),
        { column_name: DELETED_AT_SOURCE, label: 'Deleted at source', column_type: 'Check', read_only: true, default_value: '0',
          description: 'Set when the row is no longer in the source table; cleared if it comes back' },
      ],
    })
    await sql`insert into featherbase.table_copy (target_table, data_source, database, source_schema, source_table, key_column)
              values (${input.name}, ${input.source}, ${input.database}, ${input.schema}, ${input.table}, ${keyColumn.column_name})`
    const result = await applyCopy(user, input.name, (await copyInfo(input.name))!, await getMeta(input.name), folder, parts)
    return { table: input.name, result }
  })))
}

export async function copyInfo(target: string) {
  const [copy] = await sql`select * from featherbase.table_copy where target_table = ${target}`
  return copy ?? null
}

/** Stage one bounded source observation, then apply one undoable transaction.
 * The lock-only transaction follows dataset-snapshot's idiom: source I/O is
 * outside the app transaction, while manual and scheduled callers serialize.
 * #971: the read holds no lifecycle lock, however long it takes (both callers
 * reach here outside one: the request middleware and the job runner let them).
 * The apply takes it, after this table's own lock, so nothing holding the
 * lifecycle lock ever waits for that one. Whatever may have changed during the
 * read is checked under it: applyCopy's mapping check, the source's settings
 * and the owning app. */
export async function copyAgain(user: SessionUser, target: string): Promise<CopyResult> {
  return sql.begin(async lock => {
    await lock`select pg_advisory_xact_lock(hashtext('table-copy:' || ${target}))`
    const copy = await copyInfo(target)
    if (!copy) throw new AppError('NotFoundError', `${target} was not copied from a data source`)
    // Recorded before the metadata the read relies on: an upgrade after this is caught.
    const owner = target.includes('.') ? target.split('.')[0] : null
    const identity = owner ? await servingIdentity(owner) : null
    const settings = await sourceSettings(String(copy.data_source))
    const cfg = await getSource(String(copy.data_source))
    assertAllowed(cfg, `${copy.database}.${copy.source_schema}`, String(copy.source_table))
    const meta = await getMeta(target)
    const columns = meta.columns.filter(c => c.source_column)
    const key = columns.find(c => c.column_name === copy.key_column)
    if (!key?.source_column) throw new AppError('ValidationError', `The key column ${copy.key_column} of ${target} is missing`)
    const select = columns.map(c => `${quoteIdentifier(c.source_column!)} as ${quoteIdentifier(c.column_name)}`).join(', ')
    return withSourceRows(cfg, `select ${select} from ${relation(String(copy.database), String(copy.source_schema), String(copy.source_table))}`, key.column_name,
      async (folder, parts) => {
        const apply = () => actionTransaction(async () => {
          await assertSourceUnchanged(String(copy.data_source), settings)
          return applyCopy(user, target, copy, meta, folder, parts)
        })
        if (!owner) return appOperation(apply)
        let result!: CopyResult
        await assertStillServing(owner, identity!, async () => { result = await apply() })
        return result
      })
  })
}

/** #932: a whole number past 2^53 cannot be held exactly by an Int column.
 *  The warehouse sends it as exact text; refuse the whole copy and say which
 *  value, rather than store a rounded one or fail with a generic range error. */
function assertExactWholeNumbers(rows: Record<string, unknown>[], columns: string[]) {
  for (const row of rows)
    for (const column of columns) {
      const value = row[column]
      // Empty cells read as 0 or NaN and pass; only digit text past the range is refused.
      if (Number.isSafeInteger(Number(value))) continue
      if (typeof value === 'bigint' || (typeof value === 'string' && /^-?\d+$/.test(value.trim())))
        throw new AppError('ValidationError', `Copy failed; no rows changed: ${column} holds ${String(value).trim()} in row ${String(row.row_id)}, ` +
          'past the largest whole number a number column holds exactly (9,007,199,254,740,991 either way)')
    }
}

/** The caller's transaction owns metadata, rows, triggers, history and provenance. */
async function applyCopy(user: SessionUser, target: string, copy: NonNullable<Awaited<ReturnType<typeof copyInfo>>>, meta: TableMeta, folder: string, parts: number): Promise<CopyResult> {
  const columns = meta.columns.filter(c => c.source_column)
  // Lock metadata/provenance before applying; a concurrent rename/delete
  // must not change the mappings halfway through this copy.
  await sql`select name from table_def where name = ${target} for update`
  const current = await copyInfo(target)
  if (JSON.stringify(current) !== JSON.stringify(copy) || JSON.stringify((await getMeta(target)).columns) !== JSON.stringify(meta.columns))
    throw new AppError('ConflictError', 'The copy changed while the source was read; try Copy again')
  const runId = `copy-${randomUUID()}`
  const seen = `copy_seen_${randomUUID().replaceAll('-', '')}`
  await sql`create temporary table ${sql(seen)} (row_id text primary key) on commit drop`
  const result: CopyResult = { run_id: runId, inserted: 0, updated: 0, changed: 0, unchanged: 0, failed: 0, conflicts: 0, deleted_at_source: 0, back_at_source: 0, first_errors: [] }
  const relationName = await tableRelation(target)
  const [before] = await sql`select count(*)::int as n from ${sql(relationName)} where ${sql(DELETED_AT_SOURCE)} is true`
  const context = { run_id: runId, batch_id: runId, file_name: `${copy.data_source} · ${copy.database}.${copy.source_schema}.${copy.source_table}` }
  const wholeNumberColumns = columns.filter(c => c.column_type === 'Int').map(c => c.column_name)
  let partNumber = 0
  const apply = async (rows: Record<string, unknown>[], mapped: string[]) => {
    const part = await importRows({ table: target, user, args: {
      rows, key_column: 'row_id', empty_cells: 'clear', columns: mapped,
      context: { ...context, part: ++partNumber },
    } }, [DELETED_AT_SOURCE], { skipUnchanged: true })
    if (part.failed?.length)
      throw new AppError('ValidationError', `Copy failed; no rows changed: ${part.failed.slice(0, 5).map(f => `${rows[f.index].row_id}: ${f.message}`).join('; ')}`)
    // This call always selects the real upsert mode, never analyze/dry-run
    // or insert-only mode; its successful result has all four numeric counts.
    return part as Pick<CopyResult, 'inserted' | 'updated' | 'changed' | 'unchanged'>
  }
  for (let i = 1; i <= parts; i++) {
    const rows: Record<string, unknown>[] = JSON.parse(await readFile(join(folder, String(i)), 'utf8'))
    // Duplicate/blank keys refuse the entire copy, not last-one-wins.
    if (rows.some(r => !r.row_id)) throw new AppError('ValidationError', 'Copy key values must not be empty')
    const accepted = await sql`insert into ${sql(seen)} ${sql(rows.map(r => ({ row_id: String(r.row_id) })))} on conflict do nothing returning row_id`
    if (accepted.length !== rows.length) throw new AppError('ValidationError', 'Copy key values must be unique')
    assertExactWholeNumbers(rows, wholeNumberColumns)
    const part = await apply(rows, [...columns.map(c => c.column_name), DELETED_AT_SOURCE])
    result.inserted += part.inserted
    result.updated += part.updated
    result.changed += part.changed
    result.unchanged += part.unchanged
  }
  // Missing rows use exactly the import save/version/undo chain too.
  let afterKey = ''
  while (true) {
    const gone = await sql`select row_id from ${sql(relationName)} t where ${sql(DELETED_AT_SOURCE)} is not true and row_id > ${afterKey}
      and not exists (select 1 from ${sql(seen)} s where s.row_id = t.row_id) order by row_id limit ${PART}`
    if (!gone.length) break
    const part = await apply(gone.map(r => ({ row_id: r.row_id, [DELETED_AT_SOURCE]: true })), [DELETED_AT_SOURCE])
    result.deleted_at_source += part.updated
    afterKey = String(gone[gone.length - 1].row_id)
  }
  // Even a repeated empty observation is a discoverable copy run; it has no
  // row versions to undo, but must not disappear from Past imports.
  if (!partNumber) await writeImportLog(target, user.row_id,
    { inserted: 0, updated: 0, upsert: { keyColumn: 'row_id', emptyCells: 'clear', columns: columns.map(c => c.column_name) } },
    [], { ...context, part: 1 }, [])
  const [after] = await sql`select count(*)::int as n from ${sql(relationName)} where ${sql(DELETED_AT_SOURCE)} is true`
  result.back_at_source = Math.max(0, Number(before.n) + result.deleted_at_source - Number(after.n))
  const [conflicts] = await sql`select count(*)::int as n from featherbase.import_conflict where ref_table = ${target} and run_id = ${runId} and closed is not true`
  result.conflicts = Number(conflicts.n)
  await sql`update featherbase.table_copy set last_copied_at = clock_timestamp(), last_run_id = ${runId} where target_table = ${target}`
  return result
}
