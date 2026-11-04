// #859 (ADR 0019): every stored Table of kind 'table' carries the three
// retirement columns. New Tables get them from createTable; this adds them to
// the Tables that already exist, in the platform schema and in app schemas.
// Nullable columns with no default: no row is rewritten.
import { sql } from '../src/db'
import { canRetire, quoteRelation, storedRelation } from '../src/table-engine'

export async function up() {
  const tables = await sql<{ name: string; kind: 'table' | 'sub_table' | 'settings'; data_source: string | null; system_written: boolean | null }[]>`
    select name, kind, data_source, system_written from table_def order by name`
  for (const table of tables) {
    if (!canRetire({ ...table, system_written: Boolean(table.system_written) })) continue
    const relation = await storedRelation(table.name)
    const [present] = await sql`select to_regclass(${quoteRelation(relation)}) is not null as present`
    if (!present?.present) continue
    await sql.unsafe(`alter table ${quoteRelation(relation)}
      add column if not exists retired_at timestamptz,
      add column if not exists retired_by varchar(140),
      add column if not exists retired_reason text`)
  }
}
