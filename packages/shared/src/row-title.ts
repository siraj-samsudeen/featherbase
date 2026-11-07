// What a person reads for a row wherever it is referenced (Home, Recent, the
// activity feed). The Table's title column wins; without one, a readable
// stand-in built from the row's own values — never the internal row id alone.

export interface TitleColumn {
  column_name: string
  column_type: string
  hidden?: boolean | null
  reference_table?: string | null
}

export interface TitleMeta {
  name: string
  title_column?: string | null
  columns: TitleColumn[]
}

// A link's value is the linked row's id: a code the reader may not be allowed to
// see (#1020), so a link never words a row's title. A link to a person is the one
// title column allowed, and callers show the person's name.
const VALUE_TYPES = new Set(['Data', 'Choice', 'Int', 'Text'])
const PERSON_TABLES = new Set(['Person', 'Service Account'])
const OPAQUE_ID = /^(psn|svc)_[a-z2-7]{20}$/
const MAX_LENGTH = 80
const SEPARATOR = ' · '

const hasLetter = (v: string) => /\p{L}/u.test(v)

function cap(v: string): string {
  return v.length > MAX_LENGTH ? `${v.slice(0, MAX_LENGTH - 1)}…` : v
}

/**
 * The row's display title. A title column of `row_id` means "show the id",
 * the migrated default, so it counts as none. Without a title column: a
 * name-like first value stands alone; a leading code follows the first
 * name-like value after it ("Kurti Z · 1517", #910 D5: name first); only codes → the first two;
 * nothing at all → "<Table> · <key parts>".
 */
export function rowDisplayTitle(meta: TitleMeta, row: Record<string, unknown>, rowId: string): string {
  const named = meta.title_column && meta.title_column !== 'row_id' ? meta.title_column : null
  const link = meta.columns.find((c) => c.column_name === named && c.column_type === 'Reference')
  const titleColumn = link && !PERSON_TABLES.has(link.reference_table ?? '') ? null : named
  if (titleColumn) {
    const v = String(row[titleColumn] ?? '').trim()
    if (v) return cap(v)
  }
  // Settings on one Table otherwise all read as the Table's name. Use only
  // readable, visible columns: row-title callers may pass a scoped metadata set.
  if (meta.name === 'Metadata Override'
    && ['table_name', 'column_name', 'property'].every(name => meta.columns.some(c => c.column_name === name && !c.hidden))
    && row.table_name && row.property) {
    return cap([row.table_name, row.column_name || 'Whole Table', row.property].join(SEPARATOR))
  }
  const values = meta.columns
    .filter((c) => VALUE_TYPES.has(c.column_type) && !c.hidden && c.column_name !== 'row_id')
    .map((c) => String(row[c.column_name] ?? '').trim())
    .filter((v) => v && !OPAQUE_ID.test(v))
  if (values.length > 0) {
    const [first, ...rest] = values
    if (hasLetter(first)) return cap(first)
    const name = rest.find(hasLetter)
    return cap(name ? `${name}${SEPARATOR}${first}` : values.slice(0, 2).join(SEPARATOR))
  }
  return cap([meta.name, ...rowId.split('|').filter(Boolean)].join(SEPARATOR))
}

/** #1020: a stand-in title's two parts, for a title reading "Kurti Z · 1517".
 *  A code in a stand-in holds no letter (see rowDisplayTitle), so a title whose
 *  last part has letters is one name, however many separators it holds. */
export function splitStandInTitle(title: string): { name: string; code: string } | null {
  const at = title.lastIndexOf(SEPARATOR)
  if (at === -1) return null
  const code = title.slice(at + SEPARATOR.length)
  return hasLetter(code) ? null : { name: title.slice(0, at), code }
}
