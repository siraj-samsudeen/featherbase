// #881: a link to a row of any Table. Two columns of one Table hold it: a link
// to Table (which Table) and a link column naming that column in its
// `table_column` (which row). The row half alone means nothing: row ids are
// unique only within their Table (#855), so every check uses the pair.
import type { sql } from './db'

/** The Tables a link may point at, one per line; none means any linkable Table. */
export function allowedTables(choices: string | null | undefined): string[] {
  return (choices ?? '').split('\n').map((name) => name.trim()).filter(Boolean)
}

/** May a link with these allowed Tables name `table`? None listed allows any. */
export function linksTo(choices: string | null | undefined, table: string): boolean {
  const allowed = allowedTables(choices)
  return !allowed.length || allowed.includes(table)
}

/** Only a stored Table's rows can be linked to: never a Sub-table's rows, a
 *  settings Table or a Table kept in a connected database (#881 Q2, Q3). */
export function linkableTable(def: { kind?: unknown; data_source?: unknown }): boolean {
  return def.kind === 'table' && !def.data_source
}

export interface AnyTableLinkColumn { parent: string; column_name: string; table_column: string }

/** Every link to a row of any Table, in every Table that stores rows. */
export async function anyTableLinkColumns(tx: typeof sql): Promise<AnyTableLinkColumn[]> {
  return await tx<AnyTableLinkColumn[]>`
    select cd.parent, cd.column_name, cd.table_column from column_def cd
    join table_def td on td.name = cd.parent
    where cd.column_type = 'Reference' and cd.table_column is not null
      and td.kind <> 'settings' and td.data_source is null
    order by 1, 2`
}

/** The rows holding a link to `table` row `rowId`, per link column. */
async function holders(tx: typeof sql, table: string, rowId: string) {
  const { getMeta } = await import('./meta')
  const { tableRelation } = await import('./table-engine')
  const found: { table: string; row: Record<string, unknown>; kind: string }[] = []
  for (const link of await anyTableLinkColumns(tx)) {
    const meta = await getMeta(link.parent)
    const rows = await tx`select * from ${tx(await tableRelation(link.parent))}
      where ${tx(link.table_column)} = ${table} and ${tx(link.column_name)} = ${rowId}`
    for (const row of rows) found.push({ table: link.parent, row, kind: meta.kind })
  }
  return found
}

/** How many rows link to this row through a link to any Table. */
export async function anyTableLinkCount(tx: typeof sql, table: string, rowId: string): Promise<number> {
  return (await holders(tx, table, rowId)).length
}

/** The Table and id of the row (or the parent row of a Sub-table's row)
 *  linking to this row, if any. */
export async function anyTableLinkHolder(tx: typeof sql, table: string, rowId: string): Promise<{ table: string; row_id: string } | null> {
  const [first] = await holders(tx, table, rowId)
  if (!first) return null
  const { physicalRowKey } = await import('./meta')
  return first.kind === 'sub_table'
    ? { table: String(first.row.parenttype), row_id: String(first.row.parent) }
    : { table: first.table, row_id: String(first.row[physicalRowKey(first.table)]) }
}

/** A row's id changed: every link to it through a link to any Table follows. */
export async function repointAnyTableLinks(tx: typeof sql, table: string, oldId: string, newId: string): Promise<void> {
  const { tableRelation } = await import('./table-engine')
  for (const link of await anyTableLinkColumns(tx))
    await tx`update ${tx(await tableRelation(link.parent))} set ${tx(link.column_name)} = ${newId}
      where ${tx(link.table_column)} = ${table} and ${tx(link.column_name)} = ${oldId}`
}

export interface AnyTableBacklink { table: string; column: string; table_column: string; via: string | null }

/** #881: the links to a row of any Table that may point at `target`'s rows:
 *  held in a Table's own rows, or in a Sub-table's rows (`via`), reached from
 *  each Table that holds that Sub-table. */
export async function anyTableBacklinks(tx: typeof sql, target: string): Promise<AnyTableBacklink[]> {
  const [def] = await tx<{ kind: string; data_source: string | null }[]>`select kind, data_source from table_def where name = ${target}`
  if (!def || !linkableTable(def)) return []
  const links = await tx<{ parent: string; column_name: string; table_column: string; choices: string | null; kind: string }[]>`
    select cd.parent, cd.column_name, cd.table_column, cd.choices, td.kind from column_def cd
    join table_def td on td.name = cd.parent
    where cd.column_type = 'Reference' and cd.table_column is not null
      and td.kind <> 'settings' and td.data_source is null
    order by 1, 2`
  const found: AnyTableBacklink[] = []
  for (const link of links.filter((l) => linksTo(l.choices, target))) {
    if (link.kind !== 'sub_table') {
      found.push({ table: link.parent, column: link.column_name, table_column: link.table_column, via: null })
      continue
    }
    const owners = await tx<{ parent: string }[]>`
      select distinct cd.parent from column_def cd join table_def td on td.name = cd.parent
      where cd.column_type = 'Sub-table' and cd.row_table = ${link.parent} and td.kind = 'table' and td.data_source is null
      order by 1`
    for (const owner of owners) found.push({ table: owner.parent, column: link.column_name, table_column: link.table_column, via: link.parent })
  }
  return found
}
