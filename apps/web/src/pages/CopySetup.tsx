// #772 part 2 (first version): set up the copy of one warehouse table — the new
// table's name, the key column that matches rows on every copy, and per column
// whether to keep it, its Featherbase name, label and description.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { fmtCount } from '../lib/inr'
import { previewTable } from '../lib/warehouse'
import { Button, Notice, Select, Skeleton, StatusPill, TextInput, cardClasses } from '../components/ui'

const enc = encodeURIComponent
const bookkeeping = (column: string) => column.startsWith('_')
const NAME_RULE = /^[a-z][a-z0-9_]*$/

interface Row { source: string; keep: boolean; column_name: string; label: string; description: string; type: string }
interface KeyCheck { rows: number; distinct: number; empty: number; usable: boolean }

export function CopySetup({ name, database, schema, table }: { name: string; database: string; schema: string; table: string }) {
  const navigate = useNavigate()
  const preview = useQuery({ queryKey: ['warehouse-preview', name, database, schema, table], queryFn: () => previewTable(name, database, schema, table) })
  const [target, setTarget] = useState(table)
  const [key, setKey] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  const update = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const made = await api.post<{ table: string }>(`/api/table/Data%20Source/${enc(name)}:copy_create`, {
        database, schema, table, name: target.trim(), key,
        columns: kept.map((r) => ({ source: r.source, column_name: r.column_name, label: r.label || undefined, description: r.description || undefined })),
      })
      navigate({ to: '/featherbase/admin/$table', params: { table: made.table }, search: { filters: undefined } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The copy could not be made')
    } finally {
      setBusy(false)
    }
  }

  const keyOptions = useMemo(() => rows.filter((r) => r.keep), [rows])
  if (preview.isPending) return <Skeleton label="Reading the table" />

  return (
    <div data-testid="copy-setup">
      <nav className="mb-2 flex flex-wrap items-center gap-x-1 text-xs text-ink-muted">
        <Link to="/featherbase/admin/source/$name" params={{ name }} search={{ database, schema }} className="hover:underline">Browse {name}</Link>
        <span aria-hidden="true">/</span>
        <span className="text-ink">Copy {table}</span>
      </nav>
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
      <section className={cardClasses('overflow-x-auto')}>
        <table className="w-full text-sm" data-testid="copy-columns">
          <thead className="bg-subtle text-left text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2">Keep</th><th className="px-3 py-2">Source column</th><th className="px-3 py-2">Featherbase name</th>
              <th className="px-3 py-2">Label</th><th className="px-3 py-2">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={r.source} className={r.keep ? '' : 'opacity-50'}>
                <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Keep ${r.source}`} checked={r.keep} disabled={r.source === key} onChange={(e) => update(i, { keep: e.target.checked })} /></td>
                <td className="px-3 py-1.5 font-mono text-ink" title={r.type}>{r.source}{r.source === key && <span className="ml-2"><StatusPill tone="opportunity">key</StatusPill></span>}</td>
                <td className="px-3 py-1.5"><TextInput aria-label={`Name for ${r.source}`} className="font-mono" value={r.column_name} onChange={(e) => update(i, { column_name: e.target.value })} aria-invalid={r.keep && !NAME_RULE.test(r.column_name)} /></td>
                <td className="px-3 py-1.5"><TextInput aria-label={`Label for ${r.source}`} placeholder={r.column_name} value={r.label} onChange={(e) => update(i, { label: e.target.value })} /></td>
                <td className="px-3 py-1.5"><TextInput aria-label={`Description for ${r.source}`} placeholder="—" value={r.description} onChange={(e) => update(i, { description: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-ink-muted">
          Columns starting with _ are the warehouse's own bookkeeping and start unticked. You can rename, relabel and describe any column later on the table's Columns screen; the copy keeps finding its source column.
          {badNames.length > 0 && <span className="text-negative"> Names use lowercase letters, digits and _: fix {badNames.join(', ')}.</span>}
        </p>
      </section>
    </div>
  )
}
