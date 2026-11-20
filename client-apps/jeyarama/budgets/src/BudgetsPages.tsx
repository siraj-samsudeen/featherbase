// Budget versions: the list, and one version with its figures, where a Budget Editor changes
// a draft's cells, pastes a block from Excel, revises and approves.
import { Button, DataList, FigureMatrix, Notice, PasteRows, RecordLink, Segmented, Skeleton, TextInput, fmtLakhs, labelClasses, type FigureColumn, type FigureRow } from '@featherbase/shop-floor'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { listAll, runAction } from './api'
import { canEdit, canOpen, useBudget, useLines, usePlants, useRefresh, useSites, useVersions, withBases, type BudgetVersion } from './data'
import { amountOf, checkBudget, type BudgetValue, type CheckedRow } from './pasteRules'
import { chainOf, difference, figuresOf, monthsBetween, statementRows } from './plRules'
import { to, useRoute } from './route'
import { Page, Pick, PersonName, RegionLink, StatePill, StoreLink, VersionLink, dayInIndia, monthRange, num, storeName, withLineLinks } from './ui'
import { fmtMonth } from './words'

const covers = (v: BudgetVersion) => monthRange(v.covers_from, v.covers_to)
const monthKey = (day: string) => `${day.slice(0, 7)}-01`

export function BudgetsPage() {
  const versions = useVersions()
  if (versions.isLoading) return <Page title="Budgets"><Skeleton label="Loading budget versions" /></Page>
  const groups = new Map<string, BudgetVersion[]>()
  for (const version of versions.data ?? []) {
    const key = `${version.fiscal_year} ${version.budget_kind}`
    groups.set(key, [...(groups.get(key) ?? []), version])
  }
  return <Page title="Budgets" count={`${versions.data?.length ?? 0} versions`} status="The budget for a month is the latest approved version that covers it.">
    {versions.error && <Notice tone="negative">{versions.error.message}</Notice>}
    {!versions.data?.length && !versions.error && <Notice tone="info">No budget version yet. A Budget Editor adds the first one in Featherbase, then pastes its figures here.</Notice>}
    {[...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([group, rows]) => <section key={group} aria-label={`${group} Budgets`} className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold text-ink">{group} Budgets</h2>
      <DataList caption={`${group} budget versions`} rows={rows} rowKey={row => row.row_id} empty={{ title: 'No versions', body: 'Nothing here yet.' }} columns={[
        { key: 'version', header: 'Version', cell: row => <VersionLink id={row.row_id} />, phone: 'title' },
        { key: 'region', header: 'Region', cell: row => row.operating_region ? <RegionLink id={row.operating_region} /> : 'Every Region' },
        { key: 'covers', header: 'Covers', cell: covers },
        { key: 'state', header: 'State', cell: row => <StatePill state={row.version_state} />, phone: 'status' },
        { key: 'approved', header: 'Approved', cell: row => row.approved_at ? <>{dayInIndia(row.approved_at)} by <PersonName id={row.approved_by} /></> : '' },
        { key: 'based', header: 'Based On', cell: row => <VersionLink id={row.based_on} /> },
      ]} />
    </section>)}
  </Page>
}

type View = 'store' | 'line' | 'compare'

export function VersionPage({ id }: { id: string }) {
  const route = useRoute()
  const refresh = useRefresh()
  const [versions, lines, plants, sites] = [useVersions(), useLines(), usePlants(), useSites()]
  const version = versions.data?.find(v => v.row_id === id)
  const other = route.params.get('with') ?? ''
  const cells = useBudget(version?.budget_kind === 'P&L' ? withBases(versions.data, [id, ...(other ? [other] : [])]) : [])
  const [panel, setPanel] = useState<'' | 'paste' | 'revise' | 'approve'>('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState({ version_name: '', covers_from: '', covers_to: '' })

  if (versions.isLoading || lines.isLoading || plants.isLoading) return <Page title="Budget Version"><Skeleton label="Loading the version" lines={8} /></Page>
  if (!version) return <Page title="Budget Version"><Notice tone="negative">There is no budget version {id}, or you may not see it.</Notice></Page>

  const editing = canEdit() && version.version_state === 'Draft'
  const months = monthsBetween(version.covers_from, version.covers_to)
  // A revision holds only what it changes; its other figures are read from the version it is based on.
  const figures = new Map([id, ...(other ? [other] : [])].map(v => [v, figuresOf(versions.data ?? [], cells.data ?? [], v)]))
  const stores = [...new Set([...(figures.get(id)?.keys() ?? [])].map(key => key.split('|')[0]))].sort()
  const changedHere = [...(figures.get(id)?.values() ?? [])].filter(figure => figure.from === id).length
  // The stores this version can hold figures for: its region's, and any it already has.
  const regionOf = new Map((sites.data ?? []).map(site => [site.row_id, site.operating_region]))
  const inRegion = (plants.data ?? []).filter(plant => stores.includes(plant.row_id) || (plant.plant_type === 'Store' && (!version.operating_region || regionOf.get(plant.site ?? '') === version.operating_region)))
  const view = (route.params.get('view') as View) || 'store'
  const store = route.params.get('store') || stores[0] || inRegion[0]?.row_id || ''
  const budgetable = (lines.data ?? []).filter(line => line.level === 'Published' && line.line_kind !== 'Subtotal')
  const line = route.params.get('line') || budgetable[0]?.row_id || ''
  const others = (versions.data ?? []).filter(v => v.row_id !== id && v.budget_kind === version.budget_kind)

  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await work(); setPanel(''); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Could not save') } finally { setBusy(false) }
  }
  const amountsOf = (versionId: string, plant: string, month?: string) => {
    const amounts = new Map<string, number>()
    for (const [key, figure] of figures.get(versionId) ?? []) {
      const [p, m, line] = key.split('|')
      if (p === plant && (!month || m === month)) amounts.set(line, (amounts.get(line) ?? 0) + figure.amount)
    }
    return amounts
  }

  let columns: FigureColumn[] = [...months.map(month => ({ id: month, label: fmtMonth(month) })), { id: 'total', label: 'Total', total: true }]
  let rows: FigureRow[] = []
  let label = ''
  if (view === 'store') {
    const byMonth = statementRows(lines.data ?? [], months.map(month => ({ id: month, amounts: amountsOf(id, store, month) })))
    const total = statementRows(lines.data ?? [], [{ id: 'total', amounts: amountsOf(id, store) }])
    rows = byMonth.map((row, index) => ({ ...row, values: { ...row.values, total: total[index].values.total } }))
    label = `${version.version_name}: ${storeName(plants.data, store)}`
  } else if (view === 'line') {
    const perStore = stores.map(plant => {
      const values: Record<string, number> = Object.fromEntries(months.map(month => [month, amountsOf(id, plant, month).get(line) ?? 0]))
      return { id: plant, label: storeName(plants.data, plant), header: <StoreLink id={plant} />, values: { ...values, total: Object.values(values).reduce((a, b) => a + b, 0) } }
    })
    const sum = (column: string) => perStore.reduce((total, row) => total + (row.values as Record<string, number>)[column], 0)
    rows = [...perStore, ...(perStore.length ? [{ id: 'all', label: 'All Stores', strong: true, values: Object.fromEntries([...months, 'total'].map(column => [column, sum(column)])) }] : [])]
    label = `${version.version_name}: ${budgetable.find(l => l.row_id === line)?.line_name ?? ''} by store`
  } else {
    const otherVersion = others.find(v => v.row_id === other)
    const shared = otherVersion ? months.filter(month => monthsBetween(otherVersion.covers_from, otherVersion.covers_to).includes(month)) : []
    const sumOver = (versionId: string) => shared.reduce((total, month) => { for (const [l, amount] of amountsOf(versionId, store, month)) total.set(l, (total.get(l) ?? 0) + amount); return total }, new Map<string, number>())
    const [a, b] = [sumOver(id), other ? sumOver(other) : new Map<string, number>()]
    columns = [{ id: 'this', label: version.version_name }, { id: 'other', label: otherVersion?.version_name ?? 'Other Version' }, { id: 'difference', label: 'Difference', total: true }]
    rows = otherVersion ? statementRows(lines.data ?? [], [{ id: 'this', amounts: a }, { id: 'other', amounts: b }, { id: 'difference', amounts: difference(a, b) }]) : []
    label = `${version.version_name} against ${otherVersion?.version_name ?? 'another version'}: ${storeName(plants.data, store)}`
  }

  return <Page title={version.version_name} count={<><StatePill state={version.version_state} /><span>₹ lakhs</span></>}
    breadcrumb={<a href={to('budgets')} className="hover:underline">Budgets</a>}
    status={<>A {version.budget_kind} budget for {version.operating_region ? <RegionLink id={version.operating_region} /> : 'every region'}, {covers(version)}, {version.fiscal_year}.
      {version.approved_at && <> Approved {dayInIndia(version.approved_at)} by <PersonName id={version.approved_by} />.</>}
      {version.based_on && <> Based on <VersionLink id={version.based_on} />.</>}
      {version.source_file && <> Loaded from {version.source_file}.</>}{' '}
      <RecordLink table="budgets.budget_version" rowId={id} name="Details And History" href={to('record', `budget_version/${id}`)} /></>}
    actions={canEdit() && <div className="flex flex-wrap gap-2">
      {editing && version.budget_kind === 'P&L' && <Button onClick={() => setPanel(panel === 'paste' ? '' : 'paste')}>Paste From Excel</Button>}
      {version.version_state === 'Approved' && <Button onClick={() => { setRevision({ version_name: '', covers_from: months[0], covers_to: months[months.length - 1] }); setPanel(panel === 'revise' ? '' : 'revise') }}>Revise</Button>}
      {editing && <Button variant="primary" onClick={() => setPanel(panel === 'approve' ? '' : 'approve')}>Approve</Button>}
    </div>}>
    {error && <Notice tone="negative">{error}</Notice>}
    {panel === 'revise' && <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void run(async () => {
      const made = await runAction<{ version: string }>('revise_version', { version: id, version_name: revision.version_name, covers_from: revision.covers_from, covers_to: revision.covers_to })
      location.hash = to('version', made.version)
    }) }}>
      <label><span className={labelClasses('mb-1')}>Name Of The Revision</span><TextInput required value={revision.version_name} onChange={event => setRevision({ ...revision, version_name: event.target.value })} /></label>
      <Pick label="First Month" value={revision.covers_from} onChange={value => setRevision({ ...revision, covers_from: value, covers_to: value > revision.covers_to ? value : revision.covers_to })} options={months.map(month => ({ value: month, label: fmtMonth(month) }))} />
      <Pick label="Last Month" value={revision.covers_to} onChange={value => setRevision({ ...revision, covers_to: value })} options={months.filter(month => month >= revision.covers_from).map(month => ({ value: month, label: fmtMonth(month) }))} />
      <Button type="submit" variant="primary" loading={busy}>Make The Revision</Button>
      <p className="basis-full text-sm text-ink-muted">A revision is a new draft for these months. It shows this version's figures and holds only the ones you change. Once approved it is the budget for the months it covers.</p>
    </form>}
    {panel === 'approve' && <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-ink">Approve {version.version_name}? It becomes the budget for {covers(version)}, and its figures can no longer be changed, only revised.</p>
      <Button variant="primary" loading={busy} onClick={() => run(() => runAction('approve_version', { version: id }))}>Approve {version.version_name}</Button>
      <Button onClick={() => setPanel('')}>Not Now</Button>
    </div>}
    {version.budget_kind === 'Sales'
      ? <SalesFigures version={version} store={store} onStore={value => route.set({ store: value })} />
      : <>
        {panel === 'paste' && <PasteRows<CheckedRow<BudgetValue>> label="Budget figures" noun="amount" saved={checked => checked.reduce((n, row) => n + row.values.length, 0)}
          hint={`Copy a block from Excel with the headings Store, Line and one column per month (${fmtMonth(months[0])}), amounts in rupees, and paste it here. A figure already in this version is replaced.`}
          check={pasted => checkBudget(pasted, { plants: plants.data ?? [], lines: lines.data ?? [], months })}
          onSave={async (checked) => { await runAction('paste_budget', { version: id, values: checked.flatMap(row => row.values) }); await refresh() }} />}
        <div className="flex flex-wrap items-end gap-3">
          <Segmented label="Figures by" value={view} onChange={value => route.set({ view: value })} options={[{ value: 'store', label: 'One Store' }, { value: 'line', label: 'One Line' }, { value: 'compare', label: 'Compare' }]} />
          {view !== 'line' && <Pick label="Store" value={store} onChange={value => route.set({ store: value })} options={inRegion.map(plant => ({ value: plant.row_id, label: `${storeName(plants.data, plant.row_id)} · ${plant.row_id}` }))} />}
          {view === 'line' && <Pick label="Line" value={line} onChange={value => route.set({ line: value })} options={budgetable.map(l => ({ value: l.row_id, label: l.line_name }))} />}
          {view === 'compare' && <Pick label="Compare With" value={other} onChange={value => route.set({ with: value || null })} options={[{ value: '', label: 'Choose A Version' }, ...others.map(v => ({ value: v.row_id, label: v.version_name }))]} />}
        </div>
        {editing && view !== 'compare' && <p className="text-sm text-ink-muted">Select a figure to change it. Type the amount in rupees; Enter saves, Escape leaves it.{version.based_on && <> This revision changes {changedHere} {changedHere === 1 ? 'figure' : 'figures'}; the rest are those of <VersionLink id={version.based_on} />.</>}</p>}
        {!editing && version.based_on && <p className="text-sm text-ink-muted">This revision changes {changedHere} {changedHere === 1 ? 'figure' : 'figures'}; the rest are those of <VersionLink id={version.based_on} />.</p>}
        {cells.isLoading ? <Skeleton label="Loading figures" lines={8} /> : <FigureMatrix label={label} rowHeading={view === 'line' ? 'Store' : 'Line'} columns={columns} rows={view === 'line' ? rows : withLineLinks(rows)} format={fmtLakhs} parse={amountOf}
          editable={(row, column) => editing && view !== 'compare' && !row.strong && !column.total}
          onEdit={(row, column, value) => run(() => runAction('paste_budget', { version: id, values: [{ plant: view === 'line' ? row.id : store, pl_line: view === 'line' ? line : row.id, budget_month: column.id, amount: value }] }))}
          empty={view === 'compare' ? 'Choose a version to compare with.' : 'No figures in this version yet.'} />}
      </>}
  </Page>
}

interface SalesRow { row_id: string; budget_version: string; budget_month: string; subcategory: string; budget_value: string | number }

/** A sales version, one store at a time: subcategories down, months across. */
function SalesFigures({ version, store, onStore }: { version: BudgetVersion; store: string; onStore: (store: string) => void }) {
  const plants = usePlants()
  const months = monthsBetween(version.covers_from, version.covers_to)
  const versions = useVersions()
  const chain = chainOf(versions.data ?? [], version.row_id).map(v => v.row_id)
  const sales = useQuery({ queryKey: ['budgets', 'sales_budget', version.row_id, store, chain.length], enabled: !!store && chain.length > 0,
    queryFn: () => listAll<SalesRow>('budgets.sales_budget', { fields: ['row_id', 'budget_version', 'budget_month', 'subcategory', 'budget_value'], filters: [['budget_version', 'in', chain], ['plant', '=', store]] }) })
  const names = useQuery({ queryKey: ['budgets', 'instance', 'Subcategory'], staleTime: 300_000, queryFn: () => listAll<{ row_id: string; subcategory: string }>('Subcategory', { fields: ['row_id', 'subcategory'] }) })
  // As for a P&L version: its own figure where it has one, else the one of the version it is based on.
  const read = figuresOf(versions.data ?? [], (sales.data ?? []).map(row => ({ budget_version: row.budget_version, plant: store, budget_month: row.budget_month, pl_line: row.subcategory, amount: row.budget_value })), version.row_id)
  const bySubcategory = new Map<string, Record<string, number>>()
  for (const [key, figure] of read) {
    const [, month, subcategory] = key.split('|')
    bySubcategory.set(subcategory, { ...(bySubcategory.get(subcategory) ?? {}), [month]: figure.amount })
  }
  const nameOf = (id: string) => names.data?.find(s => s.row_id === id)?.subcategory ?? `Subcategory ${id}`
  const rows: FigureRow[] = [...bySubcategory.entries()].map(([id, values]) => ({ id, label: nameOf(id), header: <RecordLink table="Subcategory" rowId={id} name={nameOf(id)} detail={id} canOpen={canOpen('Subcategory')} />,
    values: { ...values, total: Object.values(values).reduce((a, b) => a + b, 0) } })).sort((a, b) => a.label.localeCompare(b.label))
  const total = (column: string) => rows.reduce((sum, row) => sum + ((row.values[column] as number) ?? 0), 0)
  return <>
    <Pick label="Store" value={store} onChange={onStore} options={(plants.data ?? []).filter(plant => plant.plant_type === 'Store').map(plant => ({ value: plant.row_id, label: `${storeName(plants.data, plant.row_id)} · ${plant.row_id}` }))} className="w-fit" />
    {sales.isLoading ? <Skeleton label="Loading sales budget" lines={6} /> : <FigureMatrix label={`${version.version_name}: ${storeName(plants.data, store)} by subcategory`} rowHeading="Subcategory" format={fmtLakhs}
      columns={[...months.map(month => ({ id: month, label: fmtMonth(month) })), { id: 'total', label: 'Total', total: true }]}
      rows={rows.length ? [...rows, { id: 'all', label: 'All Subcategories', strong: true, values: Object.fromEntries([...months, 'total'].map(column => [column, total(column)])) }] : []}
      empty="No sales budget for this store in this version." />}
  </>
}
