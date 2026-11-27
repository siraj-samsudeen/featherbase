// The category head review (#1419), faithful to the agreed prototype (category_head_review): one person's
// subdivisions at every store of a region. Four layouts: Two Tabs (the default: the table, Approvals on its own
// tab), Drill Table (the table with the proposals as a queue above it), Store Map (categories × stores, tinted by
// the gap) and Furthest From Plan (the biggest shortfalls and changes, ranked). The category head sees proposed
// changes but does not decide them (the Store Manager does); on a subcategory without one waiting, they send their
// own view for approval. Composed from src/shared; runs on the made-up chain (Bina: Women and Girls in Kerala).
import { useMemo, useState, type ReactNode } from 'react'
import { RecordLink, chipClasses } from '@featherbase/shop-floor'
import { combine, count, inr, storeStepOf, type HelpTopic, type Line } from '../shared/model'
import { LEVEL, headingOf, pathTo, type Level } from '../shared/levels'
import { KpiTiles, Tile } from '../shared/KpiTiles'
import { ReviewFrame, useView } from '../shared/ReviewFrame'
import { LINE_TABLE, ReviewTree } from '../shared/ReviewTree'
import { MANAGER_VIEW, PartsLegend, ReviewToolbar, ToolbarChoice, type ViewChoices } from '../shared/ReviewToolbar'
import { useScope } from '../shared/ScopeSearch'
import { useChainReview } from '../shared/useChainReview'
import { ProposalCard, nodeWaiting } from '../shared/Proposals'
import { ChangeForm } from '../shared/ChangeForm'
import { Questions } from '../shared/Questions'
import { LinePanel } from '../shared/LinePanel'
import { HelpTab } from '../shared/Help'
import { chainHeader, personIn, type ChainPageProps } from '../shared/chainPage'
import { linesOf } from '../shared/chainData'
import type { SortKey } from '../shared/MeasureTable'
import { behindCounts, cellLines, commonPath, storesBySize, type Metric, type RankBy } from './heads'
import { StoreMap, type CellPick } from './StoreMap'
import { Furthest, type Side } from './Furthest'
import '../shared/forecasting.css'
import './categoryHead.css'

/** One row of views, Help last (the prototype's views()): Your Categories, Approvals, the Store Map, Furthest From Plan. */
const SCREENS = ['categories', 'approvals', 'map', 'furthest', 'help']

type Pivot = 'cat-store' | 'store-cat' | 'sub-store'
const PIVOTS: Record<Pivot, Level[]> = {
  'cat-store': [LEVEL.category, LEVEL.store],
  'store-cat': [LEVEL.store, LEVEL.category],
  'sub-store': [LEVEL.category, LEVEL.subcategory],
}
const PIVOT_OPTIONS: { value: Pivot; label: string }[] = [
  { value: 'cat-store', label: 'Category › Store' }, { value: 'store-cat', label: 'Store › Category' }, { value: 'sub-store', label: 'Subcategory › Store' },
]
const LEGEND_HINT = 'Click a row to open it; click a subcategory for how Feather Forecast built it.'

export function CategoryHeadReview({ chain, hrefFor, openLine, onOpenLine }: ChainPageProps) {
  // the category head (?as= picks one) and their merchandise: the subcategory codes at the stores their assignment names
  const head = personIn(chain, 'Category Head')
  const all = useMemo(() => (head ? linesOf(head, chain.lines) : []), [head, chain.lines])
  const REGION = [...new Set(all.map(l => l.region))].filter(Boolean).join(' and ')
  const SUBDIVISIONS = [...new Set(all.map(l => l.subdivision))]
  const byId = useMemo(() => new Map(all.map(l => [l.rowId, l])), [all])
  const header = chainHeader(chain, head?.name ?? 'Category Head', 'Category Head')
  const review = useChainReview(chain.proposals)
  const mine = review.proposals.filter(p => byId.has(p.line))
  const waiting = mine.filter(p => p.state === 'waiting')
  const steps = useMemo(() => new Map([...new Set(all.map(l => l.store))].map(s => [s, storeStepOf(all.filter(l => l.store === s))])), [all])

  const [screen, setScreen] = useView(SCREENS)
  // each view is a layout and what it opens on
  const layout = screen === 'map' ? 'store-map' : screen === 'furthest' ? 'furthest' : 'categories'
  const tab = screen === 'approvals' || screen === 'help' ? screen : 'review'
  const setLayoutState = (l: 'categories' | 'store-map' | 'furthest') => setScreen(l === 'store-map' ? 'map' : l)
  /** Back to a layout's review (from Approvals or Help: Your Categories), or to Approvals or Help. */
  const setTab = (t: 'review' | 'approvals' | 'help') => setScreen(t !== 'review' ? t : tab === 'review' ? screen : 'categories')
  const [pivot, setPivotState] = useState<Pivot>('cat-store')
  const [view, setView] = useState<ViewChoices>(MANAGER_VIEW)
  const [sort, setSort] = useState<SortKey>('aop')
  const first = openLine ? byId.get(openLine) : undefined
  const [openNodes, setOpenNodes] = useState(() => new Set(first ? pathTo(first, PIVOTS['cat-store']) : []))
  const [open, setOpenState] = useState<string | null>(first ? openLine : null)
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(first ? { key: first.rowId, n: 0 } : null)
  const [help, setHelp] = useState<{ at: HelpTopic | null; from: string | null }>({ at: null, from: null })
  const [metric, setMetric] = useState<Metric>('aop')
  const [mapOpen, setMapOpen] = useState(new Set<string>())
  const [cell, setCell] = useState<CellPick | null>(null)
  const [rank, setRankState] = useState<RankBy>('line')
  const [rankOpen, setRankOpen] = useState<{ key: string; side: Side } | null>(null)

  const setOpen = (key: string | null) => { setOpenState(key); onOpenLine(key && byId.has(key) ? key : null) }
  const setPivot = (p: Pivot) => { setPivotState(p); setOpenNodes(new Set()); setOpen(null) }
  const toggleNode = (id: string) => setOpenNodes(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // a new scope reads best in its own view: a store by its categories, a subcategory across the stores; the
  // map and the ranked lists give way to the table, opened at the scope
  const scope = useScope(all, (s, ls) => {
    const kind = s[s.length - 1]?.kind
    const next: Pivot = kind === 'store' ? 'store-cat' : kind === 'subcategory' ? 'sub-store' : 'cat-store'
    setPivotState(next); setOpenNodes(new Set(s.length ? commonPath(ls, PIVOTS[next]) : [])); setOpen(null); setCell(null); setRankOpen(null)
    if (layout === 'store-map' || layout === 'furthest') setLayoutState('categories')
  })
  const lines = scope.lines
  /** Open a subcategory in Your Categories' table, by store, and flash it (a proposal chip). */
  const jump = (rowId: string) => {
    const l = byId.get(rowId)
    if (!l) return
    setLayoutState('categories'); setHelp({ at: null, from: null })
    setPivotState('store-cat'); setOpenNodes(new Set(pathTo(l, PIVOTS['store-cat']))); setOpen(rowId)
    setFlash(f => ({ key: rowId, n: (f?.n ?? 0) + 1 }))
  }

  // ---- what an opened subcategory shows under the other models ----
  const answer = (l: Line): ReactNode => {
    const p = review.proposalOf(l), own = review.state.answers[l.rowId]
    return <>
      {p && <><h4>Proposed Change</h4><ProposalCard p={p} line={l} actions={null} hrefFor={hrefFor} title={false} /></>}
      {p?.state !== 'waiting' && <ChangeForm key={`${l.rowId}:${own?.status ?? ''}`} l={l} answer={own} month={header.month} canAccept={false}
        modes={['month_value', 'month_percent', 'days']} aop title="Your view" sendLabel="Send for approval" doneWords="You proposed" doneTail=""
        onPropose={x => void review.actions.propose(l, x)} />}
      <Questions l={l} questions={review.state.questions.filter(q => q.line === l.rowId)} initial={header.person.slice(0, 1)} onAsk={text => void review.actions.ask(l, text)} />
    </>
  }
  const onHelp = (topic: HelpTopic, from: string) => { setTab('help'); setHelp({ at: topic, from: byId.has(from) ? from : null }) }
  const linePills = (l: Line) => review.linePills(l, false)
  const storeLeaf = (l: Line) => <RecordLink table={LINE_TABLE} rowId={l.rowId} name={`${l.store} ${l.storeName}`} href={hrefFor(l)} onNavigate={() => {}} />

  const tree = (ls: Line[], levels: Level[], o: { total: string; first?: string; byStore?: boolean }) => (
    <ReviewTree header={header} view={view} lines={ls} levels={levels} totalLabel={o.total} firstHeading={o.first}
      sort={sort} onSort={setSort} openNodes={openNodes} onToggleNode={toggleNode} open={open} onOpen={setOpen} hrefFor={hrefFor}
      answer={answer} linePills={linePills} nodePills={n => nodeWaiting(review.waitingIn(n.lines), false)}
      leafLabel={o.byStore ? storeLeaf : undefined} onHelp={onHelp} flash={flash} />
  )

  // ---- the parts every layout starts with ----
  const behind = behindCounts(lines)
  const tiles = (
    <KpiTiles total={combine(lines, -1)} header={header} approvedDelta={review.approvedDelta(lines)}
      extra={<Tile name="More than 10% behind AOP" value={`${behind.stores.behind} of ${behind.stores.of} stores`} testId="kpi-behind" valueClass="ch-kpi-wrap"
        lines={[`${behind.categories.behind} of ${behind.categories.of} categories`, `${behind.subcategories.behind} of ${behind.subcategories.of} subcategories planned at ₹1 L or more`]} />} />
  )
  const toolbar = (
    <ReviewToolbar value={view} onChange={setView} toggles={['measure', 'groups', 'shape']} wrap
      lead={<ToolbarChoice label="View" hover="Open a category to see its stores, a store to see its categories, or a subcategory to see it at every store"
        value={pivot} onChange={setPivot} options={PIVOT_OPTIONS} />} />
  )
  const table = <>
    {toolbar}
    <PartsLegend hint={LEGEND_HINT} />
    {pivot === 'sub-store'
      ? tree(lines, PIVOTS[pivot], { first: 'Category › Subcategory › Store', total: 'All stores', byStore: true })
      : tree(lines, PIVOTS[pivot], { first: headingOf(PIVOTS[pivot]), total: 'All stores' })}
  </>
  const queueOf = waiting.filter(p => lines.some(l => l.rowId === p.line))
  const queue = queueOf.length > 0 && (
    <div className="ch-queue" data-testid="proposal-queue">
      <b>Changes proposed on your subcategories ({queueOf.length})</b>
      {queueOf.map(p => {
        const l = byId.get(p.line)!
        return <span key={p.id} className={chipClasses({ hue: 'grey' })}><span>
          <b>{l.store}</b> · <RecordLink table={LINE_TABLE} rowId={l.rowId} name={l.name} href={hrefFor(l)} onNavigate={() => jump(l.rowId)} /> · {inr(p.forecast)} → {inr(p.proposed)}</span></span>
      })}
      <span className="fr-dim">waiting for the Store Manager</span>
    </div>
  )

  // ---- Store Map: what a picked cell opens below ----
  const stores = storesBySize(lines)
  const picked = cell && cellLines(lines, cell.row, cell.store)
  const cellName = cell && `${cell.row === '*' ? 'All categories' : cell.row} · ${cell.store ? `${cell.store} ${stores.find(s => s.code === cell.store)?.name ?? ''}` : 'all stores'}`
  const below = picked && picked.length ? <>
    <h2 className="fr-sec" id="ch-cell">{cellName}</h2>
    <ReviewToolbar value={view} onChange={setView} toggles={['measure', 'groups', 'shape']} wrap />
    <PartsLegend hint="Click a subcategory for how Feather Forecast built it." />
    {cell!.store
      ? tree(picked, cell!.row === '*' ? [LEVEL.category] : [], { first: cell!.row === '*' ? 'Category › Subcategory' : 'Subcategory', total: 'Total' })
      : cell!.row.includes(' › ')
        ? tree(picked, [], { first: 'Store', total: 'All stores', byStore: true })
        : tree(picked, [LEVEL.store], { total: 'All stores' })}
  </> : <div className="ch-empty">Click a cell to see its subcategories here.</div>
  const pickCell = (c: CellPick | null) => {
    setCell(c); setOpen(null); setOpenNodes(new Set())
    if (c) setTimeout(() => document.getElementById('ch-cell')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  // ---- Furthest From Plan: a subcategory's panel, and a category at a store opens Your Categories there ----
  const rankPanel = (l: Line) => (
    <LinePanel item={l} header={header} storeStep={steps.get(l.store) ?? 1} aop onHelp={t => onHelp(t, l.rowId)} answer={answer(l)} />
  )
  const toCategory = (store: string, category: string) => {
    setLayoutState('categories'); setPivotState('store-cat'); setOpenNodes(new Set([store, `${store} › ${category}`])); setOpen(null); setRankOpen(null)
    setFlash(f => ({ key: `node:${store} › ${category}`, n: (f?.n ?? 0) + 1 }))
  }

  let content: ReactNode
  if (layout === 'store-map') content = <>{tiles}{queue}<StoreMap lines={lines} stores={stores} metric={metric} onMetric={setMetric} sort={sort} onSort={setSort}
    openCats={mapOpen} onToggleCat={k => setMapOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })}
    cell={cell} onCell={pickCell} below={below} /></>
  else if (layout === 'furthest') content = <>{tiles}{queue}<Furthest lines={lines} rank={rank} onRank={r => { setRankState(r); setRankOpen(null) }}
    open={rankOpen} onOpen={setRankOpen} onCategory={toCategory} hrefFor={hrefFor} pills={l => <span className="ch-pills">{linePills(l)}</span>} panel={rankPanel} /></>
  else content = <>{tiles}{table}</>

  const approvals = <>
    <h2 className="fr-sec">Changes Proposed on Your Subcategories <span className="fr-dim">{waiting.length
      ? `${count(waiting.length)} waiting with Store Managers; you can see them, the Store Manager decides` : 'nothing waiting'}</span></h2>
    <div className="fr-pcards" data-testid="approvals">{waiting.map(p => <ProposalCard key={p.id} p={p} line={byId.get(p.line)!} actions={null} hrefFor={hrefFor} />)}</div>
    {mine.some(p => p.state !== 'waiting') && <>
      <h2 className="fr-sec">Decided</h2>
      <div className="fr-pcards">{mine.filter(p => p.state !== 'waiting').map(p => <ProposalCard key={p.id} p={p} line={byId.get(p.line)!} actions={null} hrefFor={hrefFor} />)}</div>
    </>}
  </>
  const fromLine = help.from ? byId.get(help.from) : undefined
  const helpTab = (
    <HelpTab header={header} lines={lines} storeStep={storeStepOf(lines)} at={help.at} from={fromLine ? `${fromLine.store} · ${fromLine.name}` : null}
      onBack={() => { if (fromLine) jump(fromLine.rowId) }} managers
      intro={<>
        <h3>Your Merchandise, {header.month.name}</h3>
        <p>You see your categories at every {REGION} store. Read them by category, by store, or one subcategory across all stores. The store map shows at a glance whether a gap sits with one store or with one category. AOP is the plan to catch up to; last year and last month show whether Feather Forecast is believable.</p>
      </>} />
  )

  const categories = new Set(all.map(l => l.category)).size, storeCount = new Set(all.map(l => l.store)).size
  const views = [
    { id: 'categories', label: 'Your Categories', content: screen === 'categories' && content },
    { id: 'approvals', label: `Approvals (${waiting.length})`, content: screen === 'approvals' && approvals },
    { id: 'map', label: 'Store Map', content: screen === 'map' && content },
    { id: 'furthest', label: 'Furthest From Plan', content: screen === 'furthest' && content },
    { id: 'help', label: 'Help', content: helpTab },
  ]
  return (
    <ReviewFrame testId="category-head-review" title={`${SUBDIVISIONS.join(', ')} · ${REGION} · ${header.month.label}`}
      status={`${header.person} · ${header.role} · ${categories} categories at ${storeCount} stores · sales to ${header.cutOff} · before tax`}
      all={all} scope={scope} views={views} view={screen}
      onView={v => { setScreen(v); setOpen(null); setRankOpen(null); if (v !== 'help') setHelp({ at: null, from: null }) }} />
  )
}
