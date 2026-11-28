// The Store Manager review (#1419), faithful to the prototype agreed on 27-Nov-2026: one store, every Team
// Leader's section, against AOP. The Store Manager approves, edits or sends back the Team Leaders' proposals and
// may set a subcategory's number themselves. Three layouts the reader picks (Two Tabs, Approvals on Top, Section
// Board), the store seen as it is laid out (floor › section) or as it is bought (division › … › category).
// Composed from src/shared; runs on the made-up chain (store LKS) until the copied Run is in the app's tables.
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ChipButton, RecordLink, StatusPill, TABLE_CLASSES, cellClasses, cx, headCellClasses } from '@featherbase/shop-floor'
import { combine, inr, pc, storeStepOf, type HelpTopic, type Line } from '../shared/model'
import { MERCHANDISE, STORE_LAYOUT, LEVEL, multiCategory, pathTo, valueOnly, type Level, type TreeNode } from '../shared/levels'
import { KpiTiles, Tile } from '../shared/KpiTiles'
import { ReviewFrame, useView } from '../shared/ReviewFrame'
import { LINE_TABLE, ReviewTree } from '../shared/ReviewTree'
import { MANAGER_VIEW, PartsLegend, ReviewToolbar, ToolbarChoice } from '../shared/ReviewToolbar'
import { useScope } from '../shared/ScopeSearch'
import { KINDS, type Kind, type Scope } from '../shared/scope'
import { useChainReview } from '../shared/useChainReview'
import { nodeWaiting, ProposalCard } from '../shared/Proposals'
import { LinePanel } from '../shared/LinePanel'
import { ChangeForm } from '../shared/ChangeForm'
import { Questions } from '../shared/Questions'
import { HelpTab } from '../shared/Help'
import { aopText, aopTone } from '../shared/Aop'
import { REASONS } from '../shared/review'
import { chainHeader, type ChainPageProps } from '../shared/chainPage'
import type { SortKey } from '../shared/MeasureTable'
import { boardOrder, focusOpen, fullyAnswered, meterWidth, sectionLine, sectionsOf, storeOf, type SectionSummary } from './sections'
import '../shared/forecasting.css'
import './storeManager.css'

/** One row of views, Help last (the prototype's views()): The Store, Approvals, the Section Board. */
const SCREENS = ['store', 'approvals', 'board', 'help']
/** One store: a floor, section or merchandise, never another store. */
const KINDS_HERE: Kind[] = ['floor', 'section', 'division', 'subdivision', 'category', 'subcategory']
type Pivot = 'layout' | 'merch'
const reasonLabel = (c: string) => REASONS.find(r => r.code === c)?.label ?? c
const toggle = (s: Set<string>, id: string) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }

export function StoreManagerReview({ chain, hrefFor, openLine, onOpenLine, person, admin }: ChainPageProps) {
  const STORE = useMemo(() => storeOf(chain, person, admin, new URLSearchParams(window.location.search).get('store')), [chain, person, admin])
  const all = useMemo(() => chain.lines.filter(l => l.store === STORE), [chain.lines, STORE])
  const info = useMemo(() => chain.sections.filter(s => s.store === STORE), [chain.sections, STORE])
  const ids = useMemo(() => new Set(all.map(l => l.rowId)), [all])
  // the store's Store Manager: the signed-in one, or the one an administrator views as; an administrator naming
  // nobody sees the store's Store Manager today
  const manager = person?.places.some(x => x.store === STORE) ? person
    : admin ? chain.people.find(p => p.role === 'Store Manager' && p.places.some(x => x.store === STORE)) : undefined
  const header = chainHeader(chain, manager?.name ?? 'Store Manager', 'Store Manager', STORE)
  const review = useChainReview(chain.proposals.filter(p => ids.has(p.line)))
  const storeStep = useMemo(() => storeStepOf(all), [all])
  const arriving = openLine ? all.find(l => l.rowId === openLine) : undefined

  const [screen, setScreen] = useView(SCREENS)
  // each view is a layout and what it opens on
  const layout = screen === 'board' ? 'section-board' : 'store'
  const tab = screen === 'approvals' || screen === 'help' ? screen : 'review'
  /** Back to a layout's review (from Approvals or Help: The Store), or to Approvals or Help. */
  const setTab = (t: 'review' | 'approvals' | 'help') => setScreen(t !== 'review' ? t : tab === 'review' ? screen : 'store')
  const [view, setView] = useState(MANAGER_VIEW)
  const [pivot, setPivot] = useState<Pivot>('layout')
  const [sort, setSort] = useState<SortKey>('aop')
  const [boardSort, setBoardSort] = useState<SortKey>('aop')
  const [board, setBoard] = useState<string | null>(arriving && layout === 'section-board' ? arriving.section : null)
  const [openNodes, setOpenNodes] = useState(() => new Set(arriving ? pathTo(arriving, STORE_LAYOUT) : []))
  const [open, setOpenState] = useState<string | null>(arriving ? arriving.rowId : null)
  const [pline, setPline] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(arriving ? { key: arriving.rowId, n: 0 } : null)
  const [help, setHelp] = useState<{ at: HelpTopic | null; from: string | null }>({ at: null, from: null })

  const levelsOf = (p: Pivot) => (p === 'layout' ? STORE_LAYOUT : MERCHANDISE)
  const levels = levelsOf(pivot)
  const [lastScope, setLastScope] = useState<Scope[]>([])
  const scope = useScope(all, (next, lines) => {
    // a new choice turns the View to its hierarchy (prototype onScope); the tree opens to the scope (focusScope)
    const newest = next[next.length - 1]
    let p = pivot
    if (newest && !lastScope.some(s => s.kind === newest.kind && s.key === newest.key)) p = KINDS[newest.kind].tree === 'place' ? 'layout' : 'merch'
    setLastScope(next); setPivot(p); setBoard(null); setOpen(null); setPline(null); setTab('review')
    setOpenNodes(focusOpen(lines, levelsOf(p), next.length > 0))
  })
  const lines = scope.lines
  const secs = useMemo(() => sectionsOf(lines, info, !chain.real), [lines, info, chain.real])
  const secOf = (name: string) => secs.find(s => s.name === name)

  const setOpen = (k: string | null) => { setOpenState(k); onOpenLine(k && ids.has(k) ? k : null) }
  const setPivotOpen = (p: Pivot) => { setPivot(p); setOpenNodes(focusOpen(lines, levelsOf(p), scope.scope.length > 0)) }
  /** Open the way down to a subcategory and flash it (a queue chip, a proposal's name, Help's way back). */
  const jumpTo = (rowId: string) => {
    const l = all.find(x => x.rowId === rowId)
    if (!l) return
    setTab('review'); setHelp({ at: null, from: null })
    if (layout === 'section-board') setBoard(l.section)
    else { setPivot('layout'); setOpenNodes(s => new Set([...s, ...pathTo(l, STORE_LAYOUT)])) }
    setOpen(l.rowId); setFlash(f => ({ key: l.rowId, n: (f?.n ?? 0) + 1 }))
  }
  // Help names the subcategory it came from; its way back opens it again
  const onHelp = (topic: HelpTopic, from: string) => { setTab('help'); setHelp({ at: topic, from: all.find(l => l.rowId === from)?.name ?? null }) }

  // ---- an opened subcategory: the Team Leader's proposal, the Store Manager's own change, questions ----
  const answer = (l: Line): ReactNode => {
    const p = review.proposalOf(l)
    return <>
      {p && <><h4>{p.role}'s proposal</h4><ProposalCard p={p} line={l} actions={review.proposalActions} hrefFor={hrefFor} title={false} /></>}
      {p?.state !== 'waiting' && (
        <ChangeForm key={`${l.rowId}:${review.state.answers[l.rowId]?.value ?? ''}`} l={l} answer={review.state.answers[l.rowId]} month={header.month}
          onPropose={pr => void review.actions.propose(l, pr)} canAccept={false} modes={['month_value', 'month_percent', 'days']} aop
          title="Your own change" sendLabel="Save my change" doneWords="You set" doneTail="" />)}
      <Questions l={l} questions={review.state.questions.filter(q => q.line === l.rowId)} initial={header.person.slice(0, 1)} onAsk={t => void review.actions.ask(l, t)} />
    </>
  }

  // ---- the tiles: the store's totals and the Team Leaders' review ----
  const waitingHere = review.waitingIn(lines)
  const tiles = <KpiTiles total={combine(lines, -1)} header={header} approvedDelta={review.approvedDelta(lines)} valueOnly={multiCategory(lines)}
    extra={<Tile name="Team Leaders' review" value={`${fullyAnswered(secs)} of ${secs.length}`} testId="kpi-review"
      lines={['sections fully answered', <b>{waitingHere} {waitingHere === 1 ? 'proposal' : 'proposals'} waiting</b>]} />} />

  // ---- the store's table: floor › section, or division › subdivision › category ----
  const sectionLevel: Level = LEVEL.section
  const nodeSub = (n: TreeNode) => (n.level === sectionLevel.name ? sectionLine(secOf(n.label) ?? { teamLeader: undefined, answered: null, lines: n.lines }) : undefined)
  const pivotChoice = <ToolbarChoice label="View" hover="Store layout: floor › section › subcategory. Merchandise: division › subdivision › category › subcategory"
    value={pivot} onChange={setPivotOpen} options={[{ value: 'layout', label: 'Store layout' }, { value: 'merch', label: 'Merchandise' }]} />
  const tree = (ls: Line[], lv: Level[], totalLabel: string, firstHeading?: string) => (
    <ReviewTree header={header} view={view} lines={ls} levels={lv} totalLabel={totalLabel} firstHeading={firstHeading}
      sort={sort} onSort={setSort} openNodes={openNodes} onToggleNode={id => setOpenNodes(s => toggle(s, id))}
      open={open} onOpen={setOpen} hrefFor={hrefFor} answer={answer} onHelp={onHelp} flash={flash}
      linePills={l => review.linePills(l, true)} nodePills={n => nodeWaiting(review.waitingIn(n.lines), true)} nodeSub={nodeSub} valueOnly={valueOnly} />
  )
  const storeTable = <>
    <ReviewToolbar value={view} onChange={setView} toggles={['measure', 'groups', 'shape']} lead={pivotChoice} wrap />
    <PartsLegend hint="Click a floor, section or category to open it; click a subcategory for how Feather Forecast built it." />
    <div data-testid="store-table">{tree(lines, levels, 'Store')}</div>
  </>

  // ---- proposals: the approvals table ----
  const mine = review.proposals.filter(p => lines.some(l => l.rowId === p.line))
  const lineOf = (rowId: string) => all.find(l => l.rowId === rowId)!
  const waiting = mine.filter(p => p.state === 'waiting')
  const ordered = [...waiting, ...mine.filter(p => p.state !== 'waiting')]
  const head = (text: string, i: number, last: boolean, num = true) => <th key={text} className={headCellClasses({ first: i === 0, last, className: num ? 'text-right' : '' })}>{text}</th>
  const HEADINGS: [string, boolean][] = [['Subcategory', false], ['Section · Team Leader', false], ['Feather Forecast', true], ['Proposed', true], ['Change', true], ['Last month', true], ['Last year', true], ['AOP', true], ['Reasons', false]]
  const approvalsTable = <>
    <p className="sm-hint">Click a proposal to see its subcategory and decide.</p>
    <div className="fr-scroll">
      <table className={cx(TABLE_CLASSES, 'sm-approvals')} data-testid="approvals-table">
        <thead><tr>{HEADINGS.map(([t, num], i) => head(t, i, i === HEADINGS.length - 1, num))}</tr></thead>
        <tbody>{ordered.map(p => {
          const l = lineOf(p.line), isOpen = pline === p.id, c = (first = false, last = false, className = '') => cellClasses({ first, last, className })
          return (
            <Fragment key={p.id}>
              <tr className="group cursor-pointer" aria-selected={isOpen} data-key={p.id}
                onClick={e => { if ((e.target as HTMLElement).closest('a') && (e.metaKey || e.ctrlKey || e.shiftKey)) return; setPline(isOpen ? null : p.id) }}>
                <td className={c(true)}><span className="sm-name"><RecordLink table={LINE_TABLE} rowId={l.rowId} name={l.name} href={hrefFor(l)} onNavigate={() => {}} />{review.linePills(l, true)}</span></td>
                <td className={c()}>{p.section}<span className="fr-dim"> · {p.by}</span></td>
                <td className={c(false, false, 'sm-num')}>{inr(p.forecast)}</td>
                <td className={c(false, false, 'sm-num font-semibold')}>{inr(p.state === 'approved' && p.final != null ? p.final : p.proposed)}</td>
                <td className={c(false, false, cx('sm-num', p.proposed >= p.forecast ? 'text-positive' : 'text-negative'))}>{pc(p.proposed, p.forecast)}</td>
                <td className={c(false, false, 'sm-num')}>{inr(l.r31)}</td>
                <td className={c(false, false, 'sm-num')}>{inr(l.ly)}</td>
                <td className={c(false, false, 'sm-num')}>{inr(l.aop)}</td>
                <td className={c(false, true, 'sm-wrap')}>{p.reasons.map(reasonLabel).join(', ')}</td>
              </tr>
              {isOpen && <tr><td colSpan={HEADINGS.length} className="sm-panelcell">
                <LinePanel item={l} header={header} storeStep={storeStep} aop onHelp={t => onHelp(t, l.rowId)} answer={answer(l)} />
              </td></tr>}
            </Fragment>)
        })}</tbody>
      </table>
      {!ordered.length && <p className="fr-dim">No proposals yet.</p>}
    </div>
  </>

  // ---- the Section Board: the queue, a tile per section, the chosen section's subcategories ----
  const sortChoice = <ToolbarChoice label="Sort" hover="The order of the sections: furthest behind AOP, biggest change on last year, or biggest first"
    value={boardSort} onChange={setBoardSort} options={[{ value: 'aop', label: 'Behind AOP' }, { value: 'ly', label: 'Gap to last year' }, { value: 'size', label: 'Size' }]} />
  const sectionTile = (s: SectionSummary) => {
    const w = review.waitingIn(s.lines), o = s.item, tone = aopTone(o), n = s.lines.length
    return (
      <button key={s.name} type="button" className="sm-tile" aria-pressed={board === s.name} data-n={s.name}
        onClick={() => { setBoard(board === s.name ? null : s.name); setOpen(null) }}>
        <span className="sm-tn">{s.name}</span>
        <span className="sm-tt">{s.teamLeader || 'No Team Leader'}</span>
        <span className="sm-tv"><b>{inr(o.fc)}</b><span className={aopText(o)}>{o.aop ? `${Math.round(o.fc / o.aop * 100)}% of AOP` : 'no AOP'}</span></span>
        <span className="sm-meter" title="Feather Forecast against AOP; the mark is 100%"><i data-tone={tone} style={{ width: `${meterWidth(o)}%` }} /></span>
        <span className="sm-tt">Gap <span className={aopText(o)}>{o.aop ? inr(o.fc - o.aop) : '—'}</span> · {pc(o.fc, o.ly)} on last year</span>
        <span className="sm-tp">
          {w > 0 && <StatusPill tone="caution" className="fr-pill">{w} waiting for you</StatusPill>}
          {s.answered == null ? null : s.answered === n ? <StatusPill tone="positive" className="fr-pill">Answered</StatusPill> : <StatusPill tone="neutral" className="fr-pill">{s.answered} of {n}</StatusPill>}
        </span>
      </button>)
  }
  const chosen = board ? secOf(board) : undefined
  const sectionBoard = <>
    <div className="sm-queue" data-testid="waiting-queue"><b>Waiting for you ({waiting.length})</b>
      {waiting.length ? waiting.map(p => <ChipButton key={p.id} onClick={() => jumpTo(p.line)}>{lineOf(p.line).name} · {inr(p.forecast)} → {inr(p.proposed)}</ChipButton>)
        : <span className="fr-dim">nothing waiting</span>}</div>
    <ReviewToolbar value={view} onChange={setView} toggles={['measure', 'groups', 'shape']} lead={sortChoice} wrap />
    <div className="sm-board" data-testid="section-board">{boardOrder(secs, boardSort).map(sectionTile)}</div>
    {chosen
      ? <>
        <h2 className="fr-sec">{chosen.name} <span className="fr-dim">{sectionLine(chosen)}</span></h2>
        <PartsLegend hint="Click a subcategory for how Feather Forecast built it." />
        {tree(chosen.lines, [], 'Section', 'Subcategory')}
      </>
      : <p className="sm-empty">Choose a section to see its subcategories.</p>}
  </>

  const helpTab = <HelpTab header={header} lines={all} storeStep={storeStep} at={help.at} from={help.from} managers
    onBack={name => { const l = all.find(x => x.name === name); if (l) jumpTo(l.rowId) }}
    intro={<><h3>Your store, {header.month.name}</h3><p>You see every section of {STORE}. Each section is a Team Leader's area. Team Leaders accept Feather Forecast subcategory by subcategory, or propose a change with reasons; their proposals wait here for you. Approve one, edit its number and approve, or send it back with a reason. The store total is always shown against AOP, the plan you have to catch up to.</p></>} />

  const views = [
    { id: 'store', label: 'The Store', content: screen === 'store' && <>{tiles}{storeTable}</> },
    { id: 'approvals', label: `Approvals (${review.waiting.length})`, content: screen === 'approvals' && <>{tiles}{approvalsTable}</> },
    { id: 'board', label: 'Section Board', content: screen === 'board' && <>{tiles}{sectionBoard}</> },
    { id: 'help', label: 'Help', content: helpTab },
  ]

  return (
    <ReviewFrame testId="store-manager-review" unsaved={chain.real} title={`${STORE} · ${all[0]?.storeName ?? ''} · ${header.month.label}`}
      status={`${header.person} · ${header.role} · sales to ${header.cutOff} · before tax`}
      all={all} scope={scope} kinds={KINDS_HERE} views={views} view={screen}
      onView={v => { setScreen(v); setOpen(null); if (v !== 'help') setHelp({ at: null, from: null }) }} />
  )
}
