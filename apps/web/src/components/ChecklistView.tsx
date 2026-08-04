import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { ApiError, api, getToken, listResource } from '../lib/api'
import { isSourceReadOnly, useMeta, type ColumnDef, type TableMeta } from '../lib/meta'

type Row = Record<string, unknown>

// Checklist view: a tap-first execution surface for any Table with checklist
// shape — a Sub-table column whose row table carries a Check column. Like
// Kanban binds "the Choice column to group by", this view binds by shape and
// column-name convention, all read from metadata (no per-model code):
//
//   done column   — the Check named `done`, else the row table's first Check
//   item label    — the row table's first Data/Text column
//   must_do / photo_proof / note / done_at — optional enrichments, bound by
//   those names when present (must-do badge, camera chip, excuse note, tick
//   timestamp)
//   status / date / progress — the parent's first Choice column drives the
//   footer action (advance to the next choice), the first Date column groups
//   the run list, and a Data column named `progress` ("5/8") fills the bars.
//
// Without a selected run it lists runs as date-grouped cards; selecting one
// opens its items with whole-row tap targets. Every tick is one save_doc
// call (the payload-authoritative child array), so the server hook chain
// stamps timestamps, derives progress, and enforces submit gates — the view
// renders whatever comes back, including the 417 message when a gate blocks.
export function ChecklistView({
  doctype,
  run,
  onRunChange,
}: {
  doctype: string
  run?: string
  onRunChange?: (run: string | undefined) => void
}) {
  const meta = useMeta(doctype)
  const shape = useChecklistShape(meta.data)
  if (meta.isLoading || (shape.pending && !shape.binding))
    return <p className="text-sm text-gray-400">Loading…</p>
  if (!shape.binding)
    return (
      <p className="text-sm text-[var(--color-ink-muted)]" data-testid="checklist-no-shape">
        This Table has no checklist-shaped Sub-table (a row table with a Check column).
      </p>
    )
  return run ? (
    <RunPane doctype={doctype} name={run} binding={shape.binding} onBack={() => onRunChange?.(undefined)} />
  ) : (
    <RunList doctype={doctype} binding={shape.binding} onOpen={(n) => onRunChange?.(n)} />
  )
}

// ListView's view-switcher button — rendered only when the Table actually
// has checklist shape, the same conditional pattern Kanban applies to
// Choice columns (the check needs the row table's meta, hence a component
// with hooks rather than an inline condition).
export function ChecklistSwitch({ doctype, meta }: { doctype: string; meta?: TableMeta }) {
  const shape = useChecklistShape(meta)
  if (!shape.binding) return null
  return (
    <RouterLink
      to="/admin/$doctype/view/checklist"
      params={{ doctype }}
      search={{ run: undefined }}
      className="fc-btn"
      data-testid="open-checklist"
    >
      Checklist
    </RouterLink>
  )
}

interface Binding {
  itemsCol: string
  childTable: string
  doneCol: string
  labelCol: string
  mustCol?: string
  photoCol?: string
  noteCol?: string
  titleCol: string
  statusCol?: ColumnDef
  dateCol?: string
  progressCol?: string
  readOnly: boolean
}

// Resolve the checklist binding from parent + child metadata. Child meta
// loads lazily, so callers get `pending` until both are in.
function useChecklistShape(meta: TableMeta | undefined): {
  pending: boolean
  binding: Binding | null
} {
  const subCols = (meta?.columns ?? []).filter((f) => f.column_type === 'Sub-table' && f.row_table)
  // Bind the first Sub-table column whose row table qualifies. One extra
  // meta fetch per candidate — tables rarely carry more than one or two.
  // Same queryKey as useMeta so the cache is shared; gated so an absent
  // candidate fetches nothing.
  const useChildMeta = (t?: string) =>
    useQuery({
      queryKey: ['meta', t ?? ''],
      enabled: Boolean(t),
      queryFn: () => api.get<TableMeta>(`/api/table/${encodeURIComponent(t!)}:meta`),
      staleTime: 60_000,
    })
  const child0 = useChildMeta(subCols[0]?.row_table ?? undefined)
  const child1 = useChildMeta(subCols[1]?.row_table ?? undefined)
  const children = [child0, child1].slice(0, subCols.length)
  return useMemo(() => {
    if (!meta) return { pending: true, binding: null }
    if (children.some((c) => c.isLoading)) return { pending: true, binding: null }
    for (const [i, sub] of subCols.entries()) {
      const childMeta = children[i]?.data
      if (!childMeta) continue
      const checks = childMeta.columns.filter((f) => f.column_type === 'Check')
      const done = checks.find((f) => f.column_name === 'done') ?? checks[0]
      const label = childMeta.columns.find((f) => ['Data', 'Text'].includes(f.column_type))
      if (!done || !label) continue
      const named = (n: string, types: string[]) =>
        childMeta.columns.find((f) => f.column_name === n && types.includes(f.column_type))?.column_name
      return {
        pending: false,
        binding: {
          itemsCol: sub.column_name,
          childTable: sub.row_table!,
          doneCol: done.column_name,
          labelCol: label.column_name,
          mustCol: named('must_do', ['Check']),
          photoCol: named('photo_proof', ['Check']),
          noteCol: named('note', ['Data', 'Text']),
          titleCol: meta.title_column || 'name',
          statusCol: meta.columns.find((f) => f.column_type === 'Choice'),
          dateCol: meta.columns.find((f) => f.column_type === 'Date')?.column_name,
          progressCol: meta.columns.find(
            (f) => f.column_name === 'progress' && f.column_type === 'Data',
          )?.column_name,
          readOnly: isSourceReadOnly(meta),
        },
      }
    }
    return { pending: false, binding: null }
  }, [meta, child0.data, child1.data, child0.isLoading, child1.isLoading])
}

function progressParts(v: unknown): { done: number; total: number } | null {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(v ?? ''))
  return m ? { done: Number(m[1]), total: Number(m[2]) } : null
}

function dayLabel(iso: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  if (iso === today) return 'Today'
  if (iso === yesterday) return 'Yesterday'
  return iso || 'Undated'
}

// ---------------------------------------------------------------- run list
function RunList({
  doctype,
  binding,
  onOpen,
}: {
  doctype: string
  binding: Binding
  onOpen: (name: string) => void
}) {
  const fields = [
    ...new Set(
      [
        'name',
        'updated_at',
        binding.titleCol,
        binding.statusCol?.column_name,
        binding.dateCol,
        binding.progressCol,
      ].filter((f): f is string => Boolean(f)),
    ),
  ]
  const rows = useQuery({
    queryKey: ['checklist-list', doctype],
    queryFn: () =>
      // order_by takes a single column; recency within a day sorts below.
      listResource<Row>(doctype, {
        fields,
        order_by: binding.dateCol ? `${binding.dateCol} desc` : 'updated_at desc',
        limit_page_length: 100,
      }),
  })
  const data = [...(rows.data?.data ?? [])].sort((a, b) => {
    const day =
      binding.dateCol
        ? String(b[binding.dateCol] ?? '').localeCompare(String(a[binding.dateCol] ?? ''))
        : 0
    return day !== 0 ? day : String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))
  })
  const groups = new Map<string, Row[]>()
  for (const row of data) {
    const key = binding.dateCol ? String(row[binding.dateCol] ?? '').slice(0, 10) : ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  return (
    <div data-testid="checklist-view" className="mx-auto flex max-w-xl flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">{doctype}</h1>
          <span className="text-xs text-[var(--color-ink-muted)]">{data.length} runs</span>
        </div>
        <div className="flex items-center gap-2">
          {!binding.readOnly && (
            <RouterLink
              to="/admin/$doctype/$name"
              params={{ doctype, name: 'new' }}
              search={{ prefill: undefined }}
              className="fc-btn fc-btn-primary"
              data-testid="checklist-new"
            >
              + New
            </RouterLink>
          )}
          <RouterLink to="/admin/$doctype" params={{ doctype }} search={{ filters: undefined }} className="fc-btn">
            List
          </RouterLink>
        </div>
      </div>
      {rows.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {[...groups.entries()].map(([day, rowsOfDay]) => (
        <div key={day || 'undated'} className="flex flex-col gap-2">
          {binding.dateCol && (
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              {dayLabel(day)}
            </div>
          )}
          {rowsOfDay.map((row) => {
            const parts = binding.progressCol ? progressParts(row[binding.progressCol]) : null
            const status = binding.statusCol ? String(row[binding.statusCol.column_name] ?? '') : ''
            return (
              <button
                key={String(row.name)}
                type="button"
                onClick={() => onOpen(String(row.name))}
                className="fc-card flex w-full flex-col gap-2 p-3 text-left"
                data-testid="checklist-run-card"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[var(--color-ink)]">
                    {String(row[binding.titleCol] ?? row.name)}
                  </span>
                  {status && <span className="fc-pill">{status}</span>}
                </div>
                {parts && (
                  <>
                    <span className="text-xs tabular-nums text-[var(--color-ink-muted)]">
                      {parts.done}/{parts.total}
                    </span>
                    <ProgressBar done={parts.done} total={parts.total} />
                  </>
                )}
              </button>
            )
          })}
        </div>
      ))}
      {!rows.isLoading && !data.length && (
        <p className="text-sm text-[var(--color-ink-muted)]">No runs yet.</p>
      )}
    </div>
  )
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${pct}%`, background: done === total && total > 0 ? 'var(--color-good)' : 'var(--color-brand)' }}
      />
    </div>
  )
}

// ---------------------------------------------------------------- run pane
function RunPane({
  doctype,
  name,
  binding,
  onBack,
}: {
  doctype: string
  name: string
  binding: Binding
  onBack: () => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [noteDraft, setNoteDraft] = useState<{ item: string; text: string } | null>(null)
  const doc = useQuery({
    queryKey: ['checklist-run', doctype, name],
    queryFn: () => api.get<Row>(`/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
  })
  const items = (doc.data?.[binding.itemsCol] as Row[] | undefined) ?? []

  // One query for every item's photos; grouped by the child row they hang on.
  const photos = useQuery({
    queryKey: ['checklist-photos', doctype, name, items.length],
    enabled: Boolean(binding.photoCol) && items.length > 0,
    queryFn: () =>
      listResource<Row>('File', {
        filters: [
          ['ref_table', '=', binding.childTable],
          ['ref_name', 'in', items.map((i) => String(i.name))],
        ],
        fields: ['name', 'file_name', 'file_url', 'thumbnail_url', 'ref_name'],
        order_by: 'created_at asc',
        limit_page_length: 200,
      }),
  })
  const photosByItem = new Map<string, Row[]>()
  for (const f of photos.data?.data ?? []) {
    const key = String(f.ref_name)
    if (!photosByItem.has(key)) photosByItem.set(key, [])
    photosByItem.get(key)!.push(f)
  }

  async function saveItems(next: Row[], extra: Row = {}) {
    if (!doc.data || saving) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.post<Row>('/api/save_doc', {
        doctype,
        doc: { name, updated_at: doc.data.updated_at, [binding.itemsCol]: next, ...extra },
      })
      queryClient.setQueryData(['checklist-run', doctype, name], saved)
      queryClient.invalidateQueries({ queryKey: ['checklist-list', doctype] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const toggle = (itemName: string) =>
    saveItems(
      items.map((i) =>
        String(i.name) === itemName ? { ...i, [binding.doneCol]: !i[binding.doneCol] } : i,
      ),
    )

  const saveNote = (itemName: string, text: string) => {
    setNoteDraft(null)
    if (!binding.noteCol) return
    return saveItems(
      items.map((i) => (String(i.name) === itemName ? { ...i, [binding.noteCol!]: text } : i)),
    )
  }

  // Footer action: advance the status Choice to its next declared value —
  // "Open → Submitted" for the checklists app, whatever the metadata says
  // elsewhere. The server-side gate may refuse; its message lands in `error`.
  const choices = (binding.statusCol?.choices ?? '').split('\n').map((c) => c.trim()).filter(Boolean)
  const currentStatus = binding.statusCol ? String(doc.data?.[binding.statusCol.column_name] ?? '') : ''
  const nextStatus = choices[choices.indexOf(currentStatus) + 1]
  const parts = binding.progressCol ? progressParts(doc.data?.[binding.progressCol]) : null

  if (doc.isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (doc.isError)
    return (
      <p className="text-sm text-[var(--color-danger)]">
        {doc.error instanceof ApiError ? doc.error.message : 'Could not load this run.'}{' '}
        <button type="button" className="underline" onClick={onBack}>Back</button>
      </p>
    )

  return (
    <div data-testid="checklist-run-view" className="mx-auto flex max-w-xl flex-col gap-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="fc-btn" aria-label="Back to runs">‹</button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-[var(--color-ink)]">
            {String(doc.data?.[binding.titleCol] ?? name)}
          </h1>
          <span className="text-xs text-[var(--color-ink-muted)]">
            {name}
            {currentStatus ? ` · ${currentStatus}` : ''}
          </span>
        </div>
        {parts && (
          <span
            className="ml-auto text-sm font-semibold tabular-nums text-[var(--color-ink)]"
            data-testid="checklist-progress"
          >
            {parts.done}/{parts.total}
          </span>
        )}
      </div>
      {parts && <ProgressBar done={parts.done} total={parts.total} />}

      <div className="fc-card divide-y divide-[var(--color-border)]" data-testid="checklist-items">
        {items.map((item) => {
          const itemName = String(item.name)
          const done = Boolean(item[binding.doneCol])
          const note = binding.noteCol ? String(item[binding.noteCol] ?? '') : ''
          return (
            <div key={itemName} className="flex items-start gap-3 p-3" data-testid="checklist-item">
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                disabled={saving || binding.readOnly}
                onClick={() => toggle(itemName)}
                className="flex min-h-[44px] flex-1 items-start gap-3 text-left"
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-sm ${
                    done
                      ? 'border-[var(--color-good)] bg-[var(--color-good)] text-white'
                      : 'border-[var(--color-border-strong)] text-transparent'
                  }`}
                >
                  ✓
                </span>
                <span className="flex flex-col gap-1">
                  <span className={done ? 'text-[var(--color-ink-muted)] line-through' : 'text-[var(--color-ink)]'}>
                    {String(item[binding.labelCol] ?? '')}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-[10px] font-semibold tracking-wide">
                    {binding.mustCol && Boolean(item[binding.mustCol]) && (
                      <span className="rounded border border-current px-1 text-[var(--color-danger)] opacity-75">
                        MUST DO
                      </span>
                    )}
                    {done && item.done_at != null && (
                      <span className="font-normal text-[var(--color-good)]">
                        ✓ {String(item.done_at).slice(11, 16)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <span className="flex flex-none flex-col items-end gap-1">
                {binding.photoCol && Boolean(item[binding.photoCol]) && !binding.readOnly && (
                  <PhotoChip
                    childTable={binding.childTable}
                    itemName={itemName}
                    photos={photosByItem.get(itemName) ?? []}
                    onUploaded={() => photos.refetch()}
                  />
                )}
                {binding.noteCol &&
                  !binding.readOnly &&
                  (noteDraft?.item === itemName ? (
                    <input
                      autoFocus
                      className="fc-input w-40 text-xs"
                      defaultValue={note}
                      placeholder="Why not?"
                      onBlur={(e) => saveNote(itemName, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveNote(itemName, (e.target as HTMLInputElement).value)
                        if (e.key === 'Escape') setNoteDraft(null)
                      }}
                      data-testid="checklist-note-input"
                    />
                  ) : note ? (
                    <button
                      type="button"
                      className="max-w-40 truncate rounded bg-[var(--color-subtle)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]"
                      onClick={() => setNoteDraft({ item: itemName, text: note })}
                      title={note}
                    >
                      {note}
                    </button>
                  ) : (
                    !done && (
                      <button
                        type="button"
                        className="text-xs text-[var(--color-ink-muted)] underline"
                        onClick={() => setNoteDraft({ item: itemName, text: '' })}
                        data-testid="checklist-add-note"
                      >
                        + note
                      </button>
                    )
                  ))}
              </span>
            </div>
          )
        })}
        {!items.length && (
          <p className="p-4 text-sm text-[var(--color-ink-muted)]">This run has no items.</p>
        )}
      </div>

      {error && (
        <p className="text-sm text-[var(--color-danger)]" data-testid="checklist-error">
          {error}
        </p>
      )}
      {binding.statusCol && nextStatus && !binding.readOnly && (
        <button
          type="button"
          className="fc-btn fc-btn-primary w-full py-3"
          disabled={saving}
          onClick={() => saveItems(items, { [binding.statusCol!.column_name]: nextStatus })}
          data-testid="checklist-submit"
        >
          Mark {nextStatus}
        </button>
      )}
    </div>
  )
}

// Camera chip: photo_proof items upload straight from the device camera on
// mobile (capture=environment) and show what's attached as thumbnails.
function PhotoChip({
  childTable,
  itemName,
  photos,
  onUploaded,
}: {
  childTable: string
  itemName: string
  photos: Row[]
  onUploaded: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  async function upload(file: File) {
    setBusy(true)
    setFailed(false)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('ref_doctype', childTable)
      form.append('ref_name', itemName)
      const res = await fetch('/api/upload_file', {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}` },
        body: form,
      })
      if (!res.ok) throw new Error(String(res.status))
      onUploaded()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="flex items-center gap-1">
      {photos.map((p) =>
        p.thumbnail_url ? (
          <img
            key={String(p.name)}
            src={String(p.thumbnail_url)}
            alt={String(p.file_name)}
            className="h-7 w-7 rounded object-cover"
            data-testid="checklist-photo-thumb"
          />
        ) : (
          <span key={String(p.name)} className="text-xs" data-testid="checklist-photo-thumb">📎</span>
        ),
      )}
      <button
        type="button"
        className={`fc-btn px-2 py-1 text-xs ${failed ? 'text-[var(--color-danger)]' : ''}`}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        data-testid="checklist-photo-add"
      >
        {busy ? '…' : failed ? '📷 !' : '📷'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="checklist-photo-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
    </span>
  )
}
