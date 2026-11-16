import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { choiceLabel } from 'shared'
import { api } from '../lib/api'
import { LinkedTitle, RowLink } from '../lib/row-name'
import { UNSEEN_ROW, useLinkTitle } from '../lib/relations'
import { useNavigation } from '../lib/navigation'
import { NO_COLUMN_TYPES, useMeta } from '../lib/meta'
import type { ListColumn } from '../lib/list-view-columns'
import { useI18n } from '../lib/i18n'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { PrincipalName, usePrincipalLabels } from '../lib/people'
import { OneLine } from './list-one-line'
import { Button, DataCards, Select, touchLinkClasses, type DataColumn } from '@featherbase/shop-floor'
import { ArrowDown, ArrowUp } from '@featherbase/shop-floor'
import { RetiredBadge } from './RowRetirement'
import { fmtCount } from '@featherbase/shop-floor'
import { Indicator } from './Indicator'

// SET-004: cells render through the global display settings (date format,
// currency/float precision). Non-typed columns fall back to a plain string.
// person-rename: a Reference to a person or a service account shows the
// name, never the opaque id.
function isPrincipalTable(table: string | null | undefined): boolean {
  return table === 'Person' || table === 'Service Account'
}

const DATE_TYPES = new Set(['Date', 'Datetime'])

export function cell(value: unknown, columnType: string, settings: Settings): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return formatValue(columnType, value, settings) || '—'
}

// #1015: the row's name stays in view, so it may not take the whole window. Flex
// keeps its Retired badge beside the link rather than clipped with it.
export const NAME_CLIP = 'flex max-w-64 items-center [&>a]:min-w-0 [&>a]:truncate'

// One list row (+ its optional expanded child-rows row). Extracted so the
// chevron and the inline subgrid don't clutter the main table loop.
export function ListRow({
  row,
  table,
  columns,
  settings,
  title,
  selected,
  onToggleSelect,
  selectable,
  expandable,
  childFields,
  expanded,
  onToggleExpand,
  inPane,
  onOpenPane,
  titleOpensPane,
}: {
  row: Record<string, unknown>
  table: string
  columns: { column_name: string; label: string; column_type: string; reference_table?: string | null; reference_base?: string | null }[]
  settings: Settings
  // What the row's checkbox names it (#514): the row's display title.
  title: string
  selected: boolean
  onToggleSelect: () => void
  // Read-only sources have no bulk bar, so no selection either (EDS-13).
  selectable: boolean
  expandable: boolean
  childFields: import('../lib/meta').ColumnDef[]
  expanded: boolean
  onToggleExpand: () => void
  /** #910: this row is the one in the drill pane. */
  inPane: boolean
  /** #910: shows a row in the drill pane; absent where there is no pane. */
  onOpenPane?: (pane: { table: string; row: string }) => void
  /** #1173: the row's name link opens the pane too, in place of the row's page. */
  titleOpensPane?: boolean
}) {
  // A title that is a person's id reads as their name.
  const shownTitle = usePrincipalLabels([title])
  const rowId = String(row.row_id)
  // A click on the line itself, not on a link, button or checkbox in it.
  const select = onOpenPane && ((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a,button,input,select,label,textarea')) return
    onOpenPane({ table, row: rowId })
  })
  // Captured before the link handles it, so the router does not navigate.
  const titleClick = onOpenPane && titleOpensPane ? (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[data-title-cell] a')) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    onOpenPane({ table, row: rowId })
  } : undefined
  return (
    <>
      <tr onClick={select || undefined} onClickCapture={titleClick} aria-selected={onOpenPane ? inPane : undefined}
        // #910 checklist 21: a line goes to the pane from the keyboard too;
        // Enter on a link or control inside it keeps doing its own thing.
        tabIndex={onOpenPane ? 0 : undefined}
        onKeyDown={onOpenPane && ((e) => {
          if (e.key !== 'Enter' || e.target !== e.currentTarget) return
          e.preventDefault()
          onOpenPane({ table, row: rowId })
        })}
        className={`group ${inPane ? '' : 'hover:bg-subtle'} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${onOpenPane ? 'cursor-pointer' : ''} ${inPane ? 'bg-action-tint' : ''}`}>
        {expandable && (
          <td className="border-b border-border pl-2 group-last:border-b-0">
            <button
              onClick={onToggleExpand}
              aria-label={expanded ? 'Collapse child rows' : 'Expand child rows'}
              aria-expanded={expanded}
              data-testid="row-expand"
              className={`rounded px-1 text-xs text-ink-subtle transition-transform hover:text-action ${
                expanded ? 'rotate-90 text-action' : ''
              }`}
            >
              ▶
            </button>
          </td>
        )}
        {selectable && (
          <td className="border-b border-border px-3 py-2 group-last:border-b-0">
            <label className="cursor-pointer">
              <input
                type="checkbox"
                aria-label={`Select ${shownTitle(title)}`}
                data-testid="row-check"
                checked={selected}
                onChange={onToggleSelect}
              />
            </label>
          </td>
        )}
        {columns.map((col, i) => (
          <td key={col.column_name} data-title-cell={i === 0 ? '' : undefined} className={`border-b border-border px-3 py-2 group-last:border-b-0 ${isFigure(col) ? 'text-right tabular-nums' : ''} ${i === 0 ? `sticky left-0 z-[1] border-r group-focus-visible:bg-action-tint ${inPane ? 'bg-action-tint' : 'bg-surface group-hover:bg-subtle'}` : ''}`}>
            <OneLine className={i === 0 ? NAME_CLIP : 'max-w-80'}>
              <ListCell row={row} col={col} table={table} settings={settings} first={i === 0} />
            </OneLine>
          </td>
        ))}
        <td aria-hidden className="border-b border-border p-0 group-last:border-b-0" />
      </tr>
      {expanded && (
        <tr data-testid="expanded-row">
          <td
            colSpan={columns.length + 2 + (selectable ? 1 : 0)}
            className="border-b border-border bg-subtle py-3 pl-10 pr-4"
          >
            <InlineChildren table={table} name={String(row.row_id)} childFields={childFields} />
          </td>
        </tr>
      )}
    </>
  )
}

// One value of a row, the same in both shapes: the first column links to the
// row's form, a Choice reads as its status dot and words, a person shows
// their name, and everything else goes through the display settings.
/** A number column: right-aligned in the table and on a card, so figures line up. */
export const isFigure = (col: ListColumn) => ['Int', 'Float', 'Currency', 'Percent'].includes(col.column_type)

function ListCell({
  row,
  col: shownCol,
  table,
  settings,
  first,
  quiet = false,
}: {
  row: Record<string, unknown>
  col: ListColumn
  table: string
  settings: Settings
  first: boolean
  /** A card's meta line (the row id under the title): grey, not body ink. */
  quiet?: boolean
}) {
  const { t } = useI18n()
  // #910: a link opens the linked row in the drill pane, over this list.
  const navigation = useNavigation()
  const nav = navigation?.step.screen === 'list' && navigation.step.table === table ? navigation : null
  // #881: a link to a row of any Table reads as a link to the row's own Table.
  const anyTable = shownCol.table_column ? row[shownCol.table_column] : undefined
  const col = shownCol.table_column
    ? { ...shownCol, reference_table: isBlank(anyTable) ? null : String(anyTable) }
    : shownCol
  if (first)
    return (
      <>
      <Link
        to="/featherbase/admin/table/$table/row/$name"
        search={{ prefill: undefined }}
        params={{ table, name: String(row.row_id) }}
        className={touchLinkClasses('font-medium text-action hover:underline')}
      >
        {col.column_name === 'row_id' && isPrincipalTable(table) ? (
          <PrincipalName id={String(row.row_id)} />
        ) : col.column_type === 'Reference' && isPrincipalTable(col.reference_table) && row[col.column_name] ? (
          // A title column that names a person reads as their name, never the opaque id.
          <PrincipalName id={String(row[col.column_name])} />
        ) : col.column_type === 'Reference' && col.reference_table && !isBlank(row[col.column_name]) ? (
          // A title that links to another row reads as that row's title.
          <LinkedTitle table={col.reference_base ?? col.reference_table} rowId={String(row[col.column_name])} />
        ) : col.column_name !== 'row_id' && isBlank(row[col.column_name]) ? (
          // #792: a row with a blank title is led by its id, never a blank; a
          // person's opaque id reads as what identifies them (#835).
          isPrincipalTable(table) ? <PrincipalName id={String(row.row_id)} /> : String(row.row_id)
        ) : (
          col.column_type === 'Choice' && row[col.column_name] != null
            ? choiceLabel(String(row[col.column_name]), col.choice_labels, t)
            : cell(row[col.column_name], col.column_type, settings)
        )}
      </Link>
      {row.retired_at != null && <RetiredBadge className="-my-1 ml-2 shrink-0 align-middle" />}
      </>
    )
  const value = row[col.column_name]
  return (
    <span
      // A date never breaks at its hyphens in a narrow cell.
      className={`${quiet ? 'text-ink-muted' : 'text-ink'} ${DATE_TYPES.has(col.column_type) ? 'whitespace-nowrap' : ''}`}
      data-testid={`cell-${col.column_name}`}
    >
      {col.column_type === 'Choice' && value != null && value !== '' ? (
        <Indicator value={String(value)} label={choiceLabel(String(value), col.choice_labels, t)} />
      ) : col.column_type === 'Reference' && isPrincipalTable(col.reference_table) && value ? (
        <PrincipalName id={String(value)} />
      ) : col.column_type === 'Reference' && col.reference_table && !isBlank(value) ? (
        // #792: a link reads as the linked row's title and opens that row;
        // #910 D5: its code follows when people use one.
        <RowLink
          table={col.reference_base ?? col.reference_table}
          rowId={String(value)}
          onClick={(e) => {
            e.stopPropagation()
            if (!nav || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
            e.preventDefault()
            nav.push({ ...nav.step, pane: { table: col.reference_base ?? col.reference_table!, row: String(value) } })
          }}
        />
      ) : (
        cell(value, col.column_type, settings)
      )}
    </span>
  )
}

const isBlank = (v: unknown) => v == null || String(v).trim() === ''

/** A nested row's link, by its key as before; a row the viewer cannot read
 *  is neutral words with no link (#910 D3). */
function NestedLink({ table, rowId }: { table: string; rowId: string }) {
  const principal = isPrincipalTable(table)
  const title = useLinkTitle(principal ? undefined : table, rowId)
  if (!principal && title.state === 'unreadable') return <span className="text-ink-muted">{UNSEEN_ROW}</span>
  return (
    <Link to="/featherbase/admin/table/$table/row/$name" search={{ prefill: undefined }}
      params={{ table, name: rowId }} className="text-action hover:underline">
      {principal ? <PrincipalName id={rowId} /> : rowId}
    </Link>
  )
}

// usable-on-any-device "Lists fit a phone": the same rows as cards. The first
// column is the card's title and link, the first Choice its status, and the
// rest labelled figures. What the table's header row does — select the page,
// sort by a column — sits above the cards as two controls.
export function PhoneList({
  table,
  titleColumn,
  rows,
  columns,
  settings,
  selectable,
  selected,
  onToggleRow,
  onSelectPage,
  sort,
  onSort,
  childFields,
  expanded,
  onToggleExpand,
  empty,
}: {
  table: string
  /** The Table's own title column, if it has one. */
  titleColumn: string | null | undefined
  rows: Record<string, unknown>[]
  columns: ListColumn[]
  settings: Settings
  selectable: boolean
  selected: Set<string>
  onToggleRow: (name: string) => void
  onSelectPage: (all: boolean) => void
  sort: { field: string; dir: 'asc' | 'desc' } | null
  onSort: (next: { field: string; dir: 'asc' | 'desc' } | null) => void
  /** The Sub-table columns a card can show in place; null when there are none. */
  childFields: import('../lib/meta').ColumnDef[] | null
  expanded: Set<string>
  onToggleExpand: (name: string) => void
  empty: ReactNode
}) {
  const key = (row: Record<string, unknown>) => String(row.row_id)
  // A card leads with the row's title, never an opaque id: the Table's title
  // column when it is listed, else the first listed column. A person's id
  // already reads as their name. The id, when it is not the title, is the
  // card's quiet meta line.
  const titleCol =
    columns.find((c) => c.column_name === titleColumn) ??
    (isPrincipalTable(table) ? columns[0] : (columns[1] ?? columns[0]))
  const statusColumn = columns.find((c) => c !== titleCol && c.column_type === 'Choice')
  const cardColumns: DataColumn<Record<string, unknown>>[] = columns.map((col) => ({
    key: col.column_name,
    header: col.label,
    phone: col === titleCol ? 'title' : col === statusColumn ? 'status' : col.column_name === 'row_id' ? 'meta' : 'value',
    align: isFigure(col) ? 'end' : 'start',
    cell: (row) => <ListCell row={row} col={col} table={table} settings={settings} first={col === titleCol} quiet={col.column_name === 'row_id' && col !== titleCol} />,
  }))
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(key(r)))
  const titleValue = (row: Record<string, unknown>) =>
    cell(row[titleCol.column_name], titleCol.column_type, settings)
  // A title that is a person's id reads as their name, as the card's link does.
  const shownTitle = usePrincipalLabels(rows.map(titleValue))
  const titleText = (row: Record<string, unknown>) => shownTitle(titleValue(row))
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {selectable && rows.length > 0 && (
          <label className="inline-flex min-h-control cursor-pointer items-center gap-2 text-control text-ink">
            <input
              type="checkbox"
              data-testid="select-all"
              checked={allSelected}
              onChange={(e) => onSelectPage(e.target.checked)}
              className="size-5 accent-action"
            />
            Select all on this page
          </label>
        )}
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-2">
          <label htmlFor="list-sort-by" className="shrink-0 text-control text-ink-muted">
            Sort by
          </label>
          <Select
            id="list-sort-by"
            data-testid="list-sort-by"
            // A long column label is cut, rather than pushing the page sideways.
            wrapperClassName="min-w-0"
            className="truncate"
            value={sort?.field ?? ''}
            onChange={(e) => onSort(e.target.value ? { field: e.target.value, dir: sort?.dir ?? 'asc' } : null)}
          >
            <option value="">Default order</option>
            {columns.map((c) => (
              <option key={c.column_name} value={c.column_name}>
                {c.label}
              </option>
            ))}
          </Select>
          {sort && (
            <Button
              aria-label={`Sort order: ${sort.dir === 'asc' ? 'ascending' : 'descending'}`}
              data-testid="list-sort-dir"
              className="size-control shrink-0 px-0"
              onClick={() => onSort({ field: sort.field, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
              icon={sort.dir === 'asc' ? <ArrowUp aria-hidden size={18} /> : <ArrowDown aria-hidden size={18} />}
            />
          )}
        </div>
      </div>
      {rows.length ? (
        <DataCards
          caption={`Rows of ${table}`}
          testId="list-rows"
          rows={rows}
          columns={cardColumns}
          rowKey={key}
          select={
            selectable
              ? {
                  isSelected: (row) => selected.has(key(row)),
                  onToggle: (row) => onToggleRow(key(row)),
                  label: (row) => `Select ${titleText(row)}`,
                }
              : undefined
          }
          expand={
            childFields
              ? {
                  isExpanded: (row) => expanded.has(key(row)),
                  onToggle: (row) => onToggleExpand(key(row)),
                  render: (row) => <InlineChildren table={table} name={key(row)} childFields={childFields} />,
                }
              : undefined
          }
        />
      ) : (
        empty
      )}
    </div>
  )
}

// The expanded row's content: every Sub-table column's rows, read-only,
// fetched through the ordinary row GET (children arrive embedded).
function InlineChildren({
  table,
  name,
  childFields,
}: {
  table: string
  name: string
  childFields: import('../lib/meta').ColumnDef[]
}) {
  const settings = useSettings()
  const doc = useQuery({
    queryKey: ['doc', table, name],
    queryFn: () =>
      api.get<Record<string, unknown>>(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`,
      ),
  })
  if (doc.isLoading) return <p className="text-xs text-ink-subtle">Loading…</p>
  if (doc.isError) return <p className="text-xs text-negative">Cannot load {name}</p>
  return (
    <div className="flex flex-col gap-3">
      {childFields.map((f) => (
        <InlineChildGrid
          key={f.column_name}
          field={f}
          rows={(doc.data?.[f.column_name] as Record<string, unknown>[]) ?? []}
          settings={settings}
        />
      ))}
    </div>
  )
}

function InlineChildGrid({
  field,
  rows,
  settings,
}: {
  field: import('../lib/meta').ColumnDef
  rows: Record<string, unknown>[]
  settings: Settings
}) {
  const { t } = useI18n()
  const childMeta = useMeta(field.row_table ?? '')
  if (!childMeta.data) return null
  const cols = childMeta.data.columns.filter(
    (f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden,
  )
  const currencyCols = cols.filter((c) => c.column_type === 'Currency')
  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface" data-testid={`inline-children-${field.column_name}`}>
      <div className="border-b border-border px-3 py-1 text-xs font-semibold text-ink-muted">
        {field.label ?? field.column_name} ({fmtCount(rows.length)})
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.column_name} className="border-b border-border px-3 py-1 text-left font-medium text-ink-muted">
                {c.label ?? c.column_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.row_id ?? i)} className="border-b border-border last:border-0">
              {cols.map((c) => (
                <td key={c.column_name} className="px-3 py-1 text-ink">
                  {c.column_type === 'Reference' && c.reference_table && r[c.column_name] ? (
                    <NestedLink table={c.reference_base ?? c.reference_table} rowId={String(r[c.column_name])} />
                  ) : (
                    c.column_type === 'Choice' && r[c.column_name] != null
                      ? choiceLabel(String(r[c.column_name]), c.choice_labels, t)
                      : cell(r[c.column_name], c.column_type, settings)
                  )}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={cols.length} className="px-3 py-3 text-center text-ink-subtle">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {currencyCols.length > 0 && rows.length > 0 && (
        <div className="border-t border-border bg-subtle px-3 py-1 text-xs text-ink-muted">
          {currencyCols
            .map(
              (c) =>
                `Σ ${c.label ?? c.column_name}: ${
                  formatValue(
                    'Currency',
                    rows.reduce((s, r) => s + (Number(r[c.column_name]) || 0), 0),
                    settings,
                  )
                }`,
            )
            .join(' · ')}
        </div>
      )}
    </div>
  )
}
