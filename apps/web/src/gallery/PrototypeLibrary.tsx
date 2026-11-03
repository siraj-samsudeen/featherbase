import { useState } from 'react'
import { parseFilters } from 'shared'
import { Breadcrumbs, ContentTabs, DataList, SearchableList, TextInput, buttonClasses } from '../components/ui'
import { Gallery } from './Gallery'
import { SearchableTableExample } from './PrototypeApp'

const examples = [
  { name: 'Project records', kind: 'Metadata Table', component: 'ListView → FormView', target: 'Lab Project' },
  { name: 'Related tasks', kind: 'Metadata Table', component: 'ListView → FormView', target: 'Lab Task' },
]

export function PrototypeLibrary() {
  const params = new URLSearchParams(window.location.search)
  const initialTab = params.get('labTab') ?? 'catalog'
  const [tab, setTab] = useState(['catalog', 'records', 'components'].includes(initialTab) ? initialTab : 'catalog')
  const [filters, setFilters] = useState(() => parseFilters(params.get('labFilters') ?? undefined))
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  function remember(key: string, value: string) {
    const url = new URL(window.location.href)
    url.searchParams.set(key, value)
    window.history.replaceState(window.history.state, '', url)
  }
  return <>
    <Breadcrumbs items={[{ label: 'UI Lab' }]} />
    <header className="shrink-0"><h1 className="text-2xl font-bold text-ink">Build with what exists</h1>
      <p className="mt-1 text-sm text-ink-muted">Native shell and components. Tabs use the available canvas, not tables inside cards.</p>
    </header>
    <ContentTabs label="Prototype library" value={tab} onChange={(next) => { setTab(next); remember('labTab', next) }} tabs={[
      { id: 'catalog', label: 'Screen starter', content: <SearchableList label="Search screen starters" items={examples} query={query} onQueryChange={setQuery} getSearchText={(row) => `${row.name} ${row.kind} ${row.component}`}>
        {(matching) => <DataList caption="Reusable screen starters" rows={matching} rowKey={(row) => row.target} empty={{ title: 'No matching starters', body: 'Try Project or Task.' }} columns={[
          { key: 'name', header: 'Example', cell: (row) => <a className="text-action hover:underline" href={`/featherbase/admin/${encodeURIComponent(row.target)}`}>{row.name}</a> },
          { key: 'kind', header: 'Data contract', cell: (row) => row.kind },
          { key: 'component', header: 'Actual renderer', cell: (row) => row.component },
          { key: 'notes', header: 'Editable planning note', cell: (row) => <TextInput aria-label={`Note for ${row.name}`} value={notes[row.target] ?? ''} placeholder="Try a draft, then switch tabs" onChange={(event) => setNotes({ ...notes, [row.target]: event.target.value })} /> },
        ]} />}
      </SearchableList> },
      { id: 'records', label: 'Native Table list', content: <div className="flex flex-col gap-3"><p className="text-sm text-ink-muted">Unmodified metadata-driven ListView. Open a row to use the real FormView.</p><SearchableTableExample table="Lab Project" filters={filters} onFiltersChange={(next) => { setFilters(next); remember('labFilters', JSON.stringify(next)) }} /><a href="/featherbase/admin/Lab%20Project" className={buttonClasses()}>Open list with shareable filters</a></div> },
      { id: 'components', label: 'Component gallery', content: <Gallery /> },
    ]} />
  </>
}
