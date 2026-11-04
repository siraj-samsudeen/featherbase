// #859 (ADR 0019): every stored Table of kind 'table' carries the three
// retirement columns. New Tables get them from createTable; this adds them to
// the Tables that already exist, in the platform schema and in app schemas.
// Nullable columns with no default: no row is rewritten.
//
// The names were free before this change. A builder's column that already
// holds one of them would be silently adopted as retirement state (rows
// hidden, values overwritten), so the migration refuses instead, naming each
// one: rename it first, then migrate.
import { sql } from '../src/db'
import { canRetire, quoteRelation, RETIREMENT_COLUMNS, storedRelation } from '../src/table-engine'

const EXPECTED: Record<string, string> = {
  retired_at: 'timestamp with time zone', retired_by: 'character varying', retired_reason: 'text',
}

export async function up() {
  const declared = await sql<{ parent: string; column_name: string }[]>`
    select parent, column_name from column_def where column_name in ${sql([...RETIREMENT_COLUMNS])} order by parent, column_name`
  const clashes: string[] = []
  const clash = (what: string) => { if (!clashes.includes(what)) clashes.push(what) }
  for (const c of declared) clash(`${c.parent}.${c.column_name}`)
  const tables = await sql<{ name: string; kind: 'table' | 'sub_table' | 'settings'; data_source: string | null; system_written: boolean | null }[]>`
    select name, kind, data_source, system_written from table_def order by name`
  const targets: string[] = []
  for (const table of tables) {
    if (!canRetire(table)) continue
    const relation = await storedRelation(table.name)
    const [present] = await sql`select to_regclass(${quoteRelation(relation)}) as oid`
    if (!present?.oid) continue
    const [schema, name] = relation.split('.')
    const existing = await sql<{ column_name: string; data_type: string }[]>`
      select column_name, data_type from information_schema.columns
      where table_schema = ${schema} and table_name = ${name} and column_name in ${sql([...RETIREMENT_COLUMNS])}`
    // Already the platform's (a rerun, or a Table made by this version):
    // the right types, and no retired_at without the reason retiring records.
    for (const c of existing)
      if (c.data_type !== EXPECTED[c.column_name]) clash(`${table.name}.${c.column_name}`)
    if (existing.some((c) => c.column_name === 'retired_at') && existing.some((c) => c.column_name === 'retired_reason')) {
      const [stray] = await sql.unsafe(`select 1 from ${quoteRelation(relation)} where retired_at is not null and retired_reason is null limit 1`)
      if (stray) clash(`${table.name}.retired_at`)
    } else if (existing.some((c) => c.column_name === 'retired_at')) clash(`${table.name}.retired_at`)
    targets.push(relation)
  }
  if (clashes.length)
    throw new Error(`Retiring a row needs the column names ${RETIREMENT_COLUMNS.join(', ')}, which these Tables already use: ${clashes.join(', ')}. Rename those columns, then migrate again. Nothing was changed.`)
  for (const relation of targets)
    await sql.unsafe(`alter table ${quoteRelation(relation)}
      add column if not exists retired_at timestamptz,
      add column if not exists retired_by varchar(140),
      add column if not exists retired_reason text`)
}
