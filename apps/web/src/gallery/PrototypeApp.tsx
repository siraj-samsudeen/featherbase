import { useEffect, useState, type ReactNode } from 'react'
import { createRootRoute, createRoute, createRouter, defaultStringifySearch, Outlet } from '@tanstack/react-router'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { parseFilters } from 'shared'
import { AdminLayout } from '../pages/AdminLayout'
import { ListView, type Filter } from '../components/ListView'
import { FormView } from '../components/FormView'
import { Breadcrumbs, Button, Notice, SearchInput, Select, Skeleton } from '../components/ui'
import { labScenarios, type LabScenario } from './fixtures'

/** Uses server filters, not a search of the currently loaded page. */
export function SearchableTableExample({ table, filters: supplied, onFiltersChange }: {
  table: string
  filters?: Filter[]
  onFiltersChange?: (filters: Filter[]) => void
}) {
  const [local, setLocal] = useState<Filter[]>([])
  const fetching = useIsFetching({ queryKey: ['list', table] }) > 0
  const filters = supplied ?? local
  const change = onFiltersChange ?? setLocal
  const query = String(filters.find(([column, operator]) => column === 'name' && operator === 'like')?.[2] ?? '').replaceAll('%', '')
  return <div className="flex min-w-0 flex-col gap-3" onClickCapture={(event) => {
    const anchor = (event.target as Element).closest('a')
    if (anchor?.pathname.startsWith(`/featherbase/admin/${encodeURIComponent(table)}/`)) {
      sessionStorage.setItem(`lab-return-${table}`, window.location.pathname + window.location.search)
    }
  }}>
    <div className="sticky top-0 z-10 bg-canvas py-1">
    <SearchInput aria-label={`Search ${table} names`} placeholder={`Search ${table} names`} value={query} onChange={(event) => {
      const other = filters.filter(([column, operator]) => !(column === 'name' && operator === 'like'))
      change(event.target.value ? [...other, ['name', 'like', `%${event.target.value}%`]] : other)
    }} />
    </div>
    {fetching && <Skeleton label={`Loading ${table}`} lines={4} />}
    <div hidden={fetching}><ListView table={table} filters={filters} onFiltersChange={change} /></div>
  </div>
}

function FixtureFrame({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [scenario, setScenario] = useState<LabScenario>('populated')
  useEffect(() => {
    void fetch('/__lab/scenario').then((response) => response.json()).then((data: { scenario: LabScenario }) => setScenario(data.scenario))
  }, [])
  async function reset(next: LabScenario) {
    const result = await fetch('/__lab/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: next }) })
    if (!result.ok) throw new Error('Cannot reset synthetic scenario')
    setScenario(next)
    const records = { predicate: (query: { queryKey: readonly unknown[] }) => ['list', 'doc', 'row-title'].includes(String(query.queryKey[0])) }
    await client.cancelQueries(records)
    await client.resetQueries(records)
  }
  return <div className="flex min-h-0 flex-1 flex-col gap-4">
    <div className="flex shrink-0 flex-wrap items-center gap-3">
      <Notice className="flex-1">Synthetic UI Lab · in-memory writes only. Permission scenarios are not security evidence.</Notice>
      <Select aria-label="Synthetic scenario" value={scenario} onChange={(event) => void reset(event.target.value as LabScenario)}>
        {labScenarios.map((item) => <option key={item}>{item}</option>)}
      </Select>
      <Button onClick={() => void reset(scenario)}>Reset data</Button>
    </div>
    {children}
  </div>
}

/** Dev composition seam: replace only content; keep the real shell, list and form. */
export function createPrototypeRouter(content: ReactNode) {
  const root = createRootRoute({ component: Outlet })
  const shell = createRoute({ getParentRoute: () => root, id: 'prototype-shell', component: () => <AdminLayout wide /> })
  const start = createRoute({ getParentRoute: () => shell, path: '/prototype.html', component: () => <FixtureFrame>{content}</FixtureFrame> })
  const list = createRoute({
    getParentRoute: () => shell, path: '/featherbase/admin/$table',
    validateSearch: (search: Record<string, unknown>) => ({ filters: typeof search.filters === 'string' ? search.filters : JSON.stringify(search.filters ?? []), returnTo: typeof search.returnTo === 'string' ? search.returnTo : undefined }),
    component: ListPage,
  })
  function ListPage() {
    const { table } = list.useParams()
    const { filters, returnTo } = list.useSearch()
    const navigate = list.useNavigate()
    return <FixtureFrame>
      <Breadcrumbs items={[{ label: 'UI Lab', href: '/prototype.html' }, ...(returnTo ? [{ label: 'Project', href: returnTo }] : []), { label: table }]} />
      <SearchableTableExample key={table} table={table} filters={parseFilters(filters)} onFiltersChange={(next) => void navigate({ search: (previous) => ({ ...previous, filters: JSON.stringify(next), returnTo }), replace: true })} />
    </FixtureFrame>
  }
  const form = createRoute({ getParentRoute: () => shell, path: '/featherbase/admin/$table/$name', component: FormPage })
  function FormPage() {
    const { table, name } = form.useParams()
    const collectionHref = sessionStorage.getItem(`lab-return-${table}`) ?? `/featherbase/admin/${encodeURIComponent(table)}`
    const projectHref = `/featherbase/admin/${encodeURIComponent(table)}/${encodeURIComponent(name)}`
    const related = `/featherbase/admin/Lab%20Task?filters=${encodeURIComponent(JSON.stringify([['project', '=', name]]))}&returnTo=${encodeURIComponent(projectHref)}`
    return <FixtureFrame>
      <Breadcrumbs items={[{ label: 'UI Lab', href: '/prototype.html' }, { label: table, href: collectionHref }, { label: name }]} />
      {table === 'Lab Project' && <a href={related} className="text-sm font-semibold text-action hover:underline">Related tasks →</a>}
      <FormView key={`${table}/${name}`} table={table} name={name} />
    </FixtureFrame>
  }
  return createRouter({ routeTree: root.addChildren([shell.addChildren([start, list, form])]), stringifySearch: (search) => defaultStringifySearch(search).replace(/\+/g, '%20') })
}
