import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { connectionLabel, useConnections, type Connection } from '../lib/connections'
import { useMeta } from '../lib/meta'
import { usePeek } from './Peek'
import { ListView, type Filter } from './ListView'
import { Breadcrumbs, Button, SearchableList, SearchInput, buttonClasses } from './ui'
import { fmtCount } from '../lib/inr'

const connectionKey = (connection: Connection) => JSON.stringify([connection.table, connection.column, connection.via])

/** One metadata-derived, permission-scoped selector beside the native list. */
export function RelatedWorkspace({ table, name, title, active }: {
  table: string
  name: string
  title: string
  active: boolean
}) {
  // Load on first visit, then retain selection/search when returning to Work.
  const [visited, setVisited] = useState(active)
  useEffect(() => { if (active) setVisited(true) }, [active])
  const cnx = useConnections(table, name, visited)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const connections = cnx.data?.connections ?? []
  const selectedConnection = connections.find((connection) => connectionKey(connection) === selected) ?? connections[0]
  if (!visited) return null
  if (cnx.isPending) return <p className="text-sm text-ink-muted">Loading relationships…</p>
  if (cnx.isError) return <p role="alert" className="text-sm text-negative">Cannot load relationships.</p>
  if (!connections.length) return <p className="text-sm text-ink-muted">No readable relationships.</p>
  return <div id="related" className="flex min-h-0 min-w-0 gap-6" data-testid="related-workspace">
    <aside className="w-64 shrink-0 border-r border-border pr-4">
      <SearchableList label="Search relationships" placeholder="Search relations" items={connections} query={query} onQueryChange={setQuery} getSearchText={(connection) => `${connectionLabel(connection)} ${connection.count}`}>
        {(matching) => <nav aria-label="Relationships" className="flex flex-col gap-1">
          {matching.map((connection) => <button key={connectionKey(connection)} type="button"
            aria-pressed={connectionKey(selectedConnection) === connectionKey(connection)}
            onClick={() => setSelected(connectionKey(connection))}
            className={`flex min-h-control items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left text-sm ${connectionKey(selectedConnection) === connectionKey(connection) ? 'bg-action-tint text-action' : connection.count ? 'text-ink hover:bg-subtle' : 'text-ink-subtle hover:bg-subtle'}`}>
            <span>{connectionLabel(connection)}</span><span>{fmtCount(connection.count)}</span>
          </button>)}
          {!matching.length && <p className="text-sm text-ink-muted">No matching relationships.</p>}
        </nav>}
      </SearchableList>
    </aside>
    <RelatedRows key={connectionKey(selectedConnection)} connection={selectedConnection} owner={{ table, name, title }} />
  </div>
}

function RelatedRows({ connection, owner }: { connection: Connection; owner: { table: string; name: string; title: string } }) {
  const [query, setQuery] = useState('')
  const metaTitle = connectionLabel(connection)
  const peek = usePeek()
  const meta = useMeta(connection.table)
  const titleColumn = meta.data?.columns.find((column) => column.column_name === meta.data?.title_column)?.column_name ?? 'row_id'
  // This search can only add to the server-derived relation, never replace it.
  const filters: Filter[] = [...connection.filters, ...(query ? [[titleColumn, 'like', `%${query}%`] as Filter] : [])]
  return <section aria-label="Related rows" className="min-w-0 flex-1 space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Link to="/featherbase/admin/$table" params={{ table: connection.table }} search={{ filters: JSON.stringify(connection.filters) }} className={buttonClasses()}>Open full list</Link>
      {peek.available && <Button onClick={() => peek.push({ kind: 'list', table: connection.table, filters: connection.filters, title: metaTitle })}>Peek</Button>}
    </div>
    <SearchInput aria-label="Search related record names" placeholder="Search related rows" value={query} onChange={(event) => setQuery(event.target.value)} />
    <ListView table={connection.table} filters={filters}
      breadcrumb={<Breadcrumbs label="Related breadcrumb" items={[
        { label: owner.title, href: `/featherbase/admin/${encodeURIComponent(owner.table)}/${encodeURIComponent(owner.name)}` },
        { label: 'Related', href: '#related' },
        { label: metaTitle },
      ]} />}
      newRowPrefill={connection.via || connection.system_written ? null : { [connection.column]: owner.name }}
    />
  </section>
}
