import { useState, type ReactNode } from 'react'
import { choiceLabel } from 'shared'
import { LinkedTitle } from '../lib/row-name'
import { UNSEEN_ROW, useLinkTitle } from '../lib/relations'
import { LinkControl } from './LinkControl'
import { NO_COLUMN_TYPES, type ColumnDef, type TableMeta } from '../lib/meta'
import { NOT_A_LOGIN } from '../lib/not-a-login'
import { useI18n } from '../lib/i18n'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { FilterChip, RecordLink, SearchInput, buttonClasses, inputClasses, pillClasses } from '@featherbase/shop-floor'
import { parseChain } from '../lib/linked-filters'
import { LinkedFilterBuilder, LinkedFilterWords, useLinkOptions } from './LinkedFilter'

export type Filter = [string, string, unknown]

// Deliberately WITHOUT 'related' (NAV-002): the free-text value input cannot
// author a relationship spec. Relationship filters are built by Linked to… and
// Not linked to… (#1276), or arrive via links, and render as chips.
const OPS = ['=', '!=', 'like', '>', '<', '>=', '<='] as const
// #1196: no value or empty text; they take no value. Only the platform's own
// database answers them, so a connected Table's list does not offer them.
const BLANK_OPS = ['is blank', 'is not blank'] as const
const isBlankOp = (op: string) => (BLANK_OPS as readonly string[]).includes(op)
// #1276: the two Add filter choices that follow a link rather than test a column.
const LINKED = '__linked_to'
const NOT_LINKED = '__not_linked_to'

// Standard filters (adopted from PR 2's Admin screen): typed per-column
// inputs for the list's visible columns — Choices become dropdowns, text-ish
// columns match with contains. They read and write the same URL-driven filter
// list the advanced FilterBar manages, so chips stay in sync.
const STANDARD_TEXT_TYPES = new Set(['Data', 'Reference', 'Email', 'Small Text'])
// #1017: one width for every kind of box, so a long Choice can't stretch its own
// and four of them share a line with the list's other controls.
const FILTER_BOX = 'flex w-32 flex-col gap-0.5'
const FILTER_LABEL = 'truncate text-xs font-semibold text-ink-subtle'

// A value's box in the Add filter row suits its column, where the condition can use it (#1019).
const NUMBER_TYPES = new Set(['Int', 'Float', 'Currency', 'Percent'])
function filterBoxKind(col: import('../lib/meta').ColumnDef | undefined, op: string) {
  const exact = op === '=' || op === '!='
  if (!col || op === 'like') return 'text'
  if (exact && col.column_type === 'Reference' && col.reference_table) return 'link'
  if (exact && col.column_type === 'Choice') return 'choice'
  if (col.column_type === 'Date') return 'date'
  if (col.column_type === 'Datetime') return 'datetime-local'
  if (NUMBER_TYPES.has(col.column_type)) return 'number'
  return 'text'
}

const TEXT_TYPES = new Set(['Data', 'Text', 'Small Text', 'Long Text'])

/** The column a list's Search looks in: the Table's title column when it holds
 *  text, else its first text column; none when it has no text to search. A
 *  title that is a link (a Reference) holds an id, not the name people read,
 *  so Search never looks there (Codex review, round 12). */
export function searchColumn(meta: TableMeta): string | undefined {
  const title = meta.title_column ? meta.columns.find((c) => c.column_name === meta.title_column) : undefined
  if (title && TEXT_TYPES.has(title.column_type)) return title.column_name
  return meta.columns.find((c) => TEXT_TYPES.has(c.column_type) && !NO_COLUMN_TYPES.has(c.column_type) && !c.hidden)?.column_name
}

const SEARCH_OP = 'like'
const unwrap = (value: unknown) => (typeof value === 'string' ? value.replace(/^%|%$/g, '') : '')

/**
 * #1242 (admin-lists 3): Search a list by its title. Enter puts it on as an
 * ordinary filter (a chip), so it is remembered (#1228), shared in the address
 * and cleared like any other; an empty search takes it off.
 */
export function ListSearch({ meta, filters, onChange, label }: {
  meta: TableMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
  label: string
}) {
  const column = searchColumn(meta)
  const on = column ? filters.find((f) => f[0] === column && f[1] === SEARCH_OP) : undefined
  const active = unwrap(on?.[2])
  const [text, setText] = useState(active)
  // Codex review, round 9: when the search on the list changes from elsewhere (a
  // saved view, Back, Clear filters), the box shows it; typing in between is kept.
  const [shown, setShown] = useState(active)
  if (active !== shown) {
    setShown(active)
    setText(active)
  }
  if (!column) return null
  return (
    <form
      role="search"
      aria-label={`Search ${label}`}
      onSubmit={(e) => {
        e.preventDefault()
        const rest = filters.filter((f) => !(f[0] === column && f[1] === SEARCH_OP))
        const words = text.trim()
        onChange(words ? [...rest, [column, SEARCH_OP, `%${words}%`]] : rest)
      }}
    >
      <span className="relative block">
        <SearchInput
          aria-label={`Search ${label}`}
          placeholder={`Search ${label}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-testid="list-search"
          {...NOT_A_LOGIN}
          className={active ? 'w-56 pr-9 [&::-webkit-search-cancel-button]:hidden' : 'w-56'}
        />
        {active && (
          <BoxClear name="search" testId="list-search-clear" onClear={() => {
            setText('')
            onChange(filters.filter((f) => !(f[0] === column && f[1] === SEARCH_OP)))
          }} />
        )}
      </span>
    </form>
  )
}

/** The list's field boxes (up to four of its visible Choice and text-like columns). The column Search looks in
 *  has none: the search box is its box (#1289: no filter shown twice). */
function standardColumns(meta: TableMeta) {
  const search = searchColumn(meta)
  return meta.columns
    .filter((f) => f.in_list_view && !f.hidden && f.column_name !== search && (f.column_type === 'Choice' || STANDARD_TEXT_TYPES.has(f.column_type)))
    .slice(0, 4)
}

/** #1289: whether the list draws field boxes, whose labels sit above their controls (the view tools line up with the controls). */
export const hasFieldBoxes = (meta: TableMeta) => standardColumns(meta).length > 0

const CONTAINS = /^%[^%]*%$/
const scalar = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && String(v) !== ''

/**
 * #1289: which of the list's filters a visible box already shows (the search box, or a field box), by index.
 * A box shows only the first filter it can show exactly; any other filter, and every filter added with Add
 * filter on a column with no box, is a chip. So no filter is shown twice.
 */
export function heldByBoxes(meta: TableMeta, filters: Filter[]): Set<number> {
  const held = new Set<number>()
  const take = (match: (f: Filter) => boolean) => {
    const i = filters.findIndex((f, j) => !held.has(j) && match(f))
    if (i >= 0) held.add(i)
  }
  const search = searchColumn(meta)
  if (search) take(([c, op, v]) => c === search && op === SEARCH_OP && typeof v === 'string' && CONTAINS.test(v))
  for (const f of standardColumns(meta)) {
    if ((f.column_type === 'Reference' && f.reference_table) || f.column_type === 'Choice')
      take(([c, op, v]) => c === f.column_name && op === '=' && scalar(v))
    else take(([c, op, v]) => c === f.column_name && op === 'like' && typeof v === 'string' && CONTAINS.test(v))
  }
  return held
}

/** #1289: a filled box's own ✕, which takes its filter off. */
function BoxClear({ name, onClear, testId, beforeArrow = false }: { name: string; onClear: () => void; testId: string
  /** A select draws its own arrow at the right: the ✕ sits just left of it, never on it. */
  beforeArrow?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear the ${name} filter`}
      data-testid={testId}
      className={`absolute bottom-0 flex h-control items-center ${beforeArrow ? 'right-7' : 'right-1'}`}
    >
      <span aria-hidden className="grid size-6 place-items-center rounded-full text-xs text-action hover:bg-action/15">✕</span>
    </button>
  )
}

export function StandardFilters({
  meta,
  filters,
  onChange,
}: {
  meta: import('../lib/meta').TableMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
}) {
  const { t } = useI18n()
  const columns = standardColumns(meta)
  // Drafts for the text inputs (applied on Enter/blur); choices apply at once.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  if (!columns.length) return null

  function current(columnName: string, op: string): string {
    const hit = filters.find((f) => f[0] === columnName && f[1] === op)
    if (!hit) return ''
    const v = String(hit[2] ?? '')
    return op === 'like' ? v.replace(/^%|%$/g, '') : v
  }

  function apply(columnName: string, op: string, value: string) {
    const rest = filters.filter((f) => f[0] !== columnName)
    onChange(value ? [...rest, [columnName, op, op === 'like' ? `%${value}%` : value]] : rest)
  }

  function clear(columnName: string, op: string) {
    setDrafts(({ [columnName]: _, ...d }) => d)
    apply(columnName, op, '')
  }

  /** One box: its label over its control, and its ✕ when it holds a filter (outside the label, so the
   *  control's name stays the column's). */
  const box = (f: ColumnDef, op: string, control: ReactNode) => (
    <div key={f.column_name} className={`relative ${FILTER_BOX}`}>
      <label className="contents">
        <span className={FILTER_LABEL} title={f.label ?? f.column_name}>
          {f.label ?? f.column_name}
        </span>
        {control}
      </label>
      {current(f.column_name, op) && (
        <BoxClear name={f.label ?? f.column_name} onClear={() => clear(f.column_name, op)} testId={`std-filter-clear-${f.column_name}`}
          beforeArrow={f.column_type === 'Choice'} />
      )}
    </div>
  )
  const roomForClear = (op: string, f: ColumnDef, rest = '') => (current(f.column_name, op) ? `pr-9 ${rest}` : rest)

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="standard-filters">
      {columns.map((f) =>
        f.column_type === 'Reference' && f.reference_table ? (
          // #793: a link filters by picking a row by its name, not by typing its id.
          box(f, '=', (
            <span className="flex items-center [&>div]:min-w-0 [&>div]:flex-1">
              <LinkControl
                field={f}
                value={current(f.column_name, '=')}
                onChange={(v) => apply(f.column_name, '=', String(v ?? ''))}
                className={inputClasses(roomForClear('=', f, 'text-ellipsis'))}
                common={{ 'data-testid': `std-filter-${f.column_name}` }}
                forFilter
              />
            </span>
          ))
        ) : f.column_type === 'Choice' ? (
          box(f, '=', (
            <select
              value={current(f.column_name, '=')}
              onChange={(e) => apply(f.column_name, '=', e.target.value)}
              data-testid={`std-filter-${f.column_name}`}
              className={inputClasses(current(f.column_name, '=') ? 'pr-14' : undefined)}
            >
              <option value="">All</option>
              {(f.choices ?? '')
                .split('\n')
                .filter(Boolean)
                .map((o) => (
                  <option key={o} value={o}>
                    {choiceLabel(o, f.choice_labels, t)}
                  </option>
                ))}
            </select>
          ))
        ) : (
          box(f, 'like', (
            <input
              value={drafts[f.column_name] ?? current(f.column_name, 'like')}
              onChange={(e) => setDrafts((d) => ({ ...d, [f.column_name]: e.target.value }))}
              onBlur={(e) => apply(f.column_name, 'like', e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  apply(f.column_name, 'like', (e.target as HTMLInputElement).value.trim())
                }
              }}
              placeholder={`Filter ${f.label ?? f.column_name}…`}
              data-testid={`std-filter-${f.column_name}`}
              className={inputClasses(roomForClear('like', f, 'text-ellipsis'))}
              {...NOT_A_LOGIN}
            />
          ))
        ),
      )}
    </div>
  )
}

// Chips must stay readable for non-scalar filter values: a 'related'
// relationship filter (NAV-002) names its target, long in-lists truncate.
export function filterValueLabel(op: string, value: unknown): string {
  if ((op === 'related' || op === 'not related') && value && typeof value === 'object' && !Array.isArray(value)) {
    const spec = value as { table?: string; via?: string }
    return spec.via ? `${spec.table ?? ''} via ${spec.via}` : String(spec.table ?? '')
  }
  if (Array.isArray(value))
    return value.length > 3
      ? `${value.slice(0, 3).map(String).join(', ')} +${value.length - 3}`
      : value.map(String).join(', ')
  return String(value)
}

// #1289: a filter's value reads as the list's cells show it: dates in the instance's format (DD-Mon-YYYY),
// figures with their precision; a Check reads Yes or No, as a record's page says it.
const TYPED_VALUES = new Set(['Check', 'Date', 'Datetime', 'Currency', 'Float'])
const TRUE_WORDS = new Set(['1', 'true', 'yes'])
function readable(columnType: string, value: unknown, settings: Settings): unknown {
  if (Array.isArray(value)) return value.map((v) => readable(columnType, v, settings))
  if (columnType === 'Check') return value === true || TRUE_WORDS.has(String(value).toLowerCase()) ? 'Yes' : 'No'
  return formatValue(columnType, value, settings) || value
}

/** #1289: the record a chip names, as a link that opens it; plain words only where the viewer may not open it. */
function ChipRecord({ table, rowId }: { table: string; rowId: string }) {
  const title = useLinkTitle(table, rowId)
  if (title.state === 'loading') return <span className="text-ink-subtle">…</span>
  if (title.state === 'unreadable') return <RecordLink table={table} rowId={rowId} name={UNSEEN_ROW} canOpen={false} />
  return <RecordLink table={table} rowId={rowId} name={title.title} />
}

/** One filter as a person reads it (#792): its column as the list's heading
 *  names it, and a link compared with one row reads as that row's title. */
export function FilterWords({ meta, filter, asLink = false }: {
  meta: import('../lib/meta').TableMeta | undefined
  filter: Filter
  /** #1289: a record it names is a link that opens it (a chip); false inside another control (a Recent button). */
  asLink?: boolean
}) {
  const { t } = useI18n()
  const settings = useSettings()
  const [column, op, value] = filter
  // #1276: a Linked to chain reads as its steps, each with its count.
  const chain = meta && parseChain(filter)
  if (chain) return <LinkedFilterWords chain={chain} />
  const col = meta?.columns.find((c) => c.column_name === column)
  const label = column === 'row_id' ? 'Row ID' : t(col?.label ?? column)
  const linked =
    col?.column_type === 'Reference' && col.reference_table && (op === '=' || op === '!=') &&
    (typeof value === 'string' || typeof value === 'number') && String(value) !== ''
  // #1242 (verifier, round 3): a "%words%" pattern, as Search writes, reads
  // "contains words" rather than its wildcards; other patterns stay as written.
  const contains = (op === 'like' || op === 'not like') && typeof value === 'string' && /^%[^%_]+%$/.test(value)
  if (contains) return <>{label} {op === 'like' ? 'contains' : 'does not contain'} {(value as string).slice(1, -1)}</>
  // #1276: an exact match reads as the path bar names it, "Site: Bayside".
  return (
    <>
      {label}{op === '=' ? ': ' : ` ${op}`}{isBlankOp(op) || op === '=' ? null : ' '}
      {isBlankOp(op) ? null : linked ? (asLink
          ? <ChipRecord table={col.reference_base ?? col.reference_table!} rowId={String(value)} />
          : <LinkedTitle table={col.reference_base ?? col.reference_table!} rowId={String(value)} />)
        : (op === '=' || op === '!=') && col?.column_type === 'Choice' ? choiceLabel(String(value), col.choice_labels, t)
        : col && TYPED_VALUES.has(col.column_type) && !(op === 'like' || op === 'not like') ? filterValueLabel(op, readable(col.column_type, value, settings))
        : filterValueLabel(op, value)}
    </>
  )
}

export function FilterBar({
  meta,
  filters,
  onChange,
  onLinkedAdded,
  chips = true,
}: {
  meta: import('../lib/meta').TableMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
  /** #1276: a Linked to filter was added; the list closes its Add filter row. */
  onLinkedAdded?: () => void
  /** #1289: false when the page shows the chips in its own filter row. */
  chips?: boolean
}) {
  const { t } = useI18n()
  const fields = [
    { fieldname: 'row_id', label: 'Row ID' },
    ...meta.columns
      .filter((f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden)
      .map((f) => ({ fieldname: f.column_name, label: f.label ?? f.column_name })),
  ]
  const [field, setField] = useState('row_id')
  const [op, setOp] = useState<string>('=')
  const [value, setValue] = useState('')
  const column = meta.columns.find((c) => c.column_name === field)
  const kind = filterBoxKind(column, op)
  // #1276: the Tables this list links to; a connected Table follows only its own
  // links within its source, and cannot ask for rows NOT linked.
  const links = useLinkOptions(meta.name)
  const linked = field === LINKED || field === NOT_LINKED

  const ops: readonly string[] = meta.data_source ? OPS : [...OPS, ...BLANK_OPS]
  function add() {
    if (isBlankOp(op)) return onChange([...filters, [field, op, null]])
    if (!value.trim()) return
    const v = op === 'like' ? `%${value.trim()}%` : value.trim()
    onChange([...filters, [field, op, v]])
    setValue('')
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={field}
          onChange={(e) => { setField(e.target.value); setValue('') }}
          aria-label="Filter by field"
          data-testid="filter-field"
          className={inputClasses('max-w-[10rem]')}
        >
          {fields.map((f) => (
            <option key={f.fieldname} value={f.fieldname}>
              {f.label}
            </option>
          ))}
          {links.options.length > 0 && (
            <optgroup label="Links">
              <option value={LINKED}>Linked to…</option>
              {!meta.data_source && <option value={NOT_LINKED}>Not linked to…</option>}
            </optgroup>
          )}
        </select>
        {!linked && <>
        <select
          value={op}
          onChange={(e) => {
            if (filterBoxKind(column, e.target.value) !== kind) setValue('')
            setOp(e.target.value)
          }}
          aria-label="Filter condition"
          data-testid="filter-op"
          className={inputClasses('max-w-[10rem]')}
        >
          {ops.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {isBlankOp(op) ? null : kind === 'link' ? (
          <LinkControl
            key={field}
            field={column!}
            value={value}
            onChange={(v) => setValue(String(v ?? ''))}
            className={inputClasses('max-w-[10rem]')}
            common={{ 'aria-label': 'Filter value', 'data-testid': 'filter-value' }}
            forFilter
          />
        ) : kind === 'choice' ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Filter value"
            data-testid="filter-value"
            className={inputClasses('max-w-[20rem]')}
          >
            <option value="">Choose a value</option>
            {(column!.choices ?? '').split('\n').filter(Boolean).map((raw) => (
              <option key={raw} value={raw}>{choiceLabel(raw, column!.choice_labels, t)}</option>
            ))}
          </select>
        ) : <input
          type={kind}
          step={kind === 'number' ? 'any' : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Value"
          aria-label="Filter value"
          data-testid="filter-value"
          className={inputClasses('max-w-[10rem]')}
          {...NOT_A_LOGIN}
        />}
        <button
          onClick={add}
          data-testid="filter-add"
          className={buttonClasses()}
        >
          Add
        </button>
        </>}
      </div>
      {linked && (
        <LinkedFilterBuilder
          key={field}
          meta={meta}
          listFilters={filters}
          negate={field === NOT_LINKED}
          onAdd={(f) => {
            onChange([...filters, f])
            setField('row_id')
            onLinkedAdded?.()
          }}
        />
      )}
      {chips && <FilterChips meta={meta} filters={filters} onChange={onChange} className="mt-2" />}
    </div>
  )
}

/** #1289: the list's active filters as big chips, each with a round ✕, then Clear All Filters when more than one
 *  is on. They sit in the list's one filter row; filters come back on the next visit (#1228), so one control takes
 *  them all off. */
export function FilterChips({ meta, filters, onChange, held, picked, onSaveView, className }: {
  meta: import('../lib/meta').TableMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
  /** #1289: the filters a visible box already shows (heldByBoxes): they get no chip. */
  held?: Set<number>
  /** #1289 option C: the filters Click To Narrow picked, by index: one green chip per picked value. */
  picked?: Map<number, { key: string; name: string; words: import('react').ReactNode; onRemove: () => void }[]>
  /** #1289 option C: Save As View beside the chips. */
  onSaveView?: () => void
  className?: string
}) {
  const { t } = useI18n()
  if (!filters.length) return null
  const nameOf = ([column]: Filter) => (column === 'row_id' ? 'Row ID' : t(meta.columns.find((c) => c.column_name === column)?.label ?? String(column)))
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`} data-testid="filter-chips">
      {filters.map((f, i) => held?.has(i) ? null : picked?.has(i) ? picked.get(i)!.map((chip) => (
        <FilterChip key={`${i}\u0000${chip.key}`} name={chip.name} onRemove={chip.onRemove} tone="picked">{chip.words}</FilterChip>
      )) : (
        <FilterChip key={i} name={nameOf(f)} onRemove={() => onChange(filters.filter((_, j) => j !== i))}>
          <FilterWords meta={meta} filter={f} asLink />
        </FilterChip>
      ))}
      {filters.length > 1 && (
        <button
          type="button"
          onClick={() => onChange([])}
          data-testid="filter-clear-all"
          className="min-h-control text-sm font-medium text-action underline-offset-2 hover:underline"
        >
          Clear All Filters
        </button>
      )}
      {onSaveView && (
        <button
          type="button"
          onClick={onSaveView}
          data-testid="filter-save-view"
          className="min-h-control text-sm font-medium text-action underline-offset-2 hover:underline"
        >
          Save As View
        </button>
      )}
    </div>
  )
}
