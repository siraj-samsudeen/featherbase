// The RB (Chief Executive) review, faithful to the agreed prototype (rb_review.template.html at b93dacc16): every
// store, three tabs (Forecast, Approvals, Help). Forecast goes one level at a time (Region › Store › Division ›
// Subdivision › Category › Subcategory, or Store › Section): the breadcrumb, the totals, the card for where you stand
// (how Feather Forecast got it, the checks, the other models and the plan, what drives the gaps), then the next level
// as a table: click a row to go in, ⓘ opens its card in the side pane without going in. Above one category, figures
// show value only (pieces of different things do not add up, RB 28-Nov). The Region toggle in the page header
// (Kerala first; Tamil Nadu; Both) narrows the whole page: the title and store count, the search, Forecast and
// Approvals. RB sees proposals but does not decide them.
import { useEffect, useMemo, useState } from 'react'
import { DrillPane, SplitWithPane, resolvePanePlace } from '@featherbase/shop-floor'
import { SMALL_UNDER } from '../shared/madeUpChain'
import { combine, count, foldSmall, inr, isFolded, storeStepOf, type HelpTopic, type Line } from '../shared/model'
import { multiCategory, valueOnly, type Level } from '../shared/levels'
import { KpiTiles } from '../shared/KpiTiles'
import { ReviewFrame, useView } from '../shared/ReviewFrame'
import { ReviewTree } from '../shared/ReviewTree'
import { MANAGER_VIEW, ReviewToolbar, ToolbarChoice } from '../shared/ReviewToolbar'
import { useScope } from '../shared/ScopeSearch'
import { KINDS } from '../shared/scope'
import { useChainReview } from '../shared/useChainReview'
import { nodeWaiting } from '../shared/Proposals'
import { HelpTab } from '../shared/Help'
import { chainHeader, personIn, type ChainPageProps } from '../shared/chainPage'
import type { SortKey, TableRow } from '../shared/MeasureTable'
import { crumbSteps, focusScope, linesAt, rbLevels, storeProgress, type InsideStore } from './rbModel'
import { Crumbs, PendingTab, type RbQuestion } from './RbParts'
import { LineCard, NodeCard, type Kid } from './RbCard'
import '../shared/forecasting.css'
import './rb.css'

/** One row of tabs, Help last (the prototype's views()). */
const SCREENS = ['forecast', 'approvals', 'help']
type Region = 'Kerala' | 'Tamil Nadu' | 'Both'
const QUESTION_TEXTS = ['Why is this so much higher than last December?', 'Does the forecast know the offer ends on 30-Nov?',
  'Is the December step right for a subcategory that sells the same all year?']
const PLURAL: Record<string, string> = { Store: 'Stores', Division: 'Divisions', Subdivision: 'Subdivisions', Category: 'Categories', Section: 'Sections' }

/** What the side pane shows: a child's card (a node one level down) or a subcategory's. */
type Pane = { kind: 'node'; key: string; title: string; level: string; lines: Line[]; next: Level | null } | { kind: 'line'; l: Line }

export function RbReview({ chain, hrefFor, openLine, onOpenLine }: ChainPageProps) {
  const everyLine = useMemo(() => foldSmall(chain.lines, SMALL_UNDER), [chain.lines])
  const byRow = useMemo(() => new Map(everyLine.map(l => [l.rowId, l])), [everyLine])
  // Kerala first; a link to a Tamil Nadu subcategory opens on Tamil Nadu
  // Kerala first when the Run has it; otherwise its one region, or Both when it names none
  const [region, setRegion] = useState<Region>(() => {
    const has = new Set(everyLine.map(l => l.region).filter(Boolean))
    if (openLine && byRow.get(openLine)?.region === 'Tamil Nadu') return 'Tamil Nadu'
    return has.has('Kerala') ? 'Kerala' : has.size === 1 ? [...has][0] as Region : 'Both'
  })
  /** Everything the page shows: the lines of the region picked. */
  const all = useMemo(() => (region === 'Both' ? everyLine : everyLine.filter(l => l.region === region)), [everyLine, region])
  const header = chainHeader(chain, personIn(chain, 'Chief Executive')?.name ?? 'RB', 'Chief Executive')
  const review = useChainReview(chain.proposals, { chain, person: header.person, role: 'Chief Executive' })
  const [screen, setScreen] = useView(SCREENS)
  const [view, setView] = useState(MANAGER_VIEW)
  const [sort, setSort] = useState<SortKey>('aop')
  const [by, setBy] = useState<InsideStore>('category')
  const levels = useMemo(() => rbLevels(by, chain.sections), [by, chain.sections])
  // a subcategory opened by a link: the breadcrumb goes down to its category and its card opens in the pane
  const first = openLine ? byRow.get(openLine) : undefined
  const [crumb, setCrumb] = useState<string[]>(() => (first ? levels.map(lv => lv.key(first)) : []))
  const [pane, setPaneState] = useState<Pane | null>(first ? { kind: 'line', l: first } : null)
  const [help, setHelp] = useState<{ at: HelpTopic | null; from: string | null }>({ at: null, from: null })
  // the made-up chain's sample questions; a real Run's questions to RB are not written anywhere yet, so none show (#1442)
  const [questions, setQuestions] = useState<RbQuestion[]>(() => (chain.real ? [] : chain.proposals).slice(0, 3).flatMap((p, i) => {
    const l = byRow.get(p.line)
    return l ? [{ id: i, line: l, by: `${p.by} · Team Leader`, text: QUESTION_TEXTS[i], answer: null }] : []
  }))
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  useEffect(() => { const on = () => setWidth(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  const place = resolvePanePlace('auto', width)

  const setPane = (p: Pane | null) => { setPaneState(p); onOpenLine(p?.kind === 'line' ? p.l.rowId : null) }
  const go = (c: string[]) => { setCrumb(c); setPane(null) }
  // search: the breadcrumb goes to the deepest level the scoped subcategories share
  const scope = useScope(all, (sc, ls) => {
    const last = sc[sc.length - 1]
    let next = by
    if (last?.kind === 'section' || last?.kind === 'floor') next = 'section'
    else if (last && KINDS[last.kind].tree === 'merch') next = 'category'
    setBy(next)
    go(focusScope(ls, rbLevels(next, chain.sections), sc.length > 0).crumb); setScreen('forecast')
  })
  const lines = scope.lines
  const regionName = region === 'Both' ? 'Both regions' : region
  const pickRegion = (r: Region) => { setRegion(r); go([]) }
  const insideStore = (v: InsideStore) => { setBy(v); go(crumb.slice(0, 1)) }
  const storeName = (code: string) => everyLine.find(l => l.store === code)?.storeName
  /** Open a subcategory wherever it sits: the breadcrumb goes to its category and its card opens in the pane. */
  const reveal = (rowId: string) => {
    const l = byRow.get(rowId)
    if (!l) return
    setScreen('forecast'); setHelp({ at: null, from: null })
    setCrumb(levels.map(lv => lv.key(l))); setPane({ kind: 'line', l })
  }
  /** Open a store (the By store table): the region turns to the store's when it is not shown. */
  const goStore = (store: string) => {
    const r = everyLine.find(l => l.store === store)?.region as Region | undefined
    if (!r) return
    if (region !== 'Both' && r !== region) setRegion(r)
    setScreen('forecast'); go([store])
  }
  const onHelp = (topic: HelpTopic) => { setScreen('help'); setHelp({ at: topic, from: null }) }

  const progress = storeProgress(lines, review.waitingIn, !chain.real), progressAll = storeProgress(all, review.waitingIn, !chain.real)
  const regionQuestions = questions.filter(q => region === 'Both' || q.line.region === region)
  const openQuestions = regionQuestions.filter(q => !q.answer).length
  const pendingN = progressAll.reduce((t, x) => t + x.waiting, 0) + openQuestions

  // ---- Forecast: where you stand, its card, the next level ----
  const c = crumb.slice(0, levels.length), here = linesAt(lines, levels, c)
  const level = c.length ? levels[c.length - 1].name : 'Region', next = levels[c.length] ?? null
  const nameOf = (lv: Level | null, key: string) => (lv?.name === 'Store' ? [key, storeName(key)].filter(Boolean).join(' ') : key)
  const title = c.length ? nameOf(levels[c.length - 1], c[c.length - 1]) : regionName
  const kidsOf = (ls: Line[], lv: Level | null): Kid[] => lv
    ? [...new Set(ls.map(lv.key))].map(k => ({ key: k, label: nameOf(lv, k), item: combine(ls.filter(l => lv.key(l) === k), -1, k), isNode: true }))
    : ls.map(l => ({ key: l.rowId, label: l.name, item: l, isNode: false }))
  const kids = kidsOf(here, next)
  const allValueOnly = kids.every(k => valueOnly(k.item))
  const subcats = here.reduce((t, l) => t + l.n, 0)
  const nodePane = (key: string, lv: Level, ls: Line[]): Pane => ({ kind: 'node', key, title: nameOf(lv, key), level: lv.name, lines: ls.filter(l => lv.key(l) === key), next: levels[levels.indexOf(lv) + 1] ?? null })
  /** A driver one level down: a node goes in, a subcategory opens its card. */
  // a folded "Smaller subcategories" row sums unrelated subcategories: it opens no card
  const onKid = (k: Kid) => (k.isNode ? go([...c, k.key]) : isFolded(k.item as Line) ? undefined : setPane({ kind: 'line', l: k.item as Line }))
  const info = (row: TableRow) => {
    const isNode = row.key.startsWith('node:'), key = row.dataName ?? row.key
    if (!isNode && (!byRow.has(row.key) || isFolded(byRow.get(row.key)!))) return null
    return <button type="button" className="rb-info" title="Open its card here, without going in" aria-label={`Card for ${key}`}
      onClick={e => { e.stopPropagation(); setPane(isNode && next ? nodePane(key, next, here) : { kind: 'line', l: byRow.get(row.key)! }) }}>ⓘ</button>
  }
  const shown = allValueOnly ? { ...view, measure: 'v' as const, groups: 'off' as const } : { ...view, groups: 'off' as const }
  const forecast = <>
    <Crumbs steps={crumbSteps(c, storeName, regionName)} onStep={at => go(c.slice(0, at))} />
    <KpiTiles total={combine(here, -1)} header={header} approvedDelta={review.approvedDelta(here)} valueOnly={multiCategory(here)} />
    <h2 className="rb-sec">{title} <span className="fr-dim">{level === 'Region' ? 'the region' : level.toLowerCase()} · {count(subcats)} subcategor{subcats === 1 ? 'y' : 'ies'}</span></h2>
    <NodeCard lines={here} kids={kids} header={header} onHelp={onHelp} onKid={onKid} narrow={!!pane} />
    <h2 className="rb-sec">{next ? PLURAL[next.name] ?? next.name : 'Subcategories'} <span className="fr-dim">{next ? 'click a row to go in; ⓘ shows its card here' : 'click a subcategory for its card'}</span></h2>
    <ReviewToolbar value={view} onChange={setView} toggles={allValueOnly ? ['shape'] : ['measure', 'shape']} wrap
      lead={<ToolbarChoice label="Inside a store" hover="Open a store by merchandise, or by Team Leader section" value={by} onChange={insideStore}
        options={[{ value: 'category', label: 'Division › Subdivision › Category' }, { value: 'section', label: 'Section' }]} />} />
    <ReviewTree header={header} view={shown} lines={here} levels={next ? [next] : []} totalLabel={title} firstHeading={next?.name ?? 'Subcategory'}
      sort={sort} onSort={setSort} openNodes={new Set()} onToggleNode={() => {}} open={null} onOpen={() => {}} hrefFor={hrefFor} smallUnder={SMALL_UNDER}
      linePills={l => review.linePills(l, false)} nodePills={n => nodeWaiting(review.waitingIn(n.lines), false)}
      onDrill={n => go([...c, n.label])} onLine={l => setPane({ kind: 'line', l })} valueOnly={valueOnly} rowEnd={info} groups={false} />
  </>
  const paneView = pane && (
    <DrillPane place={place} onClose={() => setPane(null)}
      kind={pane.kind === 'line' ? `${pane.l.store} · ${pane.l.category} · Esc to close` : `${pane.level} · Esc to close`}
      title={pane.kind === 'line' ? pane.l.name : pane.title}>
      {pane.kind === 'line'
        ? <LineCard l={pane.l} storeStep={storeStepOf(everyLine.filter(l => l.store === pane.l.store))} header={header} onHelp={onHelp} />
        : <NodeCard lines={pane.lines} kids={kidsOf(pane.lines, pane.next)} header={header} onHelp={onHelp} inPane
          onKid={k => (k.isNode ? go([...c, pane.key, k.key]) : isFolded(k.item as Line) ? undefined : setPane({ kind: 'line', l: k.item as Line }))} />}
    </DrillPane>)

  // only the regions the Run has (a local instance may load Kerala alone); Both when there are two
  const present = [...new Set(everyLine.map(l => l.region))].filter(Boolean).sort() as Region[]
  const regionOptions = [...present.map(r => ({ value: r, label: r as string })), ...(present.length > 1 ? [{ value: 'Both' as Region, label: 'Both' }] : [])]
  const regionToggle = <div className="fr-toolbar" data-testid="rb-region" style={{ margin: 0 }}>
    <ToolbarChoice label="Region" hover="Kerala first; switch to Tamil Nadu or both regions" value={region} onChange={pickRegion}
      options={regionOptions} /></div>

  const pending = <PendingTab madeUp={!chain.real} progress={progress} proposals={review.proposals.filter(p => { const l = byRow.get(p.line); return l && lines.includes(l) })}
    lineOf={id => byRow.get(id)} questions={regionQuestions} hrefFor={hrefFor} onStore={goStore} onLine={reveal}
    onAnswer={(id, text) => setQuestions(qs => qs.map(q => (q.id === id ? { ...q, answer: text } : q)))} />
  const helpTab = <HelpTab header={header} lines={lines} storeStep={storeStepOf(lines)} at={help.at} from={help.from} onBack={reveal} managers
    intro={<><h3>Forecast, {header.month.name}</h3><p>You see every store in Kerala and Tamil Nadu, at any level: region, store, division and category or Team Leader section, down to the subcategory. The page opens with where the gap to AOP is and what is still waiting up the chain. Subcategories under {inr(SMALL_UNDER)} are folded into one "Smaller subcategories" row per category.</p></>} />

  const regions = [...new Set(everyLine.map(l => l.region))]
  return (
    <ReviewFrame testId="rb-review" problem={review.problem} title={`${region === 'Both' ? regions.join(' and ') : region} · ${header.month.label}`} actions={regionToggle}
      status={`${header.person} · ${header.role} · ${new Set(all.map(l => l.store)).size} stores · sales to ${header.cutOff} · before tax`}
      all={all} scope={scope} view={screen}
      onView={v => { setScreen(v); setPane(null); if (v !== 'help') setHelp({ at: null, from: null }) }}
      views={[
        { id: 'forecast', label: 'Forecast', content: screen === 'forecast' && <SplitWithPane place={place} pane={paneView}><div data-testid="rb-forecast">{forecast}</div></SplitWithPane> },
        { id: 'approvals', label: `Approvals (${pendingN})`, content: screen === 'approvals' && pending },
        { id: 'help', label: 'Help', content: helpTab },
      ]} />
  )
}
