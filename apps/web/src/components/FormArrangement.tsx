// #795: a row's fields arranged by importance, data type, filled first, links
// first or the Table's own order, in one or two columns, remembered for each
// person and Table in their server-side settings (beside the list's).
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { api } from '../lib/api'
import { ROW_STAMPS, linkRowsTable, type ColumnDef, type TableMeta } from '../lib/meta'
import { PrincipalLink } from '../lib/people'
import { formatValue, type Settings } from '../lib/settings'
import { RowTitle } from '../lib/row-titles'
import { RowLink } from '../lib/row-name'
import { useIsSystemManager } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { useNavigation } from '../lib/navigation'
import {
  buttonClasses, cardClasses, fmtDate, pillClasses,
  Braces, CalendarDays, ChevronDown, ChevronRight, Hash, Image, Link2, ToggleRight, Type, type LucideIcon,
} from '@featherbase/shop-floor'

export type Arrangement = 'importance' | 'type' | 'filled' | 'links' | 'source'
export const ARRANGEMENTS: [Arrangement, string][] = [
  ['importance', 'By importance'], ['type', 'By data type'], ['filled', 'Filled first'],
  ['links', 'Links first'], ['source', 'Source order'],
]
export type Columns = 1 | 2

export type Kind = 'text' | 'number' | 'yesno' | 'date' | 'link' | 'file' | 'json'
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
// A text value that names a file is shown as a file.
const FILE_PATH = /\.(png|jpe?g|gif|svg|webp|pdf|docx?|xlsx?|csv|txt)$/i
// What a source keeps about a row rather than facts about it: the same names
// reflect keeps out of a connected table's list (#796).
const BOOKKEEPING = /^(created|updated|modified|deleted)_(on|at|by|by_id|date)$/i
// Only unbounded text reads as long text; everything else holds to one line.
const LONG_TEXT = new Set(['Text', 'Long Text'])

export function kindOf(f: ColumnDef, value: unknown): Kind {
  const k = KIND_OF[f.column_type]
  if (k) return k
  return typeof value === 'string' && FILE_PATH.test(value) ? 'file' : 'text'
}
export const isEmpty = (v: unknown) => v === null || v === undefined || v === ''
// A connected column named like a platform column (updated_by) is stored
// under another name, so its label is checked too.
export const isBookkeeping = (f: ColumnDef) =>
  BOOKKEEPING.test(f.column_name) || BOOKKEEPING.test((f.label ?? '').trim().replace(/\s+/g, '_'))

interface StoredForm { mode?: Arrangement; columns?: Columns }
const MODES = new Set(ARRANGEMENTS.map(([m]) => m))

/** This person's arrangement for one Table, from their settings. A Table laid
 *  out in sections keeps its builder's order until they pick another; any
 *  other Table starts by importance. */
export function useFormArrangement(table: string, designed: boolean) {
  const queryClient = useQueryClient()
  const key = ['user-settings', table]
  const stored = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ settings: { form?: StoredForm } | null }>(`/api/user_settings/${encodeURIComponent(table)}`),
    retry: false,
    staleTime: Infinity,
  })
  const [chosen, setChosen] = useState<StoredForm>({})
  const saved = stored.data?.settings?.form ?? {}
  const mode = chosen.mode ?? (saved.mode && MODES.has(saved.mode) ? saved.mode : designed ? 'source' : 'importance')
  const columns: Columns = chosen.columns ?? (saved.columns === 1 ? 1 : 2)
  const update = (next: StoredForm) => {
    const form = { mode, columns, ...next }
    setChosen(form)
    queryClient.setQueryData(key, { settings: { ...(stored.data?.settings ?? {}), form } })
    // A save merges into the person's record, so the list's keys stay. A save
    // that fails leaves the choice for this visit only.
    api.put(`/api/user_settings/${encodeURIComponent(table)}`, { form }).catch(() => {})
  }
  return {
    ready: !stored.isPending,
    mode,
    columns,
    setMode: (m: Arrangement) => update({ mode: m }),
    setColumns: (c: Columns) => update({ columns: c }),
  }
}

/** #1267: a record's View menu, at the tab row's right end: how its fields
 *  are arranged and in how many columns. One button instead of a row of pills. */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

export function ViewMenu({ mode, columns, onMode, onColumns }: {
  mode: Arrangement; columns: Columns; onMode: (m: Arrangement) => void; onColumns: (c: Columns) => void
}) {
  const [open, setOpen] = useState(false)
  // #1267: fixed to the button's place, so a short record's scrolling area never clips the menu.
  const [at, setAt] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    const outside = (event: PointerEvent) => {
      const target = event.target as Element
      if (menu.current?.contains(target) || button.current?.contains(target)) return
      setOpen(false)
      // Focus goes back to View ▾, unless the click chose another control. After the
      // press's own default, which would otherwise move focus to the page's body.
      if (!target.closest?.(FOCUSABLE)) setTimeout(() => button.current?.focus())
    }
    // A fixed menu would drift from its button when the page moves: close it instead.
    const moved = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', moved, true)
    window.addEventListener('resize', moved)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', moved, true)
      window.removeEventListener('resize', moved)
    }
  }, [open])
  const toggle = () => {
    const box = button.current!.getBoundingClientRect()
    setAt({ top: box.bottom + 4, right: window.innerWidth - box.right })
    setOpen((was) => !was)
  }
  const close = () => { setOpen(false); button.current?.focus() }
  const on = 'bg-action-tint text-action'
  return (
    <div className="relative">
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={toggle} data-testid="view-menu-button"
        className={buttonClasses({ className: 'whitespace-nowrap px-2.5 py-1 text-xs' })}>View ▾</button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label="View" data-testid="view-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); return }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])
            const at = items.indexOf(document.activeElement as HTMLElement)
            items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
          }}
          style={{ top: at.top, right: at.right }}
          className={cardClasses('fixed z-30 w-60 p-1.5 shadow-lg')}>
          <div role="group" aria-label="Arrange Fields">
            <p aria-hidden className="px-2 pb-1 pt-1 text-xs text-ink-subtle">Arrange Fields</p>
            {ARRANGEMENTS.map(([m, label]) => (
              <button key={m} type="button" role="menuitemradio" aria-checked={mode === m} tabIndex={-1}
                onClick={() => { onMode(m); close() }} data-testid={`arrange-${m}`}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none ${mode === m ? 'font-medium text-ink' : 'text-ink'}`}>
                {label}{mode === m && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Columns" className="mt-1 flex items-center justify-between px-2 pb-1 pt-1.5">
            <span aria-hidden className="text-xs text-ink-subtle">Columns</span>
            <span className="inline-flex gap-0.5 rounded-md bg-subtle p-0.5">
              {([1, 2] as const).map((c) => (
                <button key={c} type="button" role="menuitemradio" aria-checked={columns === c} tabIndex={-1}
                  aria-label={c === 1 ? 'One column' : 'Two columns'}
                  onClick={() => { onColumns(c); close() }} data-testid={`arrange-columns-${c}`}
                  className={`min-w-8 rounded px-2 py-0.5 text-xs ${columns === c ? `${on} font-medium` : 'text-ink-muted'}`}>{c}</button>
              ))}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export interface FieldGroup {
  key: string
  heading?: string
  icon?: LucideIcon
  fields: ColumnDef[]
  /** The empty fields: a line that opens; starts closed when `folded`. */
  foldable?: boolean
  folded?: boolean
}

/** The fields in the chosen order, worked out from the SAVED row so a field
 *  never jumps between groups while the user types. Bookkeeping goes to the
 *  foot in every arrangement; the Table's own order is not arranged here. */
export function arrangeFields(
  fields: ColumnDef[], saved: Record<string, unknown>, meta: TableMeta, mode: Exclude<Arrangement, 'source'>, readOnly: boolean,
): { groups: FieldGroup[]; bookkeeping: ColumnDef[] } {
  const bookkeeping = fields.filter(isBookkeeping)
  const data = fields.filter((f) => !isBookkeeping(f) && f.column_type !== 'Column Break')
  const filled = data.filter((f) => !isEmpty(saved[f.column_name]))
  const empty = data.filter((f) => isEmpty(saved[f.column_name]))
  const isLink = (f: ColumnDef) => f.column_type === 'Reference'
  if (mode === 'importance') {
    // The row's name, then its links (how it sits among other rows), then
    // what is required, then the rest; the sort is stable, so Table order within.
    const rank = (f: ColumnDef) => (f.column_name === meta.title_column ? 0 : isLink(f) ? 1 : f.reqd ? 2 : 3)
    const emptyGroup: FieldGroup[] = empty.length
      ? [{ key: 'empty', heading: `${empty.length} empty field${empty.length === 1 ? '' : 's'}`, fields: empty, foldable: true, folded: readOnly }]
      : []
    return { groups: [{ key: 'main', fields: [...filled].sort((a, b) => rank(a) - rank(b)) }, ...emptyGroup], bookkeeping }
  }
  if (mode === 'filled')
    return {
      groups: [
        { key: 'filled', heading: `Filled (${filled.length})`, fields: filled },
        { key: 'empty', heading: `Empty (${empty.length})`, fields: empty },
      ],
      bookkeeping,
    }
  if (mode === 'links')
    return {
      groups: [
        { key: 'link', heading: 'Links to other rows', icon: Link2, fields: data.filter(isLink) },
        { key: 'rest', heading: 'Everything else', fields: data.filter((f) => !isLink(f)) },
      ],
      bookkeeping,
    }
  const byKind = new Map<Kind, ColumnDef[]>()
  for (const f of data) {
    const k = kindOf(f, saved[f.column_name])
    byKind.set(k, [...(byKind.get(k) ?? []), f])
  }
  return {
    groups: KIND_ORDER.filter((k) => byKind.has(k)).map((k) => ({ key: k, heading: KIND_LABEL[k], icon: KIND_ICON[k], fields: byKind.get(k)! })),
    bookkeeping,
  }
}

/** One group of fields; the empty fields open and close from their line. */
export function FieldGroupView({ group, columns, children }: { group: FieldGroup; columns: Columns; children: (f: ColumnDef) => ReactNode }) {
  const [open, setOpen] = useState(!group.folded)
  if (!group.fields.length) return null
  const Icon = group.icon
  const heading = (
    <>
      {Icon && <Icon size={14} aria-hidden />}
      {group.heading}
    </>
  )
  return (
    <section className="mb-3 last:mb-0" data-testid="field-group" data-group={group.key} aria-label={group.heading}>
      {group.heading && (group.foldable ? (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className="mb-1.5 flex min-h-11 items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-ink"
          data-testid="empty-fields-toggle">
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {heading}
        </button>
      ) : (
        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">{heading}</h3>
      ))}
      {open && (
        <div className={`grid grid-cols-1 gap-x-6 gap-y-4 ${columns === 2 ? '@2xl:grid-cols-2' : ''}`}>
          {group.fields.map((f) => children(f))}
        </div>
      )}
    </section>
  )
}

// The source table a column points at when no connected table binds it yet:
// the foreign key was recorded when the table was connected, and the column
// becomes a link as soon as its target is connected (#796).
export function unlinkedSourceTable(field: ColumnDef, meta: TableMeta): { table: string; key: string } | null {
  if (!meta.data_source || !field.source_fk_table || field.column_type === 'Reference') return null
  const schema = field.source_fk_schema ?? ''
  return { table: field.source_fk_table, key: schema ? `${schema}.${field.source_fk_table}` : field.source_fk_table }
}

/** #796: says a column's table isn't connected yet; offers a System Manager to connect it. */
export function UnlinkedNote({ id, field, meta }: { id: string; field: ColumnDef; meta: TableMeta }) {
  const canConnect = useIsSystemManager()
  const target = unlinkedSourceTable(field, meta)
  if (!target) return null
  return (
    <p id={id} className="mt-1 text-xs text-ink-subtle" data-testid={`unlinked-${field.column_name}`}>
      The {target.table} table is not connected yet, so this isn’t a link.
      {canConnect && (
        <>
          {' '}
          <RouterLink
            to="/featherbase/admin/source/$name"
            params={{ name: meta.data_source! }}
            search={{ connect: target.key }}
            className="text-action hover:underline"
          >
            Connect the {target.table} table
          </RouterLink>
        </>
      )}
    </p>
  )
}

/** A field on a row the user can only read: its value, shown by what it holds. */
export function ValueField({ field, value, meta, settings, columns }: {
  field: ColumnDef; value: unknown; meta: TableMeta; settings: Settings; columns: Columns
}) {
  const { t } = useI18n()
  const nav = useNavigation()
  const kind = kindOf(field, value)
  const Icon = KIND_ICON[kind]
  const id = useId()
  const labelId = `${id}-label`
  const noteId = `${id}-unlinked`
  const unlinked = Boolean(unlinkedSourceTable(field, meta))
  const long = LONG_TEXT.has(field.column_type) || kind === 'json'
  let shown: ReactNode
  if (isEmpty(value)) shown = <span className="text-ink-subtle">—</span>
  else if (kind === 'link' && field.reference_table) {
    // A link that names its Table always has one to read rows from.
    const target = linkRowsTable(field)!
    // #910: the linked row opens in the drill pane.
    const open = (e: MouseEvent) => {
      if (!nav || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      nav.push({ ...nav.step, pane: { table: target, row: String(value) } })
    }
    shown = <RowLink table={target} rowId={String(value)} onClick={open} withCode={false} />
  } else if (kind === 'yesno')
    shown = <span className={pillClasses(value ? 'bg-positive-tint text-positive' : 'bg-subtle text-ink-muted')}>{value ? 'Yes' : 'No'}</span>
  else if (kind === 'number') shown = formatValue(field.column_type, value, settings)
  else if (kind === 'file')
    shown = <span className="rounded bg-subtle px-2 py-0.5 text-xs text-ink-muted" title={String(value)}>{String(value).split('/').pop()}</span>
  else if (kind === 'json') shown = <code className="text-xs">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</code>
  // formatValue gives '' only for an empty value, handled above.
  else shown = formatValue(field.column_type, value, settings)
  const valueClasses = [
    'min-w-0 flex-1 text-sm text-ink',
    kind === 'number' ? 'font-mono tabular-nums' : '',
    long ? 'whitespace-pre-wrap break-words' : 'truncate whitespace-nowrap',
  ].join(' ')
  return (
    <div className={`min-w-0 border-b border-border pb-1.5 ${long && columns === 2 ? '@2xl:col-span-2' : ''}`}
      data-form-field={field.column_name} data-label={field.label ?? field.column_name} data-testid={`value-${field.column_name}`}>
      <div className={`flex min-w-0 gap-3 ${long ? 'flex-col gap-1' : 'items-baseline'}`}>
        <span className={`flex shrink-0 items-center gap-1.5 text-sm text-ink-muted ${long ? '' : 'w-2/5'}`}>
          <Icon size={14} className="shrink-0 text-ink-subtle" aria-hidden data-type-mark={kind} />
          <span id={labelId} className="truncate">{t(field.label ?? field.column_name)}</span>
        </span>
        <span role="group" aria-labelledby={labelId} aria-describedby={unlinked ? noteId : undefined}
          className={valueClasses} data-value={kind} title={long || typeof shown !== 'string' ? undefined : shown}>
          {shown}
        </span>
      </div>
      <UnlinkedNote id={noteId} field={field} meta={meta} />
    </div>
  )
}

/** The day of an instant on the viewer's own clock, DD-Mon-YYYY. */
function stampDay(value: unknown): string {
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return fmtDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
}

/** "Created 04-Nov-2026 by Asha, updated 05-Nov-2026 by Ravi": the row's
 *  own stamps (ROW_STAMPS, as the reading presentation names them). */
function RowStamps({ values, table }: { values: Record<string, unknown>; table?: string }) {
  const parts = (['created_at', 'updated_at'] as const).flatMap((at) => {
    const day = isEmpty(values[at]) ? '' : stampDay(values[at])
    if (!day) return []
    const by = values[ROW_STAMPS[at].by]
    return [{ at, day, by: isEmpty(by) ? null : String(by) }]
  })
  return <>{parts.map((p, i) => (
    <span key={p.at}>
      {i > 0 && ', '}
      {i > 0 ? ROW_STAMPS[p.at].label.toLowerCase() : ROW_STAMPS[p.at].label} {p.day}
      {p.by && <> by <PrincipalLink id={p.by} actorOf={table} /></>}
    </span>
  ))}</>
}

/** Who stamped a row. A person is a record, so a link to their Person row for
 *  a viewer who may open it (#1253: every record is a link); a service account
 *  or a system step is read as its name. */

/** When the row was created and changed, and by whom, on one quiet line:
 *  the platform's stamps, then any bookkeeping columns a source keeps. */
export function BookkeepingLine({ table, fields, values, settings }: { table?: string; fields: ColumnDef[]; values: Record<string, unknown>; settings: Settings }) {
  const { t } = useI18n()
  const shown = fields.filter((f) => !isEmpty(values[f.column_name]))
  const stamped = !isEmpty(values.created_at) || !isEmpty(values.updated_at)
  if (!shown.length && !stamped) return null
  return (
    <p className="mt-3 border-t border-border pt-2 text-xs text-ink-subtle" data-testid="bookkeeping-line">
      {stamped && <RowStamps values={values} table={table} />}
      {shown.map((f, i) => (
        <span key={f.column_name}>
          {(i > 0 || stamped) && ' · '}
          {t(f.label ?? f.column_name)}{' '}
          <span className="text-ink-muted">
            {f.column_type === 'Reference' && f.reference_table
              ? <RowTitle table={linkRowsTable(f)!} rowId={String(values[f.column_name])} />
              : formatValue(f.column_type, values[f.column_name], settings)}
          </span>
        </span>
      ))}
    </p>
  )
}
