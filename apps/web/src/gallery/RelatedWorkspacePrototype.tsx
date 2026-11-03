import { useState } from 'react'
import { Breadcrumbs, ContentTabs, SearchableList, SearchInput, Button, buttonClasses } from '../components/ui'
import { FormView } from '../components/FormView'
import { ListView, type Filter } from '../components/ListView'
import { useConnections, type Connection } from '../lib/connections'
import { usePeek } from '../components/Peek'

const owner = 'lab-north'
const key = (connection: Connection) => `${connection.table}:${connection.column}:${connection.via ?? ''}`
const label = (connection: Connection) => `${connection.table} · ${connection.via ? `${connection.via} / ` : ''}${connection.column}`

/** Dev-only composition: actual shell, native form/list, synthetic metadata. */
export function RelatedWorkspacePrototype() {
  const [tab, setTab] = useState('related')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const connections = useConnections('Lab Project', owner)
  const items = connections.data?.connections ?? []
  const active = items.find((connection) => key(connection) === selected) ?? items[0]
  const peek = usePeek()
  return <>
    <Breadcrumbs items={[{ label: 'Lab Project', href: '/featherbase/admin/Lab%20Project' }, { label: 'North workshop' }]} />
    <header><h1 className="text-2xl font-bold text-ink">North workshop</h1>
      <p className="text-sm text-ink-muted">Related option A · synthetic relationships, native ListView. Work mounts the existing FormView unchanged.</p>
    </header>
    <ContentTabs label="Project workspace prototype" value={tab} onChange={setTab} tabs={[
      { id: 'work', label: 'Work', content: <FormView table="Lab Project" name={owner} /> },
      { id: 'related', label: 'Related', content: <div className="flex min-h-full min-w-0 gap-6">
        <aside className="w-64 shrink-0 border-r border-border pr-4">
          <SearchableList label="Search relationships" items={items} query={query} onQueryChange={setQuery} getSearchText={(connection) => `${label(connection)} ${connection.count}`}>
            {(matching) => <nav aria-label="Relationships" className="flex flex-col gap-1">
              {matching.map((connection) => <button key={key(connection)} type="button" aria-pressed={key(active) === key(connection)}
                onClick={() => setSelected(key(connection))}
                className={`flex min-h-control items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left text-sm ${key(active) === key(connection) ? 'bg-action-tint text-action' : connection.count ? 'text-ink hover:bg-subtle' : 'text-ink-subtle hover:bg-subtle'}`}>
                <span>{label(connection)}</span><span>{connection.count}</span>
              </button>)}
              {!matching.length && <p className="text-sm text-ink-muted">No matching relationships.</p>}
            </nav>}
          </SearchableList>
        </aside>
        <section aria-label="Selected relationship" className="min-w-0 flex-1">
          {connections.isPending ? <p>Loading relationships…</p> : connections.isError ? <p role="alert">Cannot load relationships.</p> : active ? <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-ink">{label(active)}</h2>
              <div className="flex flex-wrap gap-2">
                <a className={buttonClasses()} href={`/featherbase/admin/${encodeURIComponent(active.table)}?filters=${encodeURIComponent(JSON.stringify(active.filters))}&returnTo=${encodeURIComponent('/prototype.html')}`}>Open full list</a>
                {peek.available && <Button onClick={() => peek.push({ kind: 'list', table: active.table, filters: active.filters, title: label(active) })}>Peek</Button>}
                {!active.via && !active.system_written && <a className={buttonClasses()} href={`/featherbase/admin/${encodeURIComponent(active.table)}/new?prefill=${encodeURIComponent(JSON.stringify({ [active.column]: owner }))}`}>New related row</a>}
              </div>
            </div>
            <RelatedNativeList key={key(active)} connection={active} />
          </> : <p>No readable relationships.</p>}
        </section>
      </div> },
    ]} />
  </>
}

function RelatedNativeList({ connection }: { connection: Connection }) {
  const [search, setSearch] = useState('')
  const filters: Filter[] = [...connection.filters, ...(search ? [['name', 'like', `%${search}%`] as Filter] : [])]
  return <div className="flex min-w-0 flex-col gap-4">
    <SearchInput aria-label="Search related record names" placeholder="Search related record names" value={search} onChange={(event) => setSearch(event.target.value)} />
    <ListView table={connection.table} filters={filters} />
  </div>
}
