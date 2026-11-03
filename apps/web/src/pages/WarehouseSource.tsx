// #772 checklist 9: a MotherDuck source connected by a token. The token is never
// shown; only its last four, with a way to replace it. Any other source keeps
// the native Data Source form.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { replaceToken, type WarehouseSource as Source } from '../lib/warehouse'
import { Breadcrumbs, Button, DataList, Notice, SearchableList, Skeleton, TextInput, buttonClasses, cardClasses } from '../components/ui'
import { FormView } from '../components/FormView'

export default function WarehouseSource({ name }: { name: string }) {
  const source = useQuery({
    queryKey: ['data-source', name],
    queryFn: () => api.get<Source>(`/api/table/Data%20Source/${encodeURIComponent(name)}`),
  })
  if (source.isPending) return <Skeleton label="Loading the data source" />
  if (source.data?.engine !== 'motherduck') return <FormView table="Data Source" name={name} />
  return <TokenSource source={source.data} />
}

function TokenSource({ source }: { source: Source }) {
  const queryClient = useQueryClient()
  const [replacing, setReplacing] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writable, setWritable] = useState(false)
  const [query, setQuery] = useState('')
  const databases = source.databases ?? []

  async function replace() {
    setBusy(true)
    setError(null)
    try {
      setWritable((await replaceToken(source.row_id, token)).can_write)
      setReplacing(false)
      setToken('')
      await queryClient.invalidateQueries({ queryKey: ['data-source', source.row_id] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The token could not be replaced')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="warehouse-source">
      <div className="mb-4"><Breadcrumbs items={[
        { label: 'Admin', href: '/featherbase/admin' },
        { label: 'Data Source', href: '/featherbase/admin/Data%20Source' },
        { label: source.row_id },
      ]} /></div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">{source.row_id}</h1>
          <p className="text-xs text-ink-muted">MotherDuck · read only</p>
        </div>
        <Link
          to="/featherbase/admin/source/$name"
          params={{ name: source.row_id }}
          search={{ database: undefined, schema: undefined }}
          className={buttonClasses({ variant: 'primary' })}
          data-testid="warehouse-browse"
        >
          Browse tables
        </Link>
      </div>
      <section className={cardClasses('max-w-3xl p-5')}>
        <dl className="grid grid-cols-1 items-center gap-x-4 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-ink-muted">Kind</dt>
          <dd className="text-ink">MotherDuck</dd>
          <dt className="text-ink-muted">Token</dt>
          <dd className="flex flex-wrap items-center gap-3" data-testid="warehouse-token">
            {replacing ? (
              <>
                <div className="w-72">
                  <TextInput
                    type="password"
                    aria-label="New MotherDuck token"
                    autoComplete="off"
                    className="font-mono"
                    placeholder="Paste the new token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    data-testid="replace-token-input"
                  />
                </div>
                <Button variant="primary" disabled={!token.trim()} loading={busy} onClick={replace} data-testid="replace-token-save">
                  Test and save
                </Button>
                <Button variant="secondary" onClick={() => { setReplacing(false); setToken(''); setError(null) }}>Cancel</Button>
              </>
            ) : (
              <>
                <span className="text-ink">
                  Saved, ending <span className="font-mono">…{source.token_last_four}</span>
                </span>
                <Button variant="secondary" onClick={() => setReplacing(true)} data-testid="replace-token">Replace token</Button>
              </>
            )}
          </dd>
        </dl>
        <div className="mt-5" data-testid="warehouse-databases"><SearchableList label="Databases" items={databases} query={query} onQueryChange={setQuery} getSearchText={(d) => `${d.name} ${d.owner}`}>
          {(matching) => <DataList caption="Connected databases" rows={matching} columns={[
            { key: 'name', header: 'Database', cell: (d) => <Link to="/featherbase/admin/source/$name" params={{ name: source.row_id }} search={{ database: d.name, schema: undefined }} className="text-action hover:underline">{d.name}</Link> },
            { key: 'owner', header: 'Owner', cell: (d) => d.owner },
          ]} rowKey={(d) => d.name} layout="table" empty={{ title: 'No matching databases', body: 'Try a different search.' }} />}
        </SearchableList></div>
        {error && <Notice tone="negative" className="mt-4">{error}</Notice>}
        {writable && (
          <div className="mt-4" data-testid="replace-token-writable">
            <Notice tone="caution">The new token can also write to MotherDuck. Featherbase only reads, yet anyone who got the token could write. Replace it with a read scaling token.</Notice>
          </div>
        )}
      </section>
    </div>
  )
}
