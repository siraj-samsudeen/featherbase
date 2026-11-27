// The RB (Chief Executive) review, faithful to the agreed prototype (rb_review.template.html): both regions, every
// store, any level, in four layouts. Two Tabs (the default) and One Tree Table show the whole tree; Drill One Level
// at a Time walks it with a breadcrumb; Answer First opens with where the gap to AOP is and what waits up the chain.
// The Region toggle in the page header (Kerala first, as RB reads it; Tamil Nadu; Both) narrows the whole page: the
// title and store count, the search, every layout, and Approvals (or Pending), which shows how far each store has got,
// the proposals waiting with Store Managers and the questions RB can answer. RB sees proposals but does not decide them; RB sets a number of its own. Made-up chain.
import { useMemo, useRef, useState } from 'react'
import { SMALL_UNDER } from '../shared/madeUpChain'
import { combine, foldSmall, inr, storeStepOf, type HelpTopic, type Line } from '../shared/model'
import { pathTo, type Level } from '../shared/levels'
import { KpiTiles } from '../shared/KpiTiles'
import { ReviewFrame, useView } from '../shared/ReviewFrame'
import { ReviewTree } from '../shared/ReviewTree'
import { MANAGER_VIEW, PartsLegend, ReviewToolbar, ToolbarChoice } from '../shared/ReviewToolbar'
import { useScope } from '../shared/ScopeSearch'
import { KINDS } from '../shared/scope'
import { useChainReview } from '../shared/useChainReview'
import { nodeWaiting, ProposalCard } from '../shared/Proposals'
import { ChangeForm } from '../shared/ChangeForm'
import { Questions } from '../shared/Questions'
import { HelpTab } from '../shared/Help'
import { chainHeader, personIn, type ChainPageProps } from '../shared/chainPage'
import type { SortKey } from '../shared/MeasureTable'
import { answerFacts, crumbHint, crumbSteps, focusScope, gapNodes, idsOf, linesAt, rbLevels, storeProgress, type InsideStore } from './rbModel'
import { AnswerBlock, Crumbs, GapBars, PendingTab, type RbQuestion } from './RbParts'
import '../shared/forecasting.css'
import './rb.css'

/** One row of views, Help last (the prototype's views()): Forecast and Approvals, the drill, the answer first. */
const SCREENS = ['forecast', 'approvals', 'drill', 'answer-first', 'help']
type Region = 'Kerala' | 'Tamil Nadu' | 'Both'
const QUESTION_TEXTS = ['Why is this so much higher than last December?', 'Does the forecast know the offer ends on 30-Nov?',
  'Is the December step right for a subcategory that sells the same all year?']

export function RbReview({ chain, hrefFor, openLine, onOpenLine }: ChainPageProps) {
  const everyLine = useMemo(() => foldSmall(chain.lines, SMALL_UNDER), [chain.lines])
  const byRow = useMemo(() => new Map(everyLine.map(l => [l.rowId, l])), [everyLine])
  // Kerala first; a link to a Tamil Nadu subcategory opens on Tamil Nadu
  const [region, setRegion] = useState<Region>(() => (openLine && byRow.get(openLine)?.region === 'Tamil Nadu' ? 'Tamil Nadu' : 'Kerala'))
  /** Everything the page shows: the lines of the region picked. */
  const all = useMemo(() => (region === 'Both' ? everyLine : everyLine.filter(l => l.region === region)), [everyLine, region])
  const header = chainHeader(chain, personIn(chain, 'Chief Executive')?.name ?? 'RB', 'Chief Executive')
  const review = useChainReview(chain.proposals)
  const [screen, setScreen] = useView(SCREENS)
  // each view is a layout and what it opens on
  const layout = screen === 'drill' || screen === 'answer-first' ? screen : 'forecast'
  const tab = screen === 'approvals' ? 'pending' : screen === 'help' ? 'help' : 'review'
  /** Back to a layout's review (from Approvals or Help: Forecast), or to Approvals or Help. */
  const setTab = (t: 'review' | 'pending' | 'help') => setScreen(t === 'help' ? 'help' : t === 'pending' ? 'approvals' : tab === 'review' ? screen : 'forecast')
  const [view, setView] = useState(MANAGER_VIEW)
  const [sort, setSort] = useState<SortKey>('aop')
  const [by, setBy] = useState<InsideStore>('category')
  const levels = useMemo(() => rbLevels(by, chain.sections), [by, chain.sections])
  // a subcategory opened by a link: the tree and the breadcrumb open down to it
  const first = openLine ? byRow.get(openLine) : undefined
  // one region picked: its stores show at once, as the prototype opens it
  const [openNodes, setOpenNodes] = useState(() => new Set(first ? pathTo(first, levels) : []))
  const [crumb, setCrumb] = useState<string[]>(() => (first ? levels.map(lv => lv.key(first)) : []))
  const [open, setOpenState] = useState<string | null>(first ? openLine : null)
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
  })
  const lines = scope.lines
  const regionName = region === 'Both' ? 'Both regions' : region
  const pickRegion = (r: Region) => { setRegion(r); setCrumb([]); setOpenNodes(new Set()); setOpen(null) }

  const toggleNode = (id: string) => setOpenNodes(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const insideStore = (v: InsideStore) => {
    setBy(v); setCrumb(c => c.slice(0, 1)); setOpen(null)
    setOpenNodes(s => new Set([...s].filter(id => id.split(' › ').length <= 1)))
  }
  /** Open a subcategory wherever it sits: the tree and the breadcrumb go down to it. */
  const reveal = (rowId: string) => {
    const l = byRow.get(rowId)
    if (!l) return
    setTab('review'); setHelp({ at: null, from: null })
    setCrumb(levels.map(lv => lv.key(l))); setOpenNodes(s => new Set([...s, ...pathTo(l, levels)]))
    setOpen(rowId); setFlash(f => ({ key: rowId, n: (f?.n ?? 0) + 1 }))
  }
  /** Open a store in the tree (a bar, the By store table): the region turns to the store's when it is not shown. */
  const goStore = (store: string) => {
    const r = everyLine.find(l => l.store === store)?.region as Region | undefined
    if (!r) return
    if (region !== 'Both' && r !== region) setRegion(r)
    setTab('review'); setCrumb([store]); setOpenNodes(new Set(idsOf([store]))); setOpen(null); later()
  }
  /** A region's bar picks that region. */
  const goRegion = (r: string) => { setRegion(r as Region); setCrumb([]); setOpenNodes(new Set()); setOpen(null); later() }

  const progressAll = storeProgress(all, review.waitingIn, !chain.real), progress = storeProgress(lines, review.waitingIn, !chain.real)
  const regionQuestions = questions.filter(q => region === 'Both' || q.line.region === region)
  const openQuestions = regionQuestions.filter(q => !q.answer).length
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
    <KpiTiles total={combine(lines, -1)} header={header} approvedDelta={review.approvedDelta(lines)} />
    {tools}<PartsLegend hint={hint} />
    {tree(lines, levels, totalLabel)}
  </div>
  const drill = (withTotals: boolean) => {
    const c = crumb.slice(0, levels.length), here = linesAt(lines, levels, c), next = levels.slice(c.length, c.length + 1)
    return <div ref={where} data-testid="rb-drill">
      <Crumbs steps={crumbSteps(c, code => all.find(l => l.store === code)?.storeName, regionName)} hint={crumbHint(c, levels)}
        onStep={at => { setCrumb(c.slice(0, at)); setOpen(null) }} />
      {withTotals && <KpiTiles total={combine(here, -1)} header={header} approvedDelta={review.approvedDelta(here)} />}
      {tools}<PartsLegend hint="" />
      {tree(here, next, c.length ? c[c.length - 1] : regionName, { heading: next[0]?.name ?? 'Subcategory', onDrill: key => { setCrumb([...c, key]); setOpen(null) } })}
    </div>
  }
  const answerFirst = () => {
    const f = answerFacts(lines, header.month.name, progress, openQuestions)
    return <>
      <KpiTiles total={combine(lines, -1)} header={header} approvedDelta={review.approvedDelta(lines)} />
      <AnswerBlock f={f} onPending={() => setTab('pending')} madeUp={!chain.real} />
      <div className="rb-two">
        <div><h2 className="fr-sec">Gap to AOP by store <span className="fr-dim">furthest behind first; click to open</span></h2>
          <GapBars testId="rb-bars-store" nodes={gapNodes(lines, l => l.store)} onPick={g => goStore(g.name)}
            label={g => <><b>{g.name}</b> <span className="fr-dim" style={{ fontWeight: 400 }}>{g.storeName}</span></>} /></div>
        <div><h2 className="fr-sec">Gap to AOP by division <span className="fr-dim">{scope.scope.length ? 'in scope' : region === 'Both' ? 'both regions' : region}</span></h2>
          <GapBars testId="rb-bars-division" nodes={gapNodes(lines, l => l.division)} label={g => g.name} />
          <h2 className="fr-sec">Gap to AOP by region</h2>
          <GapBars testId="rb-bars-region" nodes={gapNodes(lines, l => l.region)} onPick={g => goRegion(g.name)} label={g => g.name} /></div>
      </div>
      <h2 className="fr-sec">Any level <span className="fr-dim">region › store › {by === 'section' ? 'section' : 'division › category'} › subcategory</span></h2>
      {drill(crumb.length > 0)}
    </>
  }
  // only the regions the Run has (a local instance may load Kerala alone); Both when there are two
  const present = [...new Set(everyLine.map(l => l.region))].filter(Boolean).sort() as Region[]
  const regionOptions = [...present.map(r => ({ value: r, label: r as string })), ...(present.length > 1 ? [{ value: 'Both' as Region, label: 'Both' }] : [])]
  const regionToggle = <div className="fr-toolbar" data-testid="rb-region" style={{ margin: 0 }}>
    <ToolbarChoice label="Region" hover="Kerala first; switch to Tamil Nadu or both regions" value={region} onChange={pickRegion}
      options={regionOptions} /></div>
  const reviewContent = layout === 'drill' ? drill(true) : layout === 'answer-first' ? answerFirst()
    : wholeTree(scope.scope.length ? 'In scope' : regionName)

  const pending = <PendingTab madeUp={!chain.real} progress={progress} proposals={review.proposals.filter(p => { const l = byRow.get(p.line); return l && lines.includes(l) })}
    lineOf={id => byRow.get(id)} questions={regionQuestions} hrefFor={hrefFor} onStore={goStore} onLine={reveal}
    onAnswer={(id, text) => setQuestions(qs => qs.map(q => (q.id === id ? { ...q, answer: text } : q)))} />
  const helpTab = <HelpTab header={header} lines={lines} storeStep={storeStepOf(lines)} at={help.at} from={help.from} onBack={reveal} managers
    intro={<><h3>Forecast, {header.month.name}</h3><p>You see every store in Kerala and Tamil Nadu, at any level: region, store, division and category or Team Leader section, down to the subcategory. The page opens with where the gap to AOP is and what is still waiting up the chain. Subcategories under {inr(SMALL_UNDER)} are folded into one "Smaller subcategories" row per category.</p></>} />

  const regions = [...new Set(everyLine.map(l => l.region))]
  return (
    <ReviewFrame testId="rb-review" title={`${region === 'Both' ? regions.join(' and ') : region} · ${header.month.label}`} actions={regionToggle}
      status={`${header.person} · ${header.role} · ${new Set(all.map(l => l.store)).size} stores · sales to ${header.cutOff} · before tax`}
      all={all} scope={scope} view={screen}
      onView={v => { setScreen(v); setOpen(null); if (v !== 'help') setHelp({ at: null, from: null }) }}
      views={[
        { id: 'forecast', label: 'Forecast', content: layout === 'forecast' && reviewContent },
        { id: 'approvals', label: `Approvals (${pendingN})`, content: screen === 'approvals' && pending },
        { id: 'drill', label: 'Drill One Level at a Time', content: layout === 'drill' && reviewContent },
        { id: 'answer-first', label: 'Answer First', content: layout === 'answer-first' && reviewContent },
        { id: 'help', label: 'Help', content: helpTab },
      ]} />
  )
}
