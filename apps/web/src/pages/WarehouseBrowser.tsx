// #772 checklist 12–15: browse a MotherDuck source the way Explore browses
// tables — side-by-side panes: schema, then table, then a preview. The table
// list is kept on the server until Refresh; each person reopens where they left off.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { fmtCount } from '../lib/inr'
import { formatValue, useSettings } from '../lib/settings'
import { lastPlace, listTables, previewTable, refreshTables, rememberPlace, type WarehouseSource } from '../lib/warehouse'
import { Button, Notice, Select, Skeleton, cardClasses } from '../components/ui'

export function WarehouseBrowser({ name, database, schema }: { name: string; database?: string; schema?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const source = useQuery({
    queryKey: ['data-source', name],
    queryFn: () => api.get<WarehouseSource>(`/api/table/Data%20Source/${encodeURIComponent(name)}`),
  })
  const databases = source.data?.databases ?? []
  const [table, setTable] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showLists, setShowLists] = useState(false)
  const settings = useSettings()

  // Checklist 13: with no place in the address, reopen where this person left off.
  useEffect(() => {
    if (!databases.length || database) return
    const place = lastPlace(name)
    const db = databases.some((d) => d.name === place.database) ? place.database! : databases[0].name
    navigate({ to: '/featherbase/admin/source/$name', params: { name }, search: { database: db, schema: db === place.database ? place.schema : undefined }, replace: true })
  }, [databases, database, name, navigate])

  useEffect(() => {
    if (database) rememberPlace(name, { database, schema })
  }, [name, database, schema])

  const listing = useQuery({
    queryKey: ['warehouse-tables', name, database],
    queryFn: () => listTables(name, database!),
    enabled: !!database,
    staleTime: Infinity,
  })
  const schemas = listing.data?.schemas ?? []
  const activeSchema = schemas.find((s) => s.schema === schema) ?? schemas.find((s) => s.schema === 'main') ?? schemas[0]
  const tables = activeSchema?.tables ?? []

  const go = (search: { database?: string; schema?: string }) => {
    setTable(null)
    navigate({ to: '/featherbase/admin/source/$name', params: { name }, search: { database: search.database, schema: search.schema } })
  }

  async function refresh() {
    if (!database) return
    setRefreshing(true)
    try {
      queryClient.setQueryData(['warehouse-tables', name, database], await refreshTables(name, database))
    } finally {
      setRefreshing(false)
    }
  }

  if (source.isPending) return <Skeleton label="Loading the data source" />

  return (
    <div data-testid="warehouse-browser">
      <nav className="mb-2 flex flex-wrap items-center gap-x-1 text-xs text-ink-muted">
        <Link to="/featherbase/admin" className="hover:underline">Admin</Link>
        <span aria-hidden="true">/</span>
        <Link to="/featherbase/admin/$table" params={{ table: 'Data Source' }} search={{ filters: undefined }} className="hover:underline">Data Source</Link>
        <span aria-hidden="true">/</span>
        <Link to="/featherbase/admin/$table/$name" params={{ table: 'Data Source', name }} search={{ prefill: undefined }} className="hover:underline">{name}</Link>
        <span aria-hidden="true">/</span>
        <span className="text-ink">Browse</span>
      </nav>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">Browse tables</h1>
          <p className="text-xs text-ink-muted">{name} · pick a table to copy into Featherbase</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {listing.data && (
            <span className="text-xs text-ink-muted" data-testid="browser-listed-at">
              Listed {formatValue('Datetime', listing.data.listed_at, settings)}
            </span>
          )}
          <Button variant="secondary" onClick={refresh} loading={refreshing} disabled={!listing.data} data-testid="browser-refresh">
            Refresh
          </Button>
          <div className="w-56">
            <Select aria-label="Database" value={database ?? ''} onChange={(e) => go({ database: e.target.value })} data-testid="browser-database">
              {databases.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </Select>
          </div>
        </div>
      </div>

      {listing.isPending && database && (
        <div className={cardClasses('p-6 text-sm text-ink-muted')} data-testid="browser-loading">
          Opening <span className="font-mono">{database}</span>… The first time can take up to a minute; after that the list is kept until you refresh it.
        </div>
      )}
      {listing.error && <Notice tone="negative">{listing.error instanceof ApiError ? listing.error.message : 'The table list could not be read'}</Notice>}

      {/* Once a table is picked the panes fold into one bar, so the preview gets the full width. */}
      {listing.data && table && activeSchema && !showLists && (
        <div className="space-y-3">
          <div className={cardClasses('flex flex-wrap items-end gap-3 px-4 py-3')} data-testid="browser-path">
            <div className="w-52">
              <Select aria-label="Schema" value={activeSchema.schema} onChange={(e) => go({ database, schema: e.target.value })} data-testid="path-schema">
                {schemas.map((s) => <option key={s.schema} value={s.schema}>{s.schema} · {fmtCount(s.tables.length)}</option>)}
              </Select>
            </div>
            <span aria-hidden="true" className="pb-2 text-ink-subtle">/</span>
            <div className="w-72">
              <Select aria-label="Table" value={table} onChange={(e) => setTable(e.target.value)} data-testid="path-table">
                {tables.map((t) => <option key={t.name} value={t.name}>{t.name} · {fmtCount(t.rows)} rows</option>)}
              </Select>
            </div>
            <Button variant="quiet" onClick={() => setShowLists(true)} data-testid="path-show-lists">Show lists</Button>
          </div>
          <Preview name={name} database={database!} schema={activeSchema.schema} table={table} />
        </div>
      )}
      {listing.data && (!table || showLists) && (
        <div className="grid items-start gap-3 lg:grid-cols-[13rem_17rem_minmax(0,1fr)]">
          <Pane title="Schema" count={`${fmtCount(schemas.length)}`} testid="pane-schema">
            {schemas.map((s) => (
              <PaneRow key={s.schema} selected={s.schema === activeSchema?.schema} onPick={() => go({ database, schema: s.schema })} testid="schema-row">
                <span className="truncate font-mono text-sm text-ink">{s.schema}</span>
                <span className="text-xs text-ink-subtle">{fmtCount(s.tables.length)}</span>
              </PaneRow>
            ))}
          </Pane>
          <Pane title="Table" count={`${fmtCount(tables.length)}`} testid="pane-table">
            {tables.map((t) => (
              <PaneRow key={t.name} selected={t.name === table} onPick={() => { setTable(t.name); setShowLists(false) }} testid="table-row">
                <span className="truncate font-mono text-sm text-ink">{t.name}</span>
                <span className="whitespace-nowrap text-xs text-ink-subtle">{fmtCount(t.rows)} rows</span>
              </PaneRow>
            ))}
            {!tables.length && <p className="px-3 py-6 text-center text-sm text-ink-subtle">No tables</p>}
          </Pane>
          <div className={cardClasses('px-3 py-10 text-center text-sm text-ink-subtle')} data-testid="pane-preview-empty">
            Pick a table to see its size, first rows and columns.
          </div>
        </div>
      )}
    </div>
  )
}

function Pane({ title, count, testid, children }: { title: string; count: string; testid: string; children: React.ReactNode }) {
  return (
    <div className={cardClasses('overflow-hidden')} data-testid={testid}>
      <div className="flex items-baseline gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs text-ink-subtle">{count}</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">{children}</div>
    </div>
  )
}

function PaneRow({ selected, onPick, testid, children }: { selected: boolean; onPick: () => void; testid: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onPick}
      data-testid={testid}
      data-selected={selected || undefined}
      aria-pressed={selected}
      className={`flex w-full items-center justify-between gap-2 border-b border-l-[3px] border-b-border px-3 py-1.5 text-left last:border-b-0 ${
        selected ? 'border-l-action bg-action-tint' : 'border-l-transparent hover:bg-subtle'
      }`}
    >
      {children}
    </button>
  )
}

// Columns a warehouse loader adds for its own bookkeeping start with "_".
const bookkeeping = (column: string) => column.startsWith('_')

function Preview({ name, database, schema, table }: { name: string; database: string; schema: string; table: string }) {
  const preview = useQuery({
    queryKey: ['warehouse-preview', name, database, schema, table],
    queryFn: () => previewTable(name, database, schema, table),
  })
  const shown = (preview.data?.columns ?? []).filter((c) => !bookkeeping(c.name)).slice(0, 12)
  return (
    <div className={cardClasses('overflow-hidden')} data-testid="pane-preview">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-base font-semibold text-ink">{table}</h2>
          <p className="text-xs text-ink-muted" data-testid="preview-size">
            {database} · {schema}
            {preview.data && ` · ${fmtCount(preview.data.rows)} rows · ${fmtCount(preview.data.columns.length)} columns`}
          </p>
        </div>
        <Button variant="primary" disabled title="Copying a table in comes next (#772 part 2)" data-testid="preview-copy">
          Copy into Featherbase…
        </Button>
      </div>
      {preview.isPending && <div className="p-4"><Skeleton label="Reading the first rows" /></div>}
      {preview.error && <Notice tone="negative" className="m-4">{preview.error instanceof ApiError ? preview.error.message : 'The table could not be read'}</Notice>}
      {preview.data && (
        <div className="space-y-4 p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">First rows</h3>
            <div className="mt-2 overflow-x-auto rounded-control border border-border">
              <table className="w-full text-sm" data-testid="preview-rows">
                <thead className="bg-subtle text-left text-xs text-ink-muted">
                  <tr>{shown.map((c) => <th key={c.name} className="px-3 py-2 font-mono font-semibold">{c.name}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.data.first_rows.map((row, i) => (
                    <tr key={i}>{shown.map((c) => <td key={c.name} className="whitespace-nowrap px-3 py-1.5 text-ink">{row[c.name] == null ? '—' : String(row[c.name])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Columns</h3>
            <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="preview-columns">
              {preview.data.columns.map((c) => (
                <li
                  key={c.name}
                  title={c.type}
                  data-bookkeeping={bookkeeping(c.name) || undefined}
                  className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold ${bookkeeping(c.name) ? 'bg-subtle text-ink-subtle' : 'bg-action-tint text-action'}`}
                >
                  {c.name}
                </li>
              ))}
            </ul>
            {preview.data.columns.some((c) => bookkeeping(c.name)) && (
              <p className="mt-1.5 text-xs text-ink-subtle">Greyed columns start with _: the warehouse's own load bookkeeping.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
