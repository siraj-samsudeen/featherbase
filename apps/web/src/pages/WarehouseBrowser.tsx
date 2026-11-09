import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { fmtCount } from '@featherbase/shop-floor'
import { formatValue, useSettings } from '../lib/settings'
import { browserHref, lastPlace, listTables, previewTable, refreshTables, rememberPlace, type BrowseContext, type WarehouseSource } from '../lib/warehouse'
import { Breadcrumbs, Button, ContentTabs, DataList, Notice, SearchableList, Select, Skeleton, buttonClasses, type DataColumn } from '@featherbase/shop-floor'

type CatalogRow = { schema: string; name: string; rows: number; columns: number }
const EMPTY = { title: 'No matches', body: 'Try a different search or schema.' }

export function WarehouseBrowser({ name, ...context }: { name: string } & BrowseContext) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const settings = useSettings()
  const { database, schema, table, tableSchema, query = '', columnQuery = '', databaseQuery = '', schemaQuery = '' } = context
  const tab = context.tab === 'preview' ? 'preview' : 'catalog'
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const source = useQuery({
    queryKey: ['data-source', name],
    queryFn: () => api.get<WarehouseSource>(`/api/table/Data%20Source/${encodeURIComponent(name)}`),
  })
  const databases = source.data?.databases ?? []
  const go = (patch: Partial<BrowseContext>, replace = false) => navigate({
    to: '/featherbase/admin/source/$name', params: { name }, search: { ...context, ...patch }, replace,
  })

  useEffect(() => {
    if (!databases.length || database) return
    const place = lastPlace(name)
    const db = databases.some((d) => d.name === place.database) ? place.database! : databases[0].name
    void navigate({ to: '/featherbase/admin/source/$name', params: { name }, search: { database: db, schema: db === place.database ? place.schema : undefined }, replace: true })
  }, [databases, database, name, navigate])

  useEffect(() => {
    if (database) rememberPlace(name, { database, schema })
  }, [name, database, schema])

  const listing = useQuery({
    queryKey: ['warehouse-tables', name, database],
    queryFn: () => listTables(name, database!), enabled: !!database, staleTime: Infinity,
  })
  const schemas = listing.data?.schemas ?? []
  const catalog = schemas.flatMap((s) => s.tables.map((t) => ({ ...t, schema: s.schema })))
    .filter((row) => !schema || row.schema === schema)
  const columns: DataColumn<CatalogRow>[] = [
    { key: 'name', header: 'Table', cell: (row) => <Button variant="quiet" onClick={() => go({ table: row.name, tableSchema: row.schema, tab: 'preview' })}>{row.name}</Button> },
    { key: 'schema', header: 'Schema', cell: (row) => row.schema },
    { key: 'rows', header: 'Estimated rows', align: 'end', cell: (row) => fmtCount(row.rows) },
    { key: 'columns', header: 'Columns', align: 'end', cell: (row) => fmtCount(row.columns) },
  ]

  // Refresh is drawn only over a database's listing.
  async function refresh() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      queryClient.setQueryData(['warehouse-tables', name, database], await refreshTables(name, database!))
    } catch (err) {
      setRefreshError(err instanceof ApiError ? err.message : 'The table list could not be refreshed')
    } finally {
      setRefreshing(false)
    }
  }

  if ((!database || listing.isPending) && !listing.error) return (
    <div data-testid="browser-loading"><Skeleton label={`Opening ${database ?? name}. The first listing can take up to a minute; it is kept until you refresh.`} /></div>
  )
  return (
    <div data-testid="warehouse-browser" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <Breadcrumbs items={[
        { label: 'Admin', href: '/featherbase/admin' },
        { label: 'Data Source', href: '/featherbase/admin/table/data-source' },
        { label: name, href: `/featherbase/admin/table/data-source/row/${encodeURIComponent(name)}` },
        { label: database ?? 'Browse tables', href: tab === 'preview' ? browserHref(name, { ...context, tab: 'catalog' }) : undefined },
        ...(tab === 'preview' ? table
          ? [{ label: tableSchema ?? schema ?? '', href: browserHref(name, { ...context, tab: 'catalog' }) }, { label: table }]
          : [{ label: 'Preview' }] : []),
      ]} />
      <header><h1 className="text-xl font-semibold text-ink">Browse tables</h1><p className="text-sm text-ink-muted">{name} · MotherDuck · read only</p></header>
      {refreshError && <Notice tone="negative">{refreshError}</Notice>}
      <ContentTabs label="Warehouse browser" value={tab} onChange={(value) => go({ tab: value })} tabs={[
        { id: 'catalog', label: 'Tables', content: (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-72">
                <SearchableList label="Databases" items={databases} query={databaseQuery} onQueryChange={(value) => go({ databaseQuery: value }, true)} getSearchText={(row) => `${row.name} ${row.owner}`}>
                  {(matching) => <Select aria-label="Database" data-testid="browser-database" value={database ?? ''} onChange={(event) => go({ database: event.target.value, schema: undefined, table: undefined, tableSchema: undefined, tab: 'catalog' })}>
                    {database && !matching.some((d) => d.name === database) && <option value={database}>{database} (selected)</option>}
                    {matching.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                    {!matching.length && <option disabled>No matching databases</option>}
                  </Select>}
                </SearchableList>
              </div>
              <div className="w-72"><SearchableList label="Schemas" items={schemas} query={schemaQuery} onQueryChange={(value) => go({ schemaQuery: value }, true)} getSearchText={(s) => s.schema}>
                {(matching) => <Select aria-label="Schema" value={schema ?? ''} onChange={(event) => go({ schema: event.target.value || undefined })}>
                  <option value="">All schemas</option>
                  {schema && !matching.some((s) => s.schema === schema) && <option value={schema}>{schema} (selected)</option>}
                  {matching.map((s) => <option key={s.schema} value={s.schema}>{s.schema}</option>)}
                  {!matching.length && <option disabled>No matching schemas</option>}
                </Select>}
              </SearchableList></div>
              {listing.data && <span className="text-sm text-ink-muted" data-testid="browser-listed-at">Listed {formatValue('Datetime', listing.data.listed_at, settings)}</span>}
              <Button onClick={refresh} loading={refreshing} disabled={!listing.data} data-testid="browser-refresh">Refresh</Button>
            </div>
            {listing.isPending && database && <p data-testid="browser-loading">Opening {database}… The first time can take up to a minute; after that the list is kept until you refresh it.</p>}
            {listing.error && <Notice tone="negative">{listing.error instanceof ApiError ? listing.error.message : 'The table list could not be read'}</Notice>}
            {listing.data && <SearchableList label="Tables" items={catalog} query={query} onQueryChange={(value) => go({ query: value }, true)} getSearchText={(row) => `${database} ${row.schema} ${row.name}`}>
              {(matching) => <DataList caption="Warehouse tables" rows={matching} columns={columns} rowKey={(row) => `${row.schema}/${row.name}`} layout="table" empty={EMPTY} />}
            </SearchableList>}
          </div>
        ) },
        { id: 'preview', label: table ? `Preview · ${table}` : 'Preview', content: table && database ? (
          <Preview name={name} database={database} schema={tableSchema ?? schema ?? ''} table={table} context={context} columnQuery={columnQuery} onColumnQuery={(value) => go({ columnQuery: value }, true)} />
        ) : <p className="text-sm text-ink-muted">Pick a table in the catalog to preview it.</p> },
      ]} />
    </div>
  )
}

function Preview({ name, database, schema, table, context, columnQuery, onColumnQuery }: {
  name: string; database: string; schema: string; table: string; context: BrowseContext; columnQuery: string; onColumnQuery: (value: string) => void
}) {
  const preview = useQuery({ queryKey: ['warehouse-preview', name, database, schema, table], queryFn: () => previewTable(name, database, schema, table) })
  const shown = (preview.data?.columns ?? []).filter((c) => !c.name.startsWith('_')).slice(0, 12)
  return (
    <div data-testid="pane-preview" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-ink">{table}</h2><p className="text-sm text-ink-muted" data-testid="preview-size">{database} · {schema}{preview.data && ` · ${fmtCount(preview.data.rows)} rows · ${fmtCount(preview.data.columns.length)} columns`}</p></div>
        <Link to="/featherbase/admin/source/$name/copy" params={{ name }} search={{ database, schema, table, returnTo: browserHref(name, { ...context, tab: 'preview' }) }} className={buttonClasses({ variant: 'primary' })} data-testid="preview-copy">Copy into Featherbase…</Link>
      </div>
      {preview.isPending && <Skeleton label="Reading the first rows" />}
      {preview.error && <Notice tone="negative">{preview.error instanceof ApiError ? preview.error.message : 'The table could not be read'}</Notice>}
      {preview.data && <>
        <div data-testid="preview-rows"><DataList<{ row: Record<string, unknown>; index: number }> caption="First rows · read only" rows={preview.data.first_rows.map((row, index) => ({ row, index }))} columns={shown.map((c) => ({ key: c.name, header: c.name, cell: ({ row }) => row[c.name] == null ? '—' : String(row[c.name]) }))} rowKey={({ index }) => String(index)} layout="table" empty={{ title: 'No rows', body: 'This source table is empty.' }} /></div>
        <div data-testid="preview-columns"><SearchableList label="Columns" items={preview.data.columns} query={columnQuery} onQueryChange={onColumnQuery} getSearchText={(column) => `${column.name} ${column.type}`}>
          {(matching) => <DataList caption="Source columns" rows={matching} columns={[
            { key: 'name', header: 'Column', cell: (column) => <span className={column.name.startsWith('_') ? 'text-ink-subtle' : 'font-mono'}>{column.name}</span> },
            { key: 'type', header: 'Warehouse type', cell: (column) => column.type },
          ]} rowKey={(column) => column.name} layout="table" empty={EMPTY} />}
        </SearchableList></div>
        {preview.data.columns.some((column) => column.name.startsWith('_')) && <p className="text-sm text-ink-muted">Greyed columns start with _: the warehouse's own load bookkeeping.</p>}
      </>}
    </div>
  )
}
