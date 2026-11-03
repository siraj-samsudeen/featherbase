// Prototype (#795): a form's fields arranged by importance,
// data type, filled status, links, or the Table's own order, in one or two
// columns, remembered per person and Table in this browser.
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { ColumnDef, TableMeta } from '../lib/meta'
import { formatValue, type Settings } from '../lib/settings'
import { RowTitle } from '../lib/row-titles'
import { buttonClasses } from './ui'
import { pillClasses } from './ui/StatusPill'
import {
  Braces, CalendarDays, ChevronDown, ChevronRight, Hash, Image, Link2, ToggleRight, Type, type LucideIcon,
} from './ui/icons'

export type Arrangement = 'importance' | 'type' | 'filled' | 'links' | 'source'
export const ARRANGEMENTS: [Arrangement, string][] = [
  ['importance', 'By importance'], ['type', 'By data type'], ['filled', 'Filled first'],
  ['links', 'Links first'], ['source', 'Source order'],
]

type Kind = 'text' | 'number' | 'yesno' | 'date' | 'link' | 'file' | 'json'
const KIND_OF: Record<string, Kind> = {
  Int: 'number', Float: 'number', Currency: 'number', Percent: 'number',
  Check: 'yesno', Date: 'date', Datetime: 'date', Time: 'date',
  Reference: 'link', Attach: 'file', 'Attach Image': 'file', JSON: 'json',
}
const KIND_LABEL: Record<Kind, string> = {
  text: 'Text', number: 'Numbers', yesno: 'Yes or no', date: 'Dates', link: 'Links', file: 'Files', json: 'Structured data',
}
const KIND_ICON: Record<Kind, LucideIcon> = {
  text: Type, number: Hash, yesno: ToggleRight, date: CalendarDays, link: Link2, file: Image, json: Braces,
}
const KIND_ORDER: Kind[] = ['text', 'number', 'yesno', 'date', 'file', 'link', 'json']
// A text value that names an image file is shown as a file.
const FILE_PATH = /\.(png|jpe?g|gif|svg|webp|pdf)$/i
// Bookkeeping a source keeps about a row rather than facts about it.
const BOOKKEEPING = /^(created|updated|modified|deleted)_(on|at|by|by_id|date)$/i

export function kindOf(f: ColumnDef, value: unknown): Kind {
  const k = KIND_OF[f.column_type]
  if (k) return k
  return typeof value === 'string' && FILE_PATH.test(value) ? 'file' : 'text'
}
const isEmpty = (v: unknown) => v === null || v === undefined || v === ''
export const isBookkeeping = (f: ColumnDef) => BOOKKEEPING.test(f.column_name)

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage refused: the choice lasts this visit only */
  }
}

/** This person's arrangement for one Table. A Table laid out in sections
 *  keeps its builder's order by default; any other starts by importance. */
export function useFormArrangement(table: string, designed: boolean) {
  const key = `featherbase.form-arrangement.${table}`
  // mode null = no choice made: the default follows the Table, known only once its meta loads.
  const [state, setState] = useState(() => read(key, { mode: null as Arrangement | null, columns: 2 as 1 | 2 }))
  const update = (next: Partial<typeof state>) => {
    const merged = { ...state, ...next }
    setState(merged)
    write(key, merged)
  }
  return {
    mode: state.mode ?? (designed ? 'source' : 'importance'),
    columns: state.columns,
    setMode: (mode: Arrangement) => update({ mode }),
    setColumns: (columns: 1 | 2) => update({ columns }),
  }
}

export function ArrangeBar({ mode, columns, onMode, onColumns }: {
  mode: Arrangement; columns: 1 | 2; onMode: (m: Arrangement) => void; onColumns: (c: 1 | 2) => void
}) {
  const on = 'border-action bg-action-tint text-action'
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-sm" data-testid="arrange-bar">
      <span className="mr-1 text-xs text-ink-subtle">Arrange by</span>
      {ARRANGEMENTS.map(([m, label]) => (
        <button key={m} type="button" onClick={() => onMode(m)} aria-pressed={mode === m}
          className={buttonClasses({ className: `px-2.5 py-1 text-xs ${mode === m ? on : ''}` })}
          data-testid={`arrange-${m}`}>{label}</button>
      ))}
      <span className="ml-3 mr-1 text-xs text-ink-subtle">Columns</span>
      {([1, 2] as const).map((c) => (
        <button key={c} type="button" onClick={() => onColumns(c)} aria-pressed={columns === c}
          className={buttonClasses({ className: `px-2.5 py-1 text-xs ${columns === c ? on : ''}` })}
          data-testid={`arrange-columns-${c}`}>{c}</button>
      ))}
    </div>
  )
}

export interface FieldGroup { heading?: string; icon?: LucideIcon; fields: ColumnDef[]; folded?: boolean }

/** The fields in the chosen order. Empty fields fold away on a read-only row;
 *  bookkeeping goes to the footer in every arrangement but the source order. */
export function arrangeFields(
  fields: ColumnDef[], values: Record<string, unknown>, meta: TableMeta, mode: Arrangement, readOnly: boolean,
): { groups: FieldGroup[]; bookkeeping: ColumnDef[] } {
  if (mode === 'source') return { groups: [{ fields }], bookkeeping: [] }
  const bookkeeping = fields.filter(isBookkeeping)
  const data = fields.filter((f) => !isBookkeeping(f) && f.column_type !== 'Column Break')
  const filled = data.filter((f) => !isEmpty(values[f.column_name]))
  const empty = data.filter((f) => isEmpty(values[f.column_name]))
  const emptyGroup: FieldGroup[] = empty.length
    ? [{ heading: `${empty.length} empty field${empty.length === 1 ? '' : 's'}`, fields: empty, folded: readOnly }]
    : []
  // The row's name, then its links (how it sits among other rows), then
  // what the source requires, then the rest.
  const rank = (f: ColumnDef) =>
    f.column_name === meta.title_column ? 0 : f.column_type === 'Reference' ? 1 : f.reqd ? 2 : 3
  if (mode === 'importance')
    return { groups: [{ fields: [...filled].sort((a, b) => rank(a) - rank(b)) }, ...emptyGroup], bookkeeping }
  if (mode === 'filled')
    return { groups: [{ heading: `Filled (${filled.length})`, fields: filled }, { heading: `Empty (${empty.length})`, fields: empty }], bookkeeping }
  if (mode === 'links') {
    const links = data.filter((f) => f.column_type === 'Reference')
    return {
      groups: [
        { heading: 'Links to other tables', icon: Link2, fields: links },
        { heading: 'Everything else', fields: filled.filter((f) => f.column_type !== 'Reference') },
        ...(empty.some((f) => f.column_type !== 'Reference')
          ? [{ ...emptyGroup[0], fields: empty.filter((f) => f.column_type !== 'Reference') }] : []),
      ],
      bookkeeping,
    }
  }
  const byKind = new Map<Kind, ColumnDef[]>()
  for (const f of data) byKind.set(kindOf(f, values[f.column_name]), [...(byKind.get(kindOf(f, values[f.column_name])) ?? []), f])
  return {
    groups: KIND_ORDER.filter((k) => byKind.has(k)).map((k) => ({ heading: KIND_LABEL[k], icon: KIND_ICON[k], fields: byKind.get(k)! })),
    bookkeeping,
  }
}

/** One group of fields; a folded group opens on click. */
export function FieldGroupView({ group, columns, children }: { group: FieldGroup; columns: 1 | 2; children: (f: ColumnDef) => ReactNode }) {
  const [open, setOpen] = useState(!group.folded)
  if (!group.fields.length) return null
  const Icon = group.icon
  return (
    <div className="mb-3" data-testid="field-group">
      {group.heading && (
        <button type="button" onClick={() => group.folded !== undefined && setOpen(!open)}
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
          {group.folded !== undefined && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          {Icon && <Icon size={14} />}
          {group.heading}
        </button>
      )}
      {open && (
        <div className={`grid grid-cols-1 gap-x-6 ${columns === 2 ? 'md:grid-cols-2' : ''}`}>
          {group.fields.map((f) => children(f))}
        </div>
      )}
    </div>
  )
}

/** A read-only field as a value, styled by what it holds. */
export function ValueField({ field, value, settings }: { field: ColumnDef; value: unknown; settings: Settings }) {
  const kind = kindOf(field, value)
  const Icon = KIND_ICON[kind]
  let shown: ReactNode
  if (isEmpty(value)) shown = <span className="text-ink-subtle">—</span>
  else if (kind === 'link' && field.reference_table)
    shown = (
      <Link to="/featherbase/admin/$table/$name" params={{ table: field.reference_table, name: String(value) }}
        search={{ prefill: undefined }} className="text-action hover:underline">
        <RowTitle table={field.reference_table} rowId={String(value)} />
      </Link>
    )
  else if (kind === 'yesno')
    shown = <span className={pillClasses(value ? 'bg-positive-tint text-positive' : 'bg-subtle text-ink-muted')}>{value ? 'Yes' : 'No'}</span>
  else if (kind === 'number') shown = <span className="font-mono text-[13px]">{formatValue(field.column_type, value, settings)}</span>
  else if (kind === 'file')
    shown = <span className="rounded bg-subtle px-2 py-0.5 text-xs text-ink-muted">{String(value).split('/').pop()}</span>
  else if (kind === 'json') shown = <code className="text-xs">{JSON.stringify(value)}</code>
  else shown = formatValue(field.column_type, value, settings) || String(value)
  return (
    <div className="flex min-w-0 items-baseline gap-3 border-b border-border py-1.5" data-testid={`value-${field.column_name}`}>
      <span className="flex w-2/5 shrink-0 items-center gap-1.5 text-sm text-ink-muted">
        <Icon size={14} className="shrink-0 text-ink-subtle" aria-hidden />
        <span className="truncate">{field.label ?? field.column_name}</span>
      </span>
      <span className="min-w-0 truncate text-sm text-ink">{shown}</span>
    </div>
  )
}

/** Created and updated, on one quiet line. */
export function BookkeepingLine({ fields, values, settings }: { fields: ColumnDef[]; values: Record<string, unknown>; settings: Settings }) {
  const shown = fields.filter((f) => !isEmpty(values[f.column_name]))
  if (!shown.length) return null
  return (
    <p className="mt-2 border-t border-border pt-2 text-xs text-ink-subtle" data-testid="bookkeeping-line">
      {shown.map((f, i) => (
        <span key={f.column_name}>
          {i > 0 && ' · '}
          {f.label ?? f.column_name}{' '}
          {f.column_type === 'Reference' && f.reference_table
            ? <RowTitle table={f.reference_table} rowId={String(values[f.column_name])} />
            : formatValue(f.column_type, values[f.column_name], settings) || String(values[f.column_name])}
        </span>
      ))}
    </p>
  )
}
