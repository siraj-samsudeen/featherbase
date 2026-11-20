// The P&L as the finance team reads it: stores by line for a month, one store across the
// year, and the bridge from budget to actual. Budgets come from the versions in force;
// actuals from the warehouse, when one is connected.
import { FigureMatrix, Notice, Segmented, Skeleton, fmtLakhs, type FigureColumn } from '@featherbase/shop-floor'
import { useMemo } from 'react'
import { useActuals, useBudget, useCloses, useLines, usePlants, useSites, useVersions, withBases, type Actual, type BudgetCell, type BudgetVersion, type Plant, type PlLine } from './data'
import { budgetInForce, difference, figuresOf, fiscalMonths, statementRows } from './plRules'
import { to, useRoute } from './route'
import { Page, Pick, StoreLink, VersionLink, storeName, withLineLinks } from './ui'
import { fmtMonth } from './words'

type View = 'stores' | 'store' | 'bridge'
type Show = 'budget' | 'actual' | 'variance'
type Amounts = Map<string, number>

const thisMonth = () => `${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7)}-01`
const bump = (amounts: Amounts, line: string, amount: number) => amounts.set(line, Math.round(((amounts.get(line) ?? 0) + amount) * 100) / 100)

/** Budget amounts by store and month: each month from its own version in force, a revision read through the version it is based on. */
function budgetBy(cells: BudgetCell[], versions: BudgetVersion[], inForce: Map<string, string>) {
  const by = new Map<string, Amounts>()
  for (const version of new Set(inForce.values()))
    for (const [key, figure] of figuresOf(versions, cells, version)) {
      const [plant, month, line] = key.split('|')
      if (inForce.get(month) !== version) continue
      if (!by.has(`${plant}|${month}`)) by.set(`${plant}|${month}`, new Map())
      by.get(`${plant}|${month}`)!.set(line, figure.amount)
    }
  return by
}

/** Actual amounts by store and month, from each month's latest close, on the lines the app knows. */
function actualBy(rows: Actual[], lines: PlLine[], asPosted: boolean) {
  const latest = new Map<string, number>()
  for (const row of rows) latest.set(`${row.company_code}|${row.close_month}`, Math.max(latest.get(`${row.company_code}|${row.close_month}`) ?? 0, row.close_version))
  const lineOf = new Map(lines.map(line => [line.line_key, line.row_id]))
  const by = new Map<string, Amounts>()
  for (const row of rows) {
    const line = lineOf.get(row.line_key)
    if (!line || row.close_version !== latest.get(`${row.company_code}|${row.close_month}`)) continue
    const key = `${row.plant_code}|${row.close_month.slice(0, 7)}-01`
    if (!by.has(key)) by.set(key, new Map())
    bump(by.get(key)!, line, Number(asPosted ? row.as_posted : row.as_published))
  }
  return by
}

const EMPTY: Amounts = new Map()

export function PlPage() {
  const route = useRoute()
  const [lines, plants, sites, versions, closes] = [useLines(), usePlants(), useSites(), useVersions(), useCloses()]
  const regions = useMemo(() => [...new Set((sites.data ?? []).map(site => site.operating_region).filter((r): r is string => !!r))].sort(), [sites.data])
  const view = (route.params.get('view') as View) || 'stores'
  const region = route.params.get('region') || regions[0] || ''
  const month = route.params.get('month') || closes.data?.[0]?.close_month.slice(0, 10) || thisMonth()
  const asPosted = route.params.get('basis') === 'posted'
  const year = fiscalMonths(month)
  const months = view === 'store' ? year : [month]

  const regionPlants = useMemo(() => {
    const regionOf = new Map((sites.data ?? []).map(site => [site.row_id, site.operating_region]))
    const order = (plant: Plant) => (plant.plant_type === 'Store' ? 0 : 1)
    return (plants.data ?? []).filter(plant => regionOf.get(plant.site ?? '') === region).sort((a, b) => order(a) - order(b) || a.row_id.localeCompare(b.row_id))
  }, [plants.data, sites.data, region])
  const store = route.params.get('store') || regionPlants[0]?.row_id || ''

  const inForce = useMemo(() => budgetInForce(versions.data ?? [], 'P&L', region || null, months), [versions.data, region, months.join()])
  const versionIds = [...new Set(inForce.values())]
  const budget = useBudget(withBases(versions.data, versionIds))
  const actuals = useActuals(months)
  const connected = actuals.data?.connected === true
  const show: Show = connected ? ((route.params.get('show') as Show) || 'budget') : 'budget'

  if (lines.isLoading || plants.isLoading || sites.isLoading || versions.isLoading) return <Page title="P&L"><Skeleton label="Loading the P&L" lines={8} /></Page>
  const failed = lines.error ?? plants.error ?? sites.error ?? versions.error ?? budget.error
  if (failed) return <Page title="P&L"><Notice tone="negative">{failed.message}</Notice></Page>

  const budgets = budgetBy(budget.data ?? [], versions.data ?? [], inForce)
  const actual = actualBy(actuals.data?.rows ?? [], lines.data ?? [], asPosted)
  // A month has actuals once its close reached the warehouse; before that there is nothing to compare.
  const closed = new Set((actuals.data?.rows ?? []).map(row => `${row.close_month.slice(0, 7)}-01`))
  const pick = (plant: string, m: string): Amounts => {
    const b = budgets.get(`${plant}|${m}`) ?? EMPTY
    const a = actual.get(`${plant}|${m}`) ?? EMPTY
    return show === 'budget' ? b : show === 'actual' ? a : difference(a, b)
  }
  const withFigures = regionPlants.filter(plant => months.some(m => budgets.has(`${plant.row_id}|${m}`) || actual.has(`${plant.row_id}|${m}`)))
  const shown = withFigures.length ? withFigures : regionPlants.filter(plant => plant.plant_type === 'Store')

  let columns: FigureColumn[] = []
  let rows: ReturnType<typeof statementRows> = []
  let label = ''
  if (view === 'stores') {
    columns = [...shown.map(plant => ({ id: plant.row_id, label: storeName(plants.data, plant.row_id), header: <StoreLink id={plant.row_id} /> })), { id: 'total', label: `${region} Total`, total: true }]
    rows = statementRows(lines.data ?? [], shown.map(plant => ({ id: plant.row_id, amounts: pick(plant.row_id, month) })), 'total')
    label = `P&L by store, ${fmtMonth(month)}, ${region}`
  } else if (view === 'store') {
    // Actual and Variance stop at the last month closed: a month with no close is blank, not nothing.
    const has = (m: string) => show === 'budget' || closed.has(m)
    const through = year.filter(m => m <= month && has(m))
    columns = [...year.map(m => ({ id: m, label: fmtMonth(m) })), { id: 'ytd', label: 'Year To Date', total: true }]
    const byMonth = statementRows(lines.data ?? [], year.map(m => ({ id: m, amounts: pick(store, m) })))
    const ytd = statementRows(lines.data ?? [], through.map(m => ({ id: m, amounts: pick(store, m) })), 'ytd')
    const merge = (row: (typeof byMonth)[number], other: (typeof ytd)[number] | undefined): (typeof byMonth)[number] => ({ ...row,
      values: { ...Object.fromEntries(Object.entries(row.values).map(([m, amount]) => [m, has(m) ? amount : null])) as Record<string, number>, ytd: other?.values.ytd ?? 0 },
      ...(row.children ? { children: row.children.map(child => merge(child, other?.children?.find(c => c.id === child.id))) } : {}) })
    rows = byMonth.map((row, index) => merge(row, ytd[index]))
    label = `P&L of ${storeName(plants.data, store)}, ${fmtMonth(year[0])} to ${fmtMonth(year[11])}`
  } else {
    const sum = (source: Map<string, Amounts>) => shown.reduce((total, plant) => { for (const [line, amount] of source.get(`${plant.row_id}|${month}`) ?? EMPTY) bump(total, line, amount); return total }, new Map<string, number>())
    const [b, a] = [sum(budgets), sum(actual)]
    const compared = connected && closed.has(month)
    columns = compared ? [{ id: 'budget', label: 'Budget' }, { id: 'actual', label: 'Actual' }, { id: 'difference', label: 'Difference', total: true }] : [{ id: 'budget', label: 'Budget' }]
    rows = statementRows(lines.data ?? [], compared ? [{ id: 'budget', amounts: b }, { id: 'actual', amounts: a }, { id: 'difference', amounts: difference(a, b) }] : [{ id: 'budget', amounts: b }])
    label = `Bridge from budget to actual, ${fmtMonth(month)}, ${region}`
  }
  const noActuals = show !== 'budget' && view === 'stores' && !closed.has(month)
  const anyFigure = !noActuals && rows.some(row => Object.values(row.values).some(value => value != null && value !== 0))
  const monthOptions = [...new Set([...year, ...(closes.data ?? []).map(close => `${close.close_month.slice(0, 7)}-01`), month])].sort().reverse().map(m => ({ value: m, label: fmtMonth(m) }))

  return <Page title="P&L" count="₹ lakhs"
    status={versionIds.length
      ? <>Budget: {versionIds.map((id, index) => <span key={id}>{index > 0 && ', '}<VersionLink id={id} /></span>)}{view !== 'store' && `, for ${fmtMonth(month)}`}</>
      : `No approved budget covers ${view === 'store' ? 'this year' : fmtMonth(month)} for ${region || 'this region'}.`}
    actions={<div className="flex flex-wrap items-end gap-3">
      <Pick label="Month" value={month} onChange={value => route.set({ month: value })} options={monthOptions} />
      <Pick label="Region" value={region} onChange={value => route.set({ region: value, store: null })} options={regions.map(r => ({ value: r, label: r }))} />
      {view === 'store' && <Pick label="Store" value={store} onChange={value => route.set({ store: value })} options={regionPlants.map(plant => ({ value: plant.row_id, label: `${storeName(plants.data, plant.row_id)} · ${plant.row_id}` }))} />}
    </div>}>
    <div className="flex flex-wrap items-center gap-3">
      <Segmented label="View" value={view} onChange={value => route.set({ view: value })} options={[{ value: 'stores', label: 'Stores By Line' }, { value: 'store', label: 'One Store By Month' }, { value: 'bridge', label: 'Bridge' }]} />
      {connected && view !== 'bridge' && <Segmented label="Figures" value={show} onChange={value => route.set({ show: value })} options={[{ value: 'budget', label: 'Budget' }, { value: 'actual', label: 'Actual' }, { value: 'variance', label: 'Variance' }]} />}
      {connected && (view === 'bridge' || show !== 'budget') && <Segmented label="Actual as" value={asPosted ? 'posted' : 'published'} onChange={value => route.set({ basis: value === 'posted' ? 'posted' : null })} options={[{ value: 'published', label: 'As Published' }, { value: 'posted', label: 'As Posted' }]} />}
    </div>
    {actuals.data && !connected && <Notice tone="info">Actuals are not connected yet.</Notice>}
    {connected && view === 'bridge' && !closed.has(month) && <Notice tone="info">{`No actuals for ${fmtMonth(month)} yet: its close has not reached the warehouse.`}</Notice>}
    {actuals.error && <Notice tone="negative">{actuals.error.message}</Notice>}
    <FigureMatrix label={label} rowHeading="Line" columns={columns} rows={anyFigure ? withLineLinks(rows) : []} format={fmtLakhs}
      cellHref={(row, column) => (show === 'budget' && view === 'stores' && !row.strong && !column.total && inForce.get(month) ? to('version', inForce.get(month)!, { store: column.id }) : undefined)}
      empty={noActuals ? `No actuals for ${fmtMonth(month)} yet: its close has not reached the warehouse.` : `No figures for ${view === 'store' ? storeName(plants.data, store) : `${region || 'this region'} in ${fmtMonth(month)}`}.`} />
  </Page>
}
