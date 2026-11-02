// #772 checklist 9: a MotherDuck source connected by a token. The token is never
// shown; only its last four, with a way to replace it. Any other source keeps
// the native Data Source form.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { replaceToken, type WarehouseSource as Source } from '../lib/warehouse'
import { Button, Notice, Skeleton, TextInput, StatusPill, buttonClasses, cardClasses } from '../components/ui'
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
  const databases = source.databases ?? []

  async function replace() {
    setBusy(true)
    setError(null)
    try {
      await replaceToken(source.row_id, token)
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
      <nav className="mb-2 flex flex-wrap items-center gap-x-1 text-xs text-ink-muted">
        <Link to="/featherbase/admin" className="hover:underline">Admin</Link>
        <span aria-hidden="true">/</span>
        <Link to="/featherbase/admin/$table" params={{ table: 'Data Source' }} search={{ filters: undefined }} className="hover:underline">Data Source</Link>
        <span aria-hidden="true">/</span>
        <span className="text-ink">{source.row_id}</span>
      </nav>
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
          <dt className="text-ink-muted">Databases</dt>
          <dd className="flex flex-wrap items-center gap-2" data-testid="warehouse-databases">
            {databases.map((d) => (
              <StatusPill key={d.name} tone="neutral"><span className="font-mono">{d.name}</span></StatusPill>
            ))}
          </dd>
        </dl>
        {error && <Notice tone="negative" className="mt-4">{error}</Notice>}
      </section>
    </div>
  )
}
