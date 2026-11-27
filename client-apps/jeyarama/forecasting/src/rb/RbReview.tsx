// The RB (Chief Executive) review, faithful to the agreed prototype (rb_review.template.html): both regions, every
// store, any level, in four layouts. Two Tabs (the default) and One Tree Table show the whole tree; Drill One Level
// at a Time walks it with a breadcrumb; Answer First opens with where the gap to AOP is and what waits up the chain.
// The Region toggle (Kerala first, as RB reads it; Tamil Nadu; Both) narrows every review layout before the search
// scope does; Approvals (or Pending) is not narrowed by it, and shows how far each store has got, the proposals
// waiting with Store Managers and the questions RB can answer. RB sees proposals but does not decide them; RB sets a number of its own. Made-up chain.
import { useMemo, useRef, useState } from 'react'
import { madeUpChain, SMALL_UNDER } from '../shared/madeUpChain'
import { combine, foldSmall, inr, storeStepOf, type HelpTopic, type Line } from '../shared/model'
import { pathTo, type Level } from '../shared/levels'
import { KpiTiles } from '../shared/KpiTiles'
import { ReviewFrame, useLayout } from '../shared/ReviewFrame'
import { ReviewTree } from '../shared/ReviewTree'
import { MANAGER_VIEW, PartsLegend, ReviewToolbar, ToolbarChoice } from '../shared/ReviewToolbar'
import { useScope } from '../shared/ScopeSearch'
import { KINDS } from '../shared/scope'
import { useChainReview } from '../shared/useChainReview'
import { nodeWaiting, ProposalCard } from '../shared/Proposals'
import { ChangeForm } from '../shared/ChangeForm'
import { Questions } from '../shared/Questions'
import { HelpTab } from '../shared/Help'
import { chainHeader, type ChainPageProps } from '../shared/chainPage'
import type { SortKey } from '../shared/MeasureTable'
import { answerFacts, crumbHint, crumbSteps, focusScope, gapNodes, idsOf, linesAt, rbLevels, storeProgress, type InsideStore } from './rbModel'
import { AnswerBlock, Crumbs, GapBars, PendingTab, type RbQuestion } from './RbParts'
import '../shared/forecasting.css'
import './rb.css'

const LAYOUTS = [
  { id: 'two-tabs', label: 'Two Tabs' },
  { id: 'drill', label: 'Drill One Level at a Time' },
  { id: 'tree', label: 'One Tree Table' },
  { id: 'answer-first', label: 'Answer First' },
]
type Region = 'Kerala' | 'Tamil Nadu' | 'Both'
const QUESTION_TEXTS = ['Why is this so much higher than last December?', 'Does the forecast know the offer ends on 30-Nov?',
  'Is the December step right for a subcategory that sells the same all year?']

export function RbReview({ hrefFor, openLine, onOpenLine }: ChainPageProps) {
  const chain = madeUpChain()
  const all = useMemo(() => foldSmall(chain.lines, SMALL_UNDER), [chain.lines])
  const byRow = useMemo(() => new Map(all.map(l => [l.rowId, l])), [all])
  const header = chainHeader('Kumar', 'Chief Executive')
  const review = useChainReview(chain.proposals)
  const [layout, setLayoutState] = useLayout(LAYOUTS)
  const [tab, setTab] = useState('review')
  const [view, setView] = useState(MANAGER_VIEW)
  const [sort, setSort] = useState<SortKey>('aop')
  const [by, setBy] = useState<InsideStore>('category')
  const levels = useMemo(() => rbLevels(by, chain.sections), [by, chain.sections])
  // a subcategory opened by a link: the tree and the breadcrumb open down to it
  const first = openLine ? byRow.get(openLine) : undefined
  // one region picked: its stores show at once, as the prototype opens it
  const [openNodes, setOpenNodes] = useState(() => new Set(first ? pathTo(first, levels) : ['Kerala']))
  const [crumb, setCrumb] = useState<string[]>(() => (first ? levels.map(lv => lv.key(first)) : []))
  const [open, setOpenState] = useState<string | null>(first ? openLine : null)
  // Kerala first; a link to a Tamil Nadu subcategory opens on Tamil Nadu
  const [region, setRegion] = useState<Region>(() => (first?.region === 'Tamil Nadu' ? 'Tamil Nadu' : 'Kerala'))
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(first ? { key: openLine!, n: 0 } : null)
  const [help, setHelp] = useState<{ at: HelpTopic | null; from: string | null }>({ at: null, from: null })
  const [questions, setQuestions] = useState<RbQuestion[]>(() => chain.proposals.slice(0, 3).flatMap((p, i) => {
    const l = byRow.get(p.line)
    return l ? [{ id: i, line: l, by: `${p.by} · Team Leader`, text: QUESTION_TEXTS[i], answer: null }] : []
  }))
  const where = useRef<HTMLDivElement>(null)
  const later = () => setTimeout(() => where.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))

  const setOpen = (k: string | null) => { setOpenState(k); onOpenLine(k && byRow.has(k) ? k : null) }
  // search: the page follows the scope, opening the tree (and the breadcrumb) to it
  const scope = useScope(all, (sc, ls) => {
    const last = sc[sc.length - 1]
    let next = by
    if (last?.kind === 'section' || last?.kind === 'floor') next = 'section'
    else if (last && KINDS[last.kind].tree === 'merch') next = 'category'
    setBy(next)
    const f = focusScope(ls, rbLevels(next, chain.sections), sc.length > 0)
    setOpenNodes(f.open); setCrumb(f.crumb); setOpen(null); setTab('review')
    // a scope that sits wholly in the other region turns the toggle to it, rather than showing nothing
    const rs = new Set(ls.map(l => l.region))
    if (rs.size === 1 && region !== 'Both' && !rs.has(region)) setRegion([...rs][0] as Region)
  })
  const lines = scope.lines
  /** What the review layouts show: the scope, inside the region picked. */
  const shown = useMemo(() => (region === 'Both' ? lines : lines.filter(l => l.region === region)), [lines, region])
  const regionName = region === 'Both' ? 'Both regions' : region
  const pickRegion = (r: Region) => { setRegion(r); setCrumb([]); setOpenNodes(new Set(r === 'Both' ? [] : [r])); setOpen(null) }

  const setLayout = (id: string) => { setLayoutState(id); setOpen(null) }
  const toggleNode = (id: string) => setOpenNodes(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const insideStore = (v: InsideStore) => {
    setBy(v); setCrumb(c => c.slice(0, 2)); setOpen(null)
    setOpenNodes(s => new Set([...s].filter(id => id.split(' › ').length <= 2)))
  }
  /** Open a subcategory wherever it sits: the tree and the breadcrumb go down to it. */
  const reveal = (rowId: string) => {
    const l = byRow.get(rowId)
    if (!l) return
    setTab('review'); setHelp({ at: null, from: null })
    setCrumb(levels.map(lv => lv.key(l))); setOpenNodes(s => new Set([...s, ...pathTo(l, levels)]))
    setOpen(rowId); setFlash(f => ({ key: rowId, n: (f?.n ?? 0) + 1 }))
  }
  const goStore = (store: string) => {
    const region = all.find(l => l.store === store)?.region
    if (!region) return
    setTab('review'); setCrumb([region, store]); setOpenNodes(new Set(idsOf([region, store]))); setOpen(null); later()
  }
  const goRegion = (region: string) => { setCrumb([region]); setOpenNodes(new Set([region])); setOpen(null); later() }

  const progressAll = storeProgress(all, review.waitingIn), progress = storeProgress(lines, review.waitingIn)
  const openQuestions = questions.filter(q => !q.answer).length
  const pendingN = progressAll.reduce((t, x) => t + x.waiting, 0) + openQuestions

  // ---- the shared pieces of every layout ----
  const tools = <ReviewToolbar value={view} onChange={setView} toggles={['measure', 'groups', 'shape']} wrap
    lead={<ToolbarChoice label="Inside a store" hover="Open a store by merchandise, or by Team Leader section" value={by} onChange={insideStore}
      options={[{ value: 'category', label: 'Division › Category' }, { value: 'section', label: 'Section' }]} />} />
  const answer = (l: Line) => {
    const p = review.proposalOf(l), own = review.state.answers[l.rowId]
    return <>
      {p && <><h4>Proposed by the Team Leader</h4><ProposalCard p={p} line={l} actions={null} hrefFor={hrefFor} title={false} /></>}
      <ChangeForm key={`${l.rowId}:${own?.status ?? ''}`} l={l} answer={own} month={header.month} canAccept={false} aop
        modes={['month_value', 'month_percent', 'days']} title="Your change" sendLabel="Set this number" doneWords="You set" doneTail=""
        onPropose={x => void review.actions.propose(l, x)} />
      <Questions l={l} questions={review.state.questions.filter(q => q.line === l.rowId)} initial={header.person.slice(0, 1)} onAsk={t => void review.actions.ask(l, t)} />
    </>
  }
  const tree = (ls: Line[], lv: Level[], totalLabel: string, drill?: { onDrill: (key: string) => void; heading: string }) => (
    <ReviewTree header={header} view={view} lines={ls} levels={lv} totalLabel={totalLabel} firstHeading={drill?.heading}
      sort={sort} onSort={setSort} openNodes={drill ? new Set() : openNodes} onToggleNode={toggleNode}
      open={open} onOpen={setOpen} hrefFor={hrefFor} answer={answer} smallUnder={SMALL_UNDER} flash={flash}
      linePills={l => review.linePills(l, false)} nodePills={n => nodeWaiting(review.waitingIn(n.lines), false)}
      onHelp={(topic, from) => { setTab('help'); setHelp({ at: topic, from }) }}
      onDrill={drill ? n => drill.onDrill(n.label) : undefined} />
  )
  const hint = 'Click a row to open it; click a subcategory for how Feather Forecast built it.'
  const wholeTree = (totalLabel: string) => <div ref={where}>
    <KpiTiles total={combine(shown, -1)} header={header} approvedDelta={review.approvedDelta(shown)} />
    {tools}<PartsLegend hint={hint} />
    {tree(shown, levels, totalLabel)}
  </div>
  const drill = (withTotals: boolean) => {
    const c = crumb.slice(0, levels.length), here = linesAt(shown, levels, c), next = levels.slice(c.length, c.length + 1)
    return <div ref={where} data-testid="rb-drill">
      <Crumbs steps={crumbSteps(c, code => all.find(l => l.store === code)?.storeName)} hint={crumbHint(c, levels)}
        onStep={at => { setCrumb(c.slice(0, at)); setOpen(null) }} />
      {withTotals && <KpiTiles total={combine(here, -1)} header={header} approvedDelta={review.approvedDelta(here)} />}
      {tools}<PartsLegend hint="" />
      {tree(here, next, c.length ? c[c.length - 1] : regionName, { heading: next[0]?.name ?? 'Subcategory', onDrill: key => { setCrumb([...c, key]); setOpen(null) } })}
    </div>
  }
  const answerFirst = () => {
    const f = answerFacts(shown, header.month.name, progress, openQuestions)
    return <>
      <KpiTiles total={combine(shown, -1)} header={header} approvedDelta={review.approvedDelta(shown)} />
      <AnswerBlock f={f} onPending={() => setTab('pending')} />
      <div className="rb-two">
        <div><h2 className="fr-sec">Gap to AOP by store <span className="fr-dim">furthest behind first; click to open</span></h2>
          <GapBars testId="rb-bars-store" nodes={gapNodes(shown, l => l.store)} onPick={g => goStore(g.name)}
            label={g => <><b>{g.name}</b> <span className="fr-dim" style={{ fontWeight: 400 }}>{g.storeName}</span></>} /></div>
        <div><h2 className="fr-sec">Gap to AOP by division <span className="fr-dim">{scope.scope.length ? 'in scope' : region === 'Both' ? 'both regions' : region}</span></h2>
          <GapBars testId="rb-bars-division" nodes={gapNodes(shown, l => l.division)} label={g => g.name} />
          <h2 className="fr-sec">Gap to AOP by region</h2>
          <GapBars testId="rb-bars-region" nodes={gapNodes(shown, l => l.region)} onPick={g => goRegion(g.name)} label={g => g.name} /></div>
      </div>
      <h2 className="fr-sec">Any level <span className="fr-dim">region › store › {by === 'section' ? 'section' : 'division › category'} › subcategory</span></h2>
      {drill(crumb.length > 0)}
    </>
  }
  const regionToggle = <div className="fr-toolbar" data-testid="rb-region">
    <ToolbarChoice label="Region" hover="Kerala first; switch to Tamil Nadu or both regions" value={region} onChange={pickRegion}
      options={[{ value: 'Kerala', label: 'Kerala' }, { value: 'Tamil Nadu', label: 'Tamil Nadu' }, { value: 'Both', label: 'Both' }]} /></div>
  const reviewContent = <>{regionToggle}{layout === 'drill' ? drill(true) : layout === 'answer-first' ? answerFirst()
    : wholeTree(layout === 'two-tabs' && scope.scope.length ? 'In scope' : regionName)}</>

  const pending = <PendingTab progress={progress} proposals={review.proposals.filter(p => { const l = byRow.get(p.line); return l && lines.includes(l) })}
    lineOf={id => byRow.get(id)} questions={questions} hrefFor={hrefFor} onStore={goStore} onLine={reveal}
    onAnswer={(id, text) => setQuestions(qs => qs.map(q => (q.id === id ? { ...q, answer: text } : q)))} />
  const helpTab = <HelpTab header={header} lines={shown} storeStep={storeStepOf(shown)} at={help.at} from={help.from} onBack={reveal} managers
    intro={<><h3>Forecast, {header.month.name}</h3><p>You see every store in Kerala and Tamil Nadu, at any level: region, store, division and category or Team Leader section, down to the subcategory. The page opens with where the gap to AOP is and what is still waiting up the chain. Subcategories under {inr(SMALL_UNDER)} are folded into one "Smaller subcategories" row per category.</p></>} />

  const two = layout === 'two-tabs'
  const regions = [...new Set(all.map(l => l.region))]
  return (
    <ReviewFrame testId="rb-review" title={`${regions.join(' and ')} · ${header.month.label}`}
      status={`${header.person} · ${header.role} · ${new Set(all.map(l => l.store)).size} stores · sales to ${header.cutOff} · before tax`}
      all={all} scope={scope} layouts={LAYOUTS} layout={layout} onLayout={setLayout} tab={tab}
      onTab={t => { setTab(t); if (t !== 'help') setHelp({ at: null, from: null }) }}
      tabs={[
        { id: 'review', label: two ? 'Forecast' : 'Review', content: reviewContent },
        { id: 'pending', label: `${two ? 'Approvals' : 'Pending'} (${pendingN})`, content: pending },
        { id: 'help', label: 'Help', content: helpTab },
      ]} />
  )
}
