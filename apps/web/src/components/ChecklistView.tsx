import { useRef, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { ApiError, api, getToken, listResource } from '../lib/api'
import { isSourceReadOnly, useMeta, type ColumnDef, type TableMeta } from '../lib/meta'

type Row = Record<string, unknown>

// Checklist view: a tap-first execution surface for any Table with checklist
// shape — a Sub-table column whose row table carries a Check column named
// `done`. Like Kanban binds "the Choice column to group by", this view binds
// by shape and column-name convention, all read from metadata (no per-model
// code):
//
//   done column   — the Check named `done`, and only that: a row table with
//   booleans but no `done` describes a standard, it doesn't execute one
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
        This Table has no checklist-shaped Sub-table (a row table with a Check column named
        “done”).
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
  // Bind the first Sub-table column whose row table qualifies — EVERY
  // candidate is looked up, so a checklist living in a Table's third
  // sub-table binds exactly like one in its first. Same queryKey as useMeta,
  // so the cache is shared and a Table already on screen costs no fetch.
  const children = useQueries({
    queries: subCols.map((sub) => ({
      queryKey: ['meta', sub.row_table!],
      queryFn: () =>
        api.get<TableMeta>(`/api/table/${encodeURIComponent(sub.row_table!)}:meta`),
      staleTime: 60_000,
    })),
  })
  if (!meta) return { pending: true, binding: null }
  if (children.some((c) => c.isLoading)) return { pending: true, binding: null }
  for (const [i, sub] of subCols.entries()) {
    const childMeta = children[i]?.data
    if (!childMeta) continue
    // The completion binding must be EXPLICIT: a Check column named `done`.
    // Falling back to "the row table's first Check" turns every boolean into
    // execution state — it is what made Checklist Template (whose items carry
    // must_do / photo_proof and no `done`) look executable, so tapping a row
    // silently rewrote the standard instead of running it.
    const done = childMeta.columns.find(
      (f) => f.column_type === 'Check' && f.column_name === 'done',
    )
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
                key={String(row.row_id)}
                type="button"
                onClick={() => onOpen(String(row.row_id))}
                className="fc-card flex w-full flex-col gap-2 p-3 text-left"
                data-testid="checklist-run-card"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[var(--color-ink)]">
                    {String(row[binding.titleCol] ?? row.row_id)}
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
  // Full-screen photo viewer: file_url of the photo being viewed, or null.
  const [viewer, setViewer] = useState<string | null>(null)
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
          ['ref_name', 'in', items.map((i) => String(i.row_id))],
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
        String(i.row_id) === itemName ? { ...i, [binding.doneCol]: !i[binding.doneCol] } : i,
      ),
    )

  const saveNote = (itemName: string, text: string) => {
    setNoteDraft(null)
    if (!binding.noteCol) return
    return saveItems(
      items.map((i) => (String(i.row_id) === itemName ? { ...i, [binding.noteCol!]: text } : i)),
    )
  }

  // Footer action: advance the status Choice to its next declared value —
  // "Open → Submitted" for the checklists app, whatever the metadata says
  // elsewhere. The server-side gate may refuse; its message lands in `error`.
  const choices = (binding.statusCol?.choices ?? '').split('\n').map((c) => c.trim()).filter(Boolean)
  const currentStatus = binding.statusCol ? String(doc.data?.[binding.statusCol.column_name] ?? '') : ''
  const nextStatus = choices[choices.indexOf(currentStatus) + 1]
  // A run that has reached the LAST declared status has nowhere left to
  // advance, which is what "finished" means here — the checklists app makes
  // Submitted terminal and the server refuses every later write. So the
  // surface stops offering ticks, notes and photos rather than inviting
  // saves that can only come back as errors.
  const terminal = Boolean(binding.statusCol) && choices.length > 0 && !nextStatus
  const locked = binding.readOnly || terminal
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
      {terminal && (
        <p
          className="rounded border border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-2 text-xs text-[var(--color-ink-muted)]"
          data-testid="checklist-locked"
        >
          {currentStatus} — this run is final and can no longer be changed.
        </p>
      )}

      <div className="fc-card divide-y divide-[var(--color-border)]" data-testid="checklist-items">
        {items.map((item) => {
          const itemName = String(item.row_id)
          const done = Boolean(item[binding.doneCol])
          const note = binding.noteCol ? String(item[binding.noteCol] ?? '') : ''
          // Mockup-faithful layout: the whole tick row is the tap target,
          // and photos + note sit UNDER the label (indented past the tick
          // circle), never in a side column.
          return (
            <div key={itemName} className="flex flex-col gap-2 p-3" data-testid="checklist-item">
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                disabled={saving || locked}
                onClick={() => toggle(itemName)}
                className="flex min-h-[44px] w-full items-start gap-3 text-left"
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
              {/* A locked run still SHOWS its evidence — the photos are the
                  record of what was done — it just stops accepting more. */}
              {binding.photoCol &&
                Boolean(item[binding.photoCol]) &&
                (!locked || photosByItem.has(itemName)) && (
                  <div className="ml-9">
                    <PhotoRow
                      childTable={binding.childTable}
                      itemName={itemName}
                      photos={photosByItem.get(itemName) ?? []}
                      locked={locked}
                      onUploaded={() => photos.refetch()}
                      onView={setViewer}
                    />
                  </div>
                )}
              {/* Same rule for the excuse note: locked shows it, never edits it. */}
              {binding.noteCol && (!locked || Boolean(note)) && (
                <div className="ml-9">
                  {locked ? (
                    note && (
                      <span className="inline-block rounded bg-[var(--color-warn-tint)] px-2 py-1 text-xs text-[var(--color-warn)]">
                        Note: {note}
                      </span>
                    )
                  ) : noteDraft?.item === itemName ? (
                    <input
                      autoFocus
                      className="fc-input w-full max-w-sm text-sm"
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
                      className="rounded bg-[var(--color-warn-tint)] px-2 py-1 text-left text-xs text-[var(--color-warn)]"
                      onClick={() => setNoteDraft({ item: itemName, text: note })}
                      title="Edit note"
                    >
                      Note: {note}
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
                  )}
                </div>
              )}
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
      {viewer && <PhotoLightbox fileUrl={viewer} onClose={() => setViewer(null)} />}
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

// Full-screen viewer for an attached photo. The image loads through
// /api/signed_url so private files work the same as public ones.
function PhotoLightbox({ fileUrl, onClose }: { fileUrl: string; onClose: () => void }) {
  const signed = useQuery({
    queryKey: ['signed-url', fileUrl],
    queryFn: () =>
      api.get<{ signed_url: string }>(`/api/signed_url?file_url=${encodeURIComponent(fileUrl)}`),
  })
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Photo viewer"
      data-testid="checklist-photo-view"
    >
      {signed.data ? (
        <img
          src={signed.data.signed_url}
          alt="Checklist photo"
          className="max-h-full max-w-full rounded object-contain"
        />
      ) : (
        <span className="text-sm text-white">Loading…</span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-lg text-white"
      >
        ×
      </button>
    </div>
  )
}

// Photo row under a photo_proof item: tappable thumbnails (open the
// full-screen viewer) plus a camera button — capture=environment opens the
// device camera directly on mobile.
function PhotoRow({
  childTable,
  itemName,
  photos,
  locked,
  onUploaded,
  onView,
}: {
  childTable: string
  itemName: string
  photos: Row[]
  locked: boolean
  onUploaded: () => void
  onView: (fileUrl: string) => void
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
      // Shop-floor photos are operational evidence, not public assets: stored
      // private, so reaching one costs a signed URL that the server only mints
      // after authorizing the item it hangs on.
      form.append('is_private', '1')
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
    <span className="flex flex-wrap items-center gap-2">
      {photos.map((p) => (
        <button
          key={String(p.row_id)}
          type="button"
          onClick={() => onView(String(p.file_url))}
          aria-label={`View ${String(p.file_name)}`}
          className="overflow-hidden rounded border border-[var(--color-border-strong)]"
          data-testid="checklist-photo-thumb"
        >
          {p.thumbnail_url ? (
            <img
              src={String(p.thumbnail_url)}
              alt={String(p.file_name)}
              className="h-14 w-14 object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center text-lg">📎</span>
          )}
        </button>
      ))}
      {!locked && (
        <>
          <button
            type="button"
            className={`fc-btn px-3 py-2 text-sm ${failed ? 'text-[var(--color-danger)]' : ''}`}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            data-testid="checklist-photo-add"
          >
            {busy ? '…' : failed ? '📷 Retry' : photos.length ? '📷' : '📷 Take photo'}
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
        </>
      )}
    </span>
  )
}
