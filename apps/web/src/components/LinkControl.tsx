import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link as RouterLink, useNavigate } from '@tanstack/react-router'
import { api, listResource } from '../lib/api'
import { NOT_A_LOGIN } from '../lib/not-a-login'
import { pickerFor } from '../lib/pickers'
import { principalLabel, usePrincipalName } from '../lib/people'
import { UNSEEN_ROW, useLinkTitle } from '../lib/relations'
import { useMeta, type ColumnDef, type TableMeta } from '../lib/meta'
import { useNavigation } from '../lib/navigation'
import { ChevronDown } from '@featherbase/shop-floor'

/** The target Table's title column, when it is one of its columns the
 *  caller may read: a column the caller was not granted can be
 *  neither searched nor shown, and a title that is the row key itself (a
 *  Table named by its id) is already what row_id shows. */
function readableTitleColumn(meta: TableMeta | undefined): string | undefined {
  const title = meta?.title_column
  const column = title ? meta.columns.find((c) => c.column_name === title) : undefined
  if (!column || (meta?.readable_columns && !meta.readable_columns.includes(column.column_name))) return undefined
  return column.column_name
}

/** What a Table column of a link to a row of any Table offers: stored Tables
 *  only, and of those only the ones its row columns allow, when they list any. */
export function anyTableFilters(rows: ColumnDef[]): unknown[] {
  const lists = rows.map((row) => (row.choices ?? '').split('\n').map((name) => name.trim()).filter(Boolean))
  const allowed = lists.some((list) => !list.length) ? null : [...new Set(lists.flat())]
  return [['kind', '=', 'table'], ...(allowed ? [['row_id', 'in', allowed]] : [])]
}

// UI-006: debounced autocomplete over the permission-filtered list API.
export function LinkControl({
  field,
  value,
  onChange,
  className,
  common,
  forFilter = false,
  floating = false,
  extraFilters = [],
  anyTable = false,
}: {
  field: ColumnDef
  value: unknown
  onChange: (value: unknown) => void
  className: string
  common: Record<string, unknown>
  /** A list filter: it only picks existing rows, never creates one. */
  forFilter?: boolean
  /** Inside a scrolling frame (a grid of nested rows): the list is placed
   *  over the page under the box, so the frame cannot cut it off. */
  floating?: boolean
  /** Filters every search carries besides the picker's own (#881). */
  extraFilters?: unknown[]
  /** A link to a row of any Table: a row of a Table the person can't read
   *  is shown as "<Table> (no access)", and is not a place to go (#881). */
  anyTable?: boolean
}) {
  const target = field.reference_table ?? ''
  // #1021: a link to a view picks among the view's rows, but its value is a
  // row of the base: it is named, shown and opened there, even once it has
  // left the view.
  const rowsTable = field.reference_base ?? target
  const box = useRef<HTMLInputElement>(null)
  const searchBox = useRef<HTMLInputElement>(null)
  // A click means "show me the list": the typing goes to its search box (#1019).
  // Tabbing in stays on the box, so the keyboard walks a form as before.
  const clicked = useRef(false)
  const listBox = useRef<HTMLDivElement>(null)
  // Focus handed back to the box from its list is not a new search (#1019).
  const handingBack = useRef(false)
  function backToBox() {
    clearTimeout(timer.current)
    searchVersion.current++
    handingBack.current = true
    box.current?.focus()
    handingBack.current = false
  }
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null)
  // #793: a Table with no picker of its own is searched and shown by its
  // title column, never by its row id — only when the caller may read that
  // column; otherwise it stays searched and shown by row id.
  const targetMeta = useMeta(target)
  const own = pickerFor(target)
  const title = readableTitleColumn(targetMeta.data)
  const picker = own.labelField === null && own.searchField === 'row_id' && !own.peopleSearch && title
    ? { ...own, searchField: title, labelField: title }
    : own
  const [query, setQuery] = useState<string | null>(null) // null = not searching
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  // An opaque id (a person's `psn_…`) is shown by its name.
  const current = useQuery({
    queryKey: ['link-label', rowsTable, String(value ?? '')],
    enabled: Boolean(picker.labelField) && !picker.peopleSearch && Boolean(value),
    queryFn: () => api.get<Record<string, unknown>>(`/api/table/${encodeURIComponent(rowsTable)}/${encodeURIComponent(String(value))}`),
  })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const searchVersion = useRef(0)
  useEffect(() => () => {
    clearTimeout(timer.current)
    clearTimeout(blurTimer.current)
    searchVersion.current++
  }, [])
  // #910: a set reference is a place you can go — ◎ shows the row in the
  // drill pane, ↗ navigates to its form. Hidden while searching.
  const nav = useNavigation()
  const navigate = useNavigate()
  // A filter has its own clear control and stays a filter: no pane or open.
  const hasValue = Boolean(value) && query === null && !forFilter && !(anyTable && targetMeta.isError)

  // The floating list is placed once, beside the box; scrolling the page or
  // resizing would leave it behind, so either closes it.
  useEffect(() => {
    if (!floating || !open) return
    // The list's own scrolling isn't the page moving away from it.
    const close = (event: Event) => {
      if (event.target instanceof Node && listBox.current?.contains(event.target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [floating, open])

  useEffect(() => {
    if (open && clicked.current && query === null) searchBox.current?.focus()
    clicked.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function openList() {
    const rect = floating ? box.current?.getBoundingClientRect() : undefined
    if (rect) {
      // Scrolling closes the list, so it has to fit in the window where it opens.
      const below = window.innerHeight - rect.bottom - 8
      const above = rect.top - 8
      const across = { left: rect.left, width: Math.max(rect.width, 224) }
      setPlace(below < 240 && above > below
        ? { ...across, bottom: window.innerHeight - rect.top + 4, maxHeight: above }
        : { ...across, top: rect.bottom + 4, maxHeight: below })
    } else {
      setPlace(null)
    }
    setOpen(true)
  }

  // A click can beat the target's details here: the search reads the picker as
  // it is by then, and runs again if the name column arrives after it.
  const latestPicker = useRef(picker)
  latestPicker.current = picker
  useEffect(() => {
    if (open) search(query ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker.labelField])

  function search(q: string) {
    const version = ++searchVersion.current
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const picker = latestPicker.current
      try {
        if (picker.peopleSearch) {
          // Name, @username, address or employee code — never the id.
          const res = await api.get<{ people: { row_id: string; label: string }[] }>(`/api/people/pick?q=${encodeURIComponent(q)}`)
          if (version !== searchVersion.current) return
          setOptions(res.people.map((p) => ({ value: p.row_id, label: p.label })))
          openList()
          return
        }
        const label = picker.labelField
        const res = await listResource<Record<string, unknown> & { row_id: string }>(target, {
          filters: [...picker.filters, ...extraFilters, ...(q ? [[picker.searchField, 'like', `%${q}%`]] : [])],
          fields: label ? ['row_id', label] : ['row_id'],
          // #1019: by the name shown. Row ids alone keep the list's own fast order.
          ...(label ? { order_by: `${label} asc` } : {}),
          limit_page_length: 10,
        })
        if (version !== searchVersion.current) return
        setOptions(res.data.map((r) => ({ value: r.row_id, label: label ? String(r[label] ?? '') || r.row_id : r.row_id })))
        openList()
      } catch {
        if (version === searchVersion.current) setOptions([])
      }
    }, 150)
  }

  const principalName = usePrincipalName(picker.peopleSearch && value ? String(value) : null)
  const valueLabel = picker.peopleSearch
    ? value ? principalLabel(String(value), principalName, principalName === null) : null
    : picker.labelField && current.data ? String(current.data[picker.labelField] ?? '') || null : null
  // #881: the Table is the reader's only clue; the row's name stays private.
  const noAccess = anyTable && Boolean(value) && targetMeta.isError
  // #910 D3: a row the viewer cannot read is named neutrally, never by its id,
  // and offers no way to it.
  const linked = useLinkTitle(!picker.peopleSearch && value && target ? rowsTable : undefined, value ? String(value) : undefined)
  const unseen = !picker.peopleSearch && Boolean(value) && !noAccess && linked.state === 'unreadable'
  const shown = query ?? (noAccess ? `${target} (no access)` : null) ?? (unseen ? UNSEEN_ROW : valueLabel ?? String(value ?? ''))

  // A link the person cannot see is not theirs to change: neutral words, no
  // box and no picker, and the stored link is saved as it was.
  if (unseen && !forFilter)
    return (
      <div id={typeof common.id === 'string' ? common.id : undefined} aria-label={typeof common['aria-label'] === 'string' ? common['aria-label'] : undefined}
        className="flex min-h-9 items-center text-sm italic text-ink-muted" data-testid={`link-unseen-${field.column_name}`}>
        {UNSEEN_ROW}
      </div>
    )

  // #1019: the arrows walk the list and Escape closes it; Tab leaves the box for
  // the next field, so the list's own controls are off the Tab order.
  function moveThroughList(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      // A grid's arrows move between its cells.
      if (event.key === 'ArrowDown' && !floating) search(query ?? '')
      return
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      setOpen(false)
      // Whatever was being searched for was never picked.
      setQuery(null)
      backToBox()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-testid="link-option"],[data-testid="link-create-new"]')]
      const at = items.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'ArrowDown' ? at + 1 : at - 1
      if (next >= items.length) return
      if (next < 0) searchBox.current?.focus()
      else items[next].focus()
    }
  }

  function leave() {
    // A search still waiting must not reopen the list on a cell left behind.
    clearTimeout(timer.current)
    searchVersion.current++
    clearTimeout(blurTimer.current)
    blurTimer.current = setTimeout(() => {
      setOpen(false)
      // A filter shows only what it filters by, and a grid cell what will
      // be saved: text typed but never picked goes.
      if (forFilter || floating) setQuery(null)
    }, 150)
  }

  return (
    <div className="relative" onKeyDown={moveThroughList}>
      <input
        ref={box}
        type="text"
        role="combobox"
        aria-expanded={open}
        placeholder={forFilter ? `Filter ${field.label ?? field.column_name}…` : `Reference: ${target}`}
        value={shown}
        onMouseDown={() => { clicked.current = true }}
        // Focus doesn't fire again on a box that kept it, as after Escape.
        onClick={() => { if (!open) search(query ?? (picker.labelField ? '' : shown)) }}
        onFocus={() => {
          clearTimeout(blurTimer.current)
          if (!handingBack.current) search(query ?? (picker.labelField ? '' : shown))
        }}
        onBlur={leave}
        onChange={(e) => {
          setQuery(e.target.value)
          // In a grid, emptying the cell removes the link (Codex on #874);
          // other typed text still has to be picked.
          if (floating && e.target.value === '') onChange(null)
          search(e.target.value)
        }}
        className={`${className} ${hasValue && !unseen ? 'pr-14' : 'pr-8'}`}
        {...NOT_A_LOGIN}
        {...common}
      />
      {/* It reads as a picker, not a box to know the value for (#1019). */}
      {!(hasValue && !unseen) && (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-ink-subtle" data-testid={`link-chevron-${field.column_name}`}>
          <ChevronDown aria-hidden size={16} />
        </span>
      )}
      {hasValue && !unseen && (
        <span className="absolute inset-y-0 right-2 flex items-center gap-0.5">
          {nav && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault()
                nav.push({ ...nav.step, pane: { table: rowsTable, row: String(value) } })
              }}
              title="Show in the pane"
              data-testid={`link-pane-${field.column_name}`}
              className="rounded px-1 text-sm text-ink-subtle hover:text-action"
            >
              ◎
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault()
              navigate({
                to: '/featherbase/admin/table/$table/row/$name',
                params: { table: rowsTable, name: String(value) },
                search: { prefill: undefined },
              })
            }}
            title="Open row page"
            data-testid={`link-open-${field.column_name}`}
            className="rounded px-1 text-sm text-ink-subtle hover:text-action"
          >
            ↗
          </button>
        </span>
      )}
      {open && (
        <div
          ref={listBox}
          // Off the Tab order, which a browser otherwise gives a list that scrolls.
          tabIndex={-1}
          className={place
            ? 'fixed z-30 overflow-y-auto rounded-md border border-border bg-surface shadow-lg'
            : 'absolute z-10 mt-1 max-h-80 w-full min-w-56 overflow-y-auto rounded-md border border-border bg-surface shadow-lg'}
          style={place ?? undefined}
          onFocus={() => clearTimeout(blurTimer.current)}
          onBlur={leave}
          data-testid={`link-options-${field.column_name}`}
        >
          <input
            ref={searchBox}
            type="search"
            aria-label={`Search ${field.label ?? field.column_name}`}
            placeholder="Search…"
            value={query ?? ''}
            tabIndex={-1}
            onChange={(e) => {
              setQuery(e.target.value)
              search(e.target.value)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
            data-testid="link-search"
            className="sticky top-0 block w-full border-b border-border bg-surface px-3 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
            {...NOT_A_LOGIN}
          />
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              tabIndex={-1}
              onMouseDown={() => {
                onChange(o.value)
                setQuery(null)
                setOpen(false)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                onChange(o.value)
                setQuery(null)
                setOpen(false)
                backToBox()
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
              data-testid="link-option"
            >
              {o.label}
            </button>
          ))}
          {!options.length && (
            <p className="px-3 py-1.5 text-sm text-ink-subtle">No matches</p>
          )}
          {/* A Table column of a link to any Table picks among Tables; it never makes one (#881). */}
          {/* A view holds no rows to create (#1021). */}
          {/* A new tab keeps what was typed on this form (#1033). */}
          {!forFilter && !extraFilters.length && !field.reference_base && (
            <RouterLink
              to="/featherbase/admin/table/$table/new"
              params={{ table: target }}
              search={{ prefill: undefined }}
              target="_blank"
              rel="noopener"
              tabIndex={-1}
              className="block border-t border-border px-3 py-1.5 text-sm text-ink-muted hover:bg-subtle"
              data-testid="link-create-new"
            >
              + Create new {target}
            </RouterLink>
          )}
        </div>
      )}
    </div>
  )
}
