// #772 checklist 9, #969: a MotherDuck source, read with the instance's one token,
// so there is no token here to see or change. Any other source keeps the native
// Data Source form.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { type WarehouseSource as Source } from '../lib/warehouse'
import { Breadcrumbs, DataList, SearchableList, Skeleton, buttonClasses, cardClasses } from '@featherbase/shop-floor'
import { FormView } from '../components/FormView'

export default function WarehouseSource({ name }: { name: string }) {
  const source = useQuery({
    queryKey: ['data-source', name],
    queryFn: () => api.get<Source>(`/api/table/Data%20Source/${encodeURIComponent(name)}`),
  })
  if (source.isPending) return <Skeleton label="Loading the data source" />
  if (source.data?.engine !== 'motherduck') return <FormView table="Data Source" name={name} />
  return <WarehouseDetails source={source.data} />
}

function WarehouseDetails({ source }: { source: Source }) {
  const [query, setQuery] = useState('')
  const databases = source.databases ?? []

  return (
    <div data-testid="warehouse-source">
      <div className="mb-4"><Breadcrumbs items={[
        { label: 'Admin', href: '/featherbase/admin' },
        { label: 'Data Source', href: '/featherbase/admin/table/data-source' },
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
          <dd className="text-ink">This server's MotherDuck token</dd>
        </dl>
        <div className="mt-5" data-testid="warehouse-databases"><SearchableList label="Databases" items={databases} query={query} onQueryChange={setQuery} getSearchText={(d) => `${d.name} ${d.owner ?? ''}`}>
          {(matching) => <DataList caption="Connected databases" rows={matching} columns={[
            { key: 'name', header: 'Database', cell: (d) => <Link to="/featherbase/admin/source/$name" params={{ name: source.row_id }} search={{ database: d.name, schema: undefined }} className="text-action hover:underline">{d.name}</Link> },
            { key: 'owner', header: 'Owner', cell: (d) => d.owner ?? '—' },
          ]} rowKey={(d) => d.name} layout="table" empty={{ title: 'No matching databases', body: 'Try a different search.' }} />}
        </SearchableList></div>
      </section>
    </div>
  )
}
