// #772 part 2 (first version): set up the copy of one warehouse table — the new
// table's name, the key column that matches rows on every copy, and per column
// whether to keep it, its Featherbase name, label and description.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { tableSlug } from 'shared'
import { fmtCount } from '@featherbase/shop-floor'
import { browserHref, clearCopyDraft, previewTable, readCopyDraft, writeCopyDraft } from '../lib/warehouse'
import { Breadcrumbs, Button, DataList, Notice, SearchableList, Select, Skeleton, StatusPill, TextInput, cardClasses, type DataColumn } from '@featherbase/shop-floor'

const enc = encodeURIComponent
const bookkeeping = (column: string) => column.startsWith('_')
const NAME_RULE = /^[a-z][a-z0-9_]*$/

interface Row { source: string; keep: boolean; column_name: string; label: string; description: string; type: string }
interface KeyCheck { rows: number; distinct: number; empty: number; usable: boolean }
interface Draft { target: string; key: string; rows: Row[]; query: string }

export function CopySetup({ name, database, schema, table, returnTo }: { name: string; database: string; schema: string; table: string; returnTo?: string }) {
  const navigate = useNavigate()
  const preview = useQuery({ queryKey: ['warehouse-preview', name, database, schema, table], queryFn: () => previewTable(name, database, schema, table) })
  const identity = JSON.stringify([name, database, schema, table])
  const [draft] = useState(() => readCopyDraft<Draft>(identity))
  const [target, setTarget] = useState(draft?.target ?? table)
  const [key, setKey] = useState(draft?.key ?? '')
  const [rows, setRows] = useState<Row[]>(draft?.rows ?? [])
  const [query, setQuery] = useState(draft?.query ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (rows.length) writeCopyDraft(identity, { target, key, rows, query })
  }, [identity, target, key, rows, query])

  useEffect(() => {
    if (!preview.data || rows.length) return
    setRows(preview.data.columns.map((c) => ({ source: c.name, keep: !bookkeeping(c.name), column_name: c.name, label: '', description: '', type: c.type })))
    setKey(preview.data.columns[0]?.name ?? '')
  }, [preview.data, rows.length])

  const check = useQuery({
    queryKey: ['copy-key', name, database, schema, table, key],
    queryFn: () => api.get<KeyCheck>(`/api/table/Data%20Source/${enc(name)}:copy_check_key?database=${enc(database)}&schema=${enc(schema)}&table=${enc(table)}&column=${enc(key)}`),
    enabled: !!key,
  })
  const kept = rows.filter((r) => r.keep)
  const badNames = kept.filter((r) => !NAME_RULE.test(r.column_name)).map((r) => r.source)
  const ready = !!target.trim() && check.data?.usable && kept.some((r) => r.source === key) && !badNames.length
  const update = (source: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.source === source ? { ...r, ...patch } : r)))
  const columns: DataColumn<Row>[] = [
    { key: 'keep', header: 'Keep', cell: (r) => <input type="checkbox" aria-label={`Keep ${r.source}`} checked={r.keep} disabled={r.source === key} onChange={(e) => update(r.source, { keep: e.target.checked })} /> },
    { key: 'source', header: 'Source column', cell: (r) => <span className="font-mono" title={r.type}>{r.source}{r.source === key && <span className="ml-2"><StatusPill tone="opportunity">key</StatusPill></span>}</span> },
    { key: 'name', header: 'Featherbase name', cell: (r) => <TextInput aria-label={`Name for ${r.source}`} className="min-w-40 font-mono" value={r.column_name} onChange={(e) => update(r.source, { column_name: e.target.value })} aria-invalid={r.keep && !NAME_RULE.test(r.column_name)} /> },
    { key: 'label', header: 'Label', cell: (r) => <TextInput aria-label={`Label for ${r.source}`} className="min-w-40" placeholder={r.column_name} value={r.label} onChange={(e) => update(r.source, { label: e.target.value })} /> },
    { key: 'description', header: 'Description', cell: (r) => <TextInput aria-label={`Description for ${r.source}`} className="min-w-48" placeholder="—" value={r.description} onChange={(e) => update(r.source, { description: e.target.value })} /> },
  ]

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const made = await api.post<{ table: string }>(`/api/table/Data%20Source/${enc(name)}:copy_create`, {
        database, schema, table, name: target.trim(), key,
        columns: kept.map((r) => ({ source: r.source, column_name: r.column_name, label: r.label || undefined, description: r.description || undefined })),
      })
      clearCopyDraft(identity)
      navigate({ to: '/featherbase/admin/table/$table', params: { table: tableSlug(made.table) }, search: { filters: undefined } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The copy could not be made')
    } finally {
      setBusy(false)
    }
  }

  const keyOptions = useMemo(() => rows.filter((r) => r.keep), [rows])
  if (preview.isPending) return <Skeleton label="Reading the table" />
  const fallback = browserHref(name, { database, schema, table, tableSchema: schema, tab: 'preview' })
  const back = returnTo?.startsWith(`/featherbase/admin/source/${enc(name)}?`) ? returnTo : fallback
  const catalogSearch = new URLSearchParams(back.slice(back.indexOf('?') + 1))
  catalogSearch.set('tab', 'catalog')
  const catalogHref = `/featherbase/admin/source/${enc(name)}?${catalogSearch}`

  return (
    <div data-testid="copy-setup" className="flex min-w-0 flex-1 flex-col gap-4">
      <Breadcrumbs items={[
        { label: 'Data Source', href: '/featherbase/admin/table/data-source' },
        { label: name, href: `/featherbase/admin/table/data-source/row/${enc(name)}` },
        { label: database, href: catalogHref },
        { label: schema, href: catalogHref },
        { label: table, href: back },
        { label: 'Set up copy' },
      ]} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">Copy <span className="font-mono">{table}</span> into Featherbase</h1>
          <p className="text-xs text-ink-muted">{name} · {database}.{schema}.{table} · {fmtCount(preview.data?.rows ?? 0)} rows. The copy is an ordinary table you can edit; copying again later keeps your corrections.</p>
        </div>
        <Button variant="primary" disabled={!ready} loading={busy} onClick={create} data-testid="copy-create">
          Create table and copy {fmtCount(preview.data?.rows ?? 0)} rows
        </Button>
      </div>
      {error && <div className="mb-4"><Notice tone="negative">{error}</Notice></div>}
      {preview.error && <Notice tone="negative">{preview.error instanceof ApiError ? preview.error.message : 'The table could not be read'}</Notice>}
      <section className={cardClasses('mb-4 grid grid-cols-1 gap-4 p-5 md:grid-cols-2')}>
        <div>
          <label htmlFor="copy-name" className="mb-1.5 block text-sm font-semibold text-ink">New table name</label>
          <TextInput id="copy-name" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="copy-name" />
        </div>
        <div>
          <label htmlFor="copy-key" className="mb-1.5 block text-sm font-semibold text-ink">Key column</label>
          <Select id="copy-key" value={key} onChange={(e) => setKey(e.target.value)} data-testid="copy-key">
            {keyOptions.map((r) => <option key={r.source} value={r.source}>{r.source}</option>)}
          </Select>
          <div className="mt-1.5 text-sm" data-testid="copy-key-check">
            {check.data && (check.data.usable
              ? <StatusPill tone="positive">{fmtCount(check.data.rows)} rows, every value different</StatusPill>
              : <StatusPill tone="negative">{fmtCount(check.data.rows - check.data.distinct)} rows repeat a value{check.data.empty ? `, ${fmtCount(check.data.empty)} are empty` : ''}</StatusPill>)}
          </div>
          <p className="mt-1 text-xs text-ink-muted">It matches each source row to its Featherbase row on every copy, and becomes the row's id.</p>
        </div>
      </section>
      <section className="min-w-0" data-testid="copy-columns">
        <SearchableList label="Column mapping" items={rows} query={query} onQueryChange={setQuery} getSearchText={(r) => `${r.source} ${r.column_name} ${r.label} ${r.description} ${r.type}`}>
          {(matching) => <DataList caption="Columns to copy" rows={matching} columns={columns} rowKey={(r) => r.source} layout="table" empty={{ title: 'No matching columns', body: 'Try a different search.' }} />}
        </SearchableList>
        <p className="px-3 py-2 text-xs text-ink-muted">
          Columns starting with _ are the warehouse's own bookkeeping and start unticked. You can rename, relabel and describe any column later on the table's Columns screen; the copy keeps finding its source column.
          {badNames.length > 0 && <span className="text-negative"> Names use lowercase letters, digits and _: fix {badNames.join(', ')}.</span>}
        </p>
      </section>
    </div>
  )
}
