// What a person reads for a row wherever it is referenced (Home, Recent, the
// activity feed). The Table's title column wins; without one, a readable
// stand-in built from the row's own values — never the internal row id alone.

export interface TitleColumn {
  column_name: string
  column_type: string
  hidden?: boolean | null
}

export interface TitleMeta {
  name: string
  title_column?: string | null
  columns: TitleColumn[]
}

const VALUE_TYPES = new Set(['Data', 'Choice', 'Reference', 'Int', 'Text'])
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
 * name-like first value stands alone; a leading code is paired with the first
 * name-like value after it ("1517 · Kurti Z"); only codes → the first two;
 * nothing at all → "<Table> · <key parts>".
 */
export function rowDisplayTitle(meta: TitleMeta, row: Record<string, unknown>, rowId: string): string {
  const titleColumn = meta.title_column && meta.title_column !== 'row_id' ? meta.title_column : null
  if (titleColumn) {
    const v = String(row[titleColumn] ?? '').trim()
    if (v) return cap(v)
  }
  const values = meta.columns
    .filter((c) => VALUE_TYPES.has(c.column_type) && !c.hidden && c.column_name !== 'row_id')
    .map((c) => String(row[c.column_name] ?? '').trim())
    .filter((v) => v && !OPAQUE_ID.test(v))
  if (values.length > 0) {
    const [first, ...rest] = values
    if (hasLetter(first)) return cap(first)
    const name = rest.find(hasLetter)
    return cap(name ? `${first}${SEPARATOR}${name}` : values.slice(0, 2).join(SEPARATOR))
  }
  return cap([meta.name, ...rowId.split('|').filter(Boolean)].join(SEPARATOR))
}
