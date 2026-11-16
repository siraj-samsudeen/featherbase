// #772 checklist 1–9: the Data Source table's New page. The kind folds into one
// line once picked; MotherDuck says who the instance's token signs in as and
// lists the databases to tick (#969). Other kinds keep the native Data Source form.
import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../lib/api'
import { connectWarehouse, listDatabases } from '../lib/warehouse'
import { Breadcrumbs, Button, DataList, Field, Notice, SearchableList, StatusPill, TextInput, buttonClasses, cardClasses } from '@featherbase/shop-floor'
import { FormView } from '../components/FormView'

const KINDS = [
  { engine: 'motherduck', label: 'MotherDuck', hint: "Cloud warehouse, read with this server's token" },
  { engine: 'postgres', label: 'Postgres', hint: 'Host, database, user, password' },
  { engine: 'duckdb', label: 'DuckDB file', hint: 'A .duckdb file on the server' },
  { engine: 'csv-folder', label: 'Folder of CSV files', hint: 'A folder on the server' },
] as const

const NAME_RULE = /^[a-z][a-z0-9-]*$/

export default function ConnectSource() {
  const [kind, setKind] = useState<string | null>(null)
  const picked = KINDS.find((k) => k.engine === kind)
  return (
    <div data-testid="connect-source">
      <div className="mb-4"><Breadcrumbs items={[
        { label: 'Admin', href: '/featherbase/admin' },
        { label: 'Data Source', href: '/featherbase/admin/table/data-source' },
        { label: 'New' },
      ]} /></div>
      {kind === 'motherduck' ? (
        <MotherDuckForm onChangeKind={() => setKind(null)} />
      ) : (
        <>
          <div className="mb-4">
            <h1 className="text-xl font-semibold text-ink">Connect a data source</h1>
            <p className="text-xs text-ink-muted">Read tables from a database or warehouse you already have. Only a System Manager can do this.</p>
          </div>
          <section className={cardClasses('mb-4 max-w-3xl divide-y divide-border')}>
            {picked ? (
              <KindLine label={picked.label} hint={picked.hint} onChange={() => setKind(null)} />
            ) : (
              <div className="p-5">
                <h2 className="font-semibold text-ink">1. What are you connecting?</h2>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3" role="list">
                  {KINDS.map((k) => (
                    <button
                      key={k.engine}
                      type="button"
                      role="listitem"
                      data-testid={`kind-${k.engine}`}
                      onClick={() => setKind(k.engine)}
                      className="rounded-control border border-border bg-surface p-3 text-left hover:bg-subtle"
                    >
                      <span className="block text-sm font-semibold text-ink">{k.label}</span>
                      <span className="block text-xs text-ink-muted">{k.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
          {picked && <FormView key={picked.engine} table="Data Source" name="" isNew prefill={{ engine: picked.engine }} />}
        </>
      )}
    </div>
  )
}

function KindLine({ label, hint, onChange }: { label: string; hint: string; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3" data-testid="kind-line">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-ink">1. Kind</h2>
        <StatusPill tone="opportunity">{label}</StatusPill>
        <span className="text-xs text-ink-muted">{hint}</span>
      </div>
      <Button variant="quiet" onClick={onChange} data-testid="kind-change">Change</Button>
    </div>
  )
}

function MotherDuckForm({ onChangeKind }: { onChangeKind: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('warehouse')
  const listing = useQuery({ queryKey: ['warehouse-databases'], queryFn: listDatabases, retry: false, gcTime: 0 })
  const report = listing.data ?? null
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const nameError = name && !NAME_RULE.test(name) ? 'Use lowercase letters, digits and hyphens, starting with a letter' : undefined
  const ready = !!report && ticked.size > 0 && !!name && !nameError

  async function save() {
    setBusy(true)
    setSaveError(null)
    try {
      const chosen = (report?.databases ?? []).filter((d) => ticked.has(d.name)).map((d) => d.name)
      await connectWarehouse(name, chosen)
      await queryClient.invalidateQueries({ queryKey: ['warehouse-sources'] })
      navigate({ to: '/featherbase/admin/source/$name', params: { name }, search: { database: chosen[0], schema: undefined } })
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'The source could not be saved')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (db: string) =>
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(db)) next.delete(db)
      else next.add(db)
      return next
    })

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">Connect a data source</h1>
          <p className="text-xs text-ink-muted">Read tables from a database or warehouse you already have. Only a System Manager can do this.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/featherbase/admin/table/$table" params={{ table: 'data-source' }} search={{ filters: undefined }} className={buttonClasses()}>
            Cancel
          </Link>
          <Button
            variant="primary"
            disabled={!ready}
            loading={busy}
            onClick={save}
            title={ready ? undefined : 'Tick at least one database'}
            data-testid="connect-save"
          >
            Save and browse tables
          </Button>
        </div>
      </div>
      {saveError && <Notice tone="negative" className="mb-4 max-w-3xl">{saveError}</Notice>}
      <section className={cardClasses('max-w-3xl divide-y divide-border')}>
        <KindLine label="MotherDuck" hint="Cloud warehouse, read with this server's token" onChange={onChangeKind} />
        <div className="p-5">
          <h2 className="font-semibold text-ink">2. Name it</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name" hint="Lowercase letters, digits and hyphens." error={nameError}>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} data-testid="connect-name" />
            </Field>
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-ink">Access</span>
              <div className="flex min-h-control items-center gap-2">
                <StatusPill tone="neutral">Read only</StatusPill>
                <span className="text-xs text-ink-muted">Featherbase never writes to a warehouse.</span>
              </div>
            </div>
            <div className="md:col-span-2" data-testid="connect-result" aria-live="polite">
              {report && (
                <p className="text-sm text-positive">
                  Connected as {report.user} · it can read {report.databases.length} databases. Tick the ones to use below.
                </p>
              )}
              {listing.isError && (
                <Notice tone="negative">{listing.error instanceof ApiError ? listing.error.message : 'MotherDuck could not be asked for its databases'}</Notice>
              )}
              {listing.isPending && <p className="text-sm text-ink-muted">Asking MotherDuck which databases this server's token can read…</p>}
            </div>
          </div>
        </div>
        {report && (
          <div className="p-5" data-testid="connect-databases">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-ink">
                3. Choose the databases <span className="text-sm font-normal text-ink-muted">· {ticked.size} of {report.databases.length} ticked</span>
              </h2>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Featherbase opens only the databases you tick, and only for its own connection. Your MotherDuck account isn't changed.
            </p>
            <div className="mt-3"><SearchableList label="Databases" items={report.databases} query={filter} onQueryChange={setFilter} getSearchText={(d) => `${d.name} ${d.owner}`}>
              {(matching) => <DataList caption="Available databases" rows={matching} columns={[
                { key: 'use', header: 'Use', cell: (d) => <input type="checkbox" aria-label={`Use ${d.name}`} checked={ticked.has(d.name)} onChange={() => toggle(d.name)} data-testid={`db-${d.name}`} /> },
                { key: 'name', header: 'Database', cell: (d) => <span className="font-mono">{d.name}</span> },
                { key: 'owner', header: 'Owner', cell: (d) => d.owner },
              ]} rowKey={(d) => d.name} layout="table" empty={{ title: 'No matching databases', body: 'Try a different search.' }} />}
            </SearchableList></div>
            <p className="mt-3 text-sm text-ink-muted">
              Next, after saving: pick one of these databases, then a table in it, and copy that table into Featherbase.
            </p>
          </div>
        )}
      </section>
    </>
  )
}
