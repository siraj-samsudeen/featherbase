import type { ListLayout, TableViewDefault, TableViewSettings } from 'shared'
import { api } from './api'
import { dataColumns, defaultColumnNames, isShown, viewColumns, type ColumnArrangement } from './list-view-columns'
import type { TableMeta } from './meta'

// #1282 A4 (UI owner): a Table's default view, set by a System Manager from the View menu. It sits between the
// Table's own list columns and sort and a person's own choices: a choice the person made wins, the Table's default
// fills the rest, and the platform's built-in fills what neither names.

export function tableViewDefaultQuery(table: string) {
  return {
    queryKey: ['table-view-default', table],
    queryFn: async () => (await api.get<{ default: TableViewDefault | null }>(`/api/table_view_default/${encodeURIComponent(table)}`)).default,
    retry: false,
  }
}

/** The Table's list columns with its default's columns switched on and off on top: what a person who never
 *  changed their columns sees. */
export function listDefaultsWith(meta: TableMeta, td: TableViewSettings): Set<string> {
  const base = defaultColumnNames(meta)
  return new Set(dataColumns(meta).map((c) => c.column_name).filter((c) => isShown(c, base, td)))
}

/** What a manager's view saves as the Table's default: the columns they see, as switched on and off against the
 *  Table's own list columns (so the default holds whatever the earlier default did), and their other choices. */
export function viewAsDefault(meta: TableMeta, own: ColumnArrangement, td: TableViewSettings,
  rest: { layout: ListLayout; sort: TableViewSettings['sort']; compact: boolean; links: NonNullable<TableViewSettings['links']> }): TableViewSettings {
  const base = defaultColumnNames(meta)
  const layered = listDefaultsWith(meta, td)
  const seen = dataColumns(meta).map((c) => c.column_name).filter((c) => isShown(c, layered, own))
  return {
    layout: rest.layout,
    shownCols: seen.filter((c) => !base.has(c)),
    hiddenCols: [...base].filter((c) => !seen.includes(c)),
    sort: rest.sort ?? null,
    compact: rest.compact,
    links: rest.links,
  }
}

const LAYOUT_WORDS: Record<ListLayout, string> = { table: 'Table', split: 'List And Record', panel: 'Table With Panel' }
const NUMBER_TYPES = new Set(['Int', 'Float', 'Currency', 'Percent'])
const DATE_TYPES = new Set(['Date', 'Datetime', 'Time'])
const BUILT_IN_LABELS: Record<string, string> = { row_id: 'Row ID', created_at: 'Created', updated_at: 'Last Updated' }

/** The confirm's words for a default, one per setting: "List And Record", "Columns: Name, Site, Status",
 *  "Sorted by Age, oldest first", "Compact rows", "Links: Sections", "Fields beside links". */
export function describeView(meta: TableMeta, view: TableViewSettings): string[] {
  // In the list's own order: what it leads with first, then each shown column.
  const shown = viewColumns(meta, view)
  const columns = `Columns: ${shown.map((c) => c.label).join(', ')}`
  const sorted = (() => {
    if (!view.sort) return 'Sorted as the Table is'
    const col = meta.columns.find((c) => c.column_name === view.sort!.field)
    const label = col?.label ?? BUILT_IN_LABELS[view.sort.field] ?? view.sort.field
    const type = col?.column_type ?? (view.sort.field.endsWith('_at') ? 'Datetime' : 'Data')
    const [first, last] = DATE_TYPES.has(type) ? ['oldest first', 'newest first'] : NUMBER_TYPES.has(type) ? ['smallest first', 'largest first'] : ['A to Z', 'Z to A']
    return `Sorted by ${label}, ${view.sort.dir === 'asc' ? first : last}`
  })()
  const links = view.links ?? {}
  return [
    LAYOUT_WORDS[view.layout ?? 'panel'],
    columns,
    sorted,
    view.compact ? 'Compact rows' : 'Full rows',
    `Links: ${links.as === 'tree' ? 'Tree' : 'Sections'}`,
    links.fields === false ? 'No fields beside links' : 'Fields beside links',
  ]
}
