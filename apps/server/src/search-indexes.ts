// #1321: search ranks a bounded set of rows containing the text (search.ts),
// so a row named or coded exactly as typed could fall outside it in a large
// Table. Two expression indexes let search look those rows up directly, in
// any case: one on the row key, one on the title column. Each indexes the
// first 140 characters, so a long text title never exceeds an index entry;
// search rechecks the whole value.
import { sql, type TxSql } from './db'
import { ROW_KEY } from './meta'
import { resolvedRelation } from './platform-schema'
import { quoteIdent } from './sql-identifier'

export const SEARCH_PREFIX = 140

/** Column types stored as text: the only titles an exact-name lookup indexes. */
const TEXT_TITLES = new Set(['Data', 'Choice', 'Text', 'Long Text', 'Reference'])
export const indexableTitle = (columnType: string | undefined) => columnType !== undefined && TEXT_TITLES.has(columnType)

/** The indexed expression; search's lookup must spell it the same way. */
export const searchExpression = (column: string) => `lower(left(${quoteIdent(column)}::text, ${SEARCH_PREFIX}))`

const quoted = (relation: string) => relation.split('.').map(quoteIdent).join('.')

/** Make a stored Table's search indexes match its key and title column: create
 *  what is missing, replace a title index on another column, drop it when the
 *  title is not indexable. A connected Table, a view or a Settings Table stores
 *  no rows of its own here and gets none. */
export async function syncSearchIndexes(tx: TxSql | typeof sql, table: string): Promise<void> {
  const [def] = await tx<{ kind: string; data_source: string | null; title_column: string | null; name: string; physical_schema: string | null; physical_relation: string | null }[]>`
    select name, kind, data_source, title_column, physical_schema, physical_relation from table_def where name = ${table}`
  if (!def || def.kind !== 'table' || def.data_source) return
  const relation = resolvedRelation(def)
  const [schema, base] = relation.split('.')
  const [present] = await tx`select to_regclass(${quoted(relation)}) as oid`
  if (!present?.oid) return
  // `Table` alone stores its key as `name` (meta.ts).
  const key = table === 'Table' ? 'name' : ROW_KEY
  const [titleColumn] = def.title_column && def.title_column !== ROW_KEY
    ? await tx<{ column_type: string }[]>`select column_type from column_def where parent = ${table} and column_name = ${def.title_column}`
    : []
  const title = titleColumn && indexableTitle(titleColumn.column_type) ? def.title_column : null
  // Found by the relation, not by name: an index from before a rename takes
  // the new name, which frees the old one for a Table made later under it.
  const existing = await tx<{ indexname: string; indexdef: string }[]>`
    select indexname, indexdef from pg_indexes
    where schemaname = ${schema} and tablename = ${base} and (indexname like '%\_search\_key' or indexname like '%\_search\_title')`
  const name = (suffix: string) => `${base.slice(0, 63 - suffix.length)}${suffix}`
  const keep = async (index: { indexname: string }, suffix: string) => {
    if (index.indexname !== name(suffix))
      await tx.unsafe(`alter index ${quoteIdent(schema)}.${quoteIdent(index.indexname)} rename to ${quoteIdent(name(suffix))}`)
  }
  const keyIndex = existing.find((i) => i.indexname.endsWith('_search_key'))
  if (keyIndex) await keep(keyIndex, '_search_key')
  else await tx.unsafe(`create index ${quoteIdent(name('_search_key'))} on ${quoted(relation)} (${searchExpression(key)})`)
  const titleIndexes = existing.filter((i) => i.indexname.endsWith('_search_title'))
  // pg_get_indexdef names the column as it is now, so a renamed column still matches.
  const onTitle = (i: { indexdef: string }) => title !== null && i.indexdef.includes(`left((${quoteIdent(title)})::text`)
  for (const index of titleIndexes)
    if (!onTitle(index)) await tx.unsafe(`drop index ${quoteIdent(schema)}.${quoteIdent(index.indexname)}`)
  const titleIndex = titleIndexes.find(onTitle)
  if (titleIndex) await keep(titleIndex, '_search_title')
  else if (title) await tx.unsafe(`create index ${quoteIdent(name('_search_title'))} on ${quoted(relation)} (${searchExpression(title)})`)
}
