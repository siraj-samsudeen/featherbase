import { useState } from 'react'
import { choiceLabel } from 'shared'
import { LinkedTitle } from '../lib/row-name'
import { LinkControl } from './FormView'
import { NO_COLUMN_TYPES } from '../lib/meta'
import { NOT_A_LOGIN } from '../lib/not-a-login'
import { useI18n } from '../lib/i18n'
import { buttonClasses, inputClasses, pillClasses } from '@featherbase/shop-floor'

export type Filter = [string, string, unknown]

// Deliberately WITHOUT 'related' (NAV-002): the FilterBar's free-text value
// input cannot author a relationship spec, so offering the operator here
// could only produce malformed filters. Related filters arrive via links
// (Connections, Explore) and render as chips like any other filter.
const OPS = ['=', '!=', 'like', '>', '<', '>=', '<='] as const

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
  const columns = meta.columns
    .filter(
      (f) =>
        f.in_list_view &&
        !f.hidden &&
        (f.column_type === 'Choice' || STANDARD_TEXT_TYPES.has(f.column_type)),
    )
    .slice(0, 4)
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

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="standard-filters">
      {columns.map((f) =>
        f.column_type === 'Reference' && f.reference_table ? (
          // #793: a link filters by picking a row by its name, not by typing its id.
          <label key={f.column_name} className={FILTER_BOX}>
            <span className={FILTER_LABEL} title={f.label ?? f.column_name}>
              {f.label ?? f.column_name}
            </span>
            <span className="flex items-center gap-1 [&>div]:min-w-0 [&>div]:flex-1">
              <LinkControl
                field={f}
                value={current(f.column_name, '=')}
                onChange={(v) => apply(f.column_name, '=', String(v ?? ''))}
                className={inputClasses('text-ellipsis')}
                common={{ 'data-testid': `std-filter-${f.column_name}` }}
                forFilter
              />
              {current(f.column_name, '=') && (
                <button
                  type="button"
                  onClick={() => apply(f.column_name, '=', '')}
                  aria-label={`Clear the ${f.label ?? f.column_name} filter`}
                  data-testid={`std-filter-clear-${f.column_name}`}
                  className="px-1 text-ink-subtle hover:text-action"
                >
                  ×
                </button>
              )}
            </span>
          </label>
        ) : f.column_type === 'Choice' ? (
          <label key={f.column_name} className={FILTER_BOX}>
            <span className={FILTER_LABEL} title={f.label ?? f.column_name}>
              {f.label ?? f.column_name}
            </span>
            <select
              value={current(f.column_name, '=')}
              onChange={(e) => apply(f.column_name, '=', e.target.value)}
              data-testid={`std-filter-${f.column_name}`}
              className={inputClasses()}
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
          </label>
        ) : (
          <label key={f.column_name} className={FILTER_BOX}>
            <span className={FILTER_LABEL} title={f.label ?? f.column_name}>
              {f.label ?? f.column_name}
            </span>
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
              className={inputClasses('text-ellipsis')}
              {...NOT_A_LOGIN}
            />
          </label>
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

/** One filter as a person reads it (#792): its column as the list's heading
 *  names it, and a link compared with one row reads as that row's title. */
export function FilterWords({ meta, filter }: { meta: import('../lib/meta').TableMeta | undefined; filter: Filter }) {
  const { t } = useI18n()
  const [column, op, value] = filter
  const col = meta?.columns.find((c) => c.column_name === column)
  const label = column === 'row_id' ? 'Row ID' : t(col?.label ?? column)
  const linked =
    col?.column_type === 'Reference' && col.reference_table && (op === '=' || op === '!=') &&
    (typeof value === 'string' || typeof value === 'number') && String(value) !== ''
  return (
    <>
      {label} {op}{' '}
      {linked ? <LinkedTitle table={col.reference_base ?? col.reference_table!} rowId={String(value)} />
        : (op === '=' || op === '!=') && col?.column_type === 'Choice' ? choiceLabel(String(value), col.choice_labels, t)
        : filterValueLabel(op, value)}
    </>
  )
}

export function FilterBar({
  meta,
  filters,
  onChange,
  builderOpen = true,
}: {
  meta: import('../lib/meta').TableMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
  /** False leaves only the chips of the filters already applied (#1017). */
  builderOpen?: boolean
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

  function add() {
    if (!value.trim()) return
    const v = op === 'like' ? `%${value.trim()}%` : value.trim()
    onChange([...filters, [field, op, v]])
    setValue('')
  }

  return (
    <div className="mb-3">
      {builderOpen && <div className="flex flex-wrap items-center gap-2">
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
        </select>
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
          {OPS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {kind === 'link' ? (
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
      </div>}
      {filters.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${builderOpen ? 'mt-2' : ''}`} data-testid="filter-chips">
          {filters.map((f, i) => (
            <span
              key={i}
              className={pillClasses('bg-subtle text-ink gap-1 border border-border')}
              data-testid="filter-chip"
            >
              <FilterWords meta={meta} filter={f} />
              <button
                aria-label="Remove filter"
                onClick={() => onChange(filters.filter((_, j) => j !== i))}
                className="text-ink-subtle hover:text-ink"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
