// The Team Leader review (#1419), faithful to the prototype agreed on 27-Nov-2026 (data-warehouse #4935, spec
// TL-1..TL-35). It draws one section's lines for one Run; what it shows besides the Run (answers, questions) and
// what it asks to be done come in as `state` and `actions`, so the same screen runs on a story's memory or on
// the app's tables. Its words, columns and toggles are the prototype's; only the look comes from Shop Floor.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Chip, ContentTabs, PageHeader, PartsBar, PeekCard, RecordLink, Segmented, StatusPill } from '@featherbase/shop-floor'
import { PARTS, asp, byGapToLastYear, combine, count, groupsOf, inr, pc, shares, type Group, type HelpTopic, type Line } from '../shared/model'
import type { Header, ReviewActions, ReviewState } from '../shared/review'
import { LinePanel } from '../shared/LinePanel'
import { HelpTab, MyQuestions } from '../shared/HelpAndQuestions'
import '../shared/forecasting.css'

type Measure = 'all' | 'vq' | 'v' | 'q'
type GroupView = 'band' | 'one' | 'off'
type Item = Line | Group
const isGroup = (l: Item): l is Group => 'members' in l
const nameOf = (l: Item) => (isGroup(l) ? `Group ${l.index + 1}` : l.name)

/** A hover definition (TL-7..10, TL-13): Shop Floor's PeekCard over a heading or a toggle. */
function Hover({ text, children }: { text: string; children: ReactNode }) {
  return <PeekCard label={text} trigger={<span tabIndex={0} className="inline-flex items-center gap-2">{children}</span>}><span className="text-sm">{text}</span></PeekCard>
}

export function TeamLeaderReview({ header, lines, storeStep, state, actions, hrefFor, openLine: initialLine, onOpenLine }: {
  header: Header
  lines: Line[]
  /** The store's usual December rise, for a group's sentences (a line has its own). */
  storeStep: number
  state: ReviewState
  actions: ReviewActions
  /** Where a line opens on its own (its RecordLink): this screen with that line open. */
  hrefFor: (line: Line) => string
  /** A line to open on arrival (a link to it, or a jump from My questions). */
  openLine?: string | null
  onOpenLine?: (line: string | null) => void
}) {
  const [measure, setMeasure] = useState<Measure>('all')
  const [groupView, setGroupView] = useState<GroupView>('one')
  const [shape, setShape] = useState<'bar' | 'donut'>('bar')
  const [aop, setAop] = useState(false)
  const [tab, setTab] = useState('review')
  const [open, setOpenState] = useState<string | null>(initialLine ?? null)
  const [help, setHelp] = useState<{ at: HelpTopic | null; from: string | null }>({ at: null, from: null })
  const [flash, setFlash] = useState<{ line: string; n: number } | null>(initialLine ? { line: initialLine, n: 0 } : null)
  const scroller = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState<number>()

  const groups = useMemo(() => groupsOf(lines), [lines])
  const section = useMemo(() => combine(lines, -1, 'Section'), [lines])
  const groupOf = (name: string) => groups.find(g => g.members.some(m => m.name === name))
  const setOpen = (name: string | null) => {
    setOpenState(name)
    onOpenLine?.(name && lines.some(l => l.name === name) ? name : null)
    if (name && lines.some(l => l.name === name)) void actions.seen(name)
  }
  const jumpTo = (name: string) => { setTab('review'); setHelp({ at: null, from: null }); setOpen(name); setFlash(f => ({ line: name, n: (f?.n ?? 0) + 1 })) }

  // The opened panel is as wide as the visible table, also when the table scrolls sideways (TL-25).
  useLayoutEffect(() => {
    const measureWidth = () => setPanelWidth(scroller.current?.clientWidth)
    measureWidth()
    window.addEventListener('resize', measureWidth)
    return () => window.removeEventListener('resize', measureWidth)
  }, [tab])
  // A jump scrolls the line to the top and flashes it (TL-33).
  useEffect(() => {
    if (!flash || tab !== 'review') return
    const row = scroller.current?.querySelector<HTMLElement>(`tr[data-n="${CSS.escape(flash.line)}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'start', behavior: 'instant' })
    window.scrollBy(0, -12)
    row.classList.remove('tl-flash'); void row.offsetWidth; row.classList.add('tl-flash')
  }, [flash, tab])

  const blocks: [keyof Line & string, keyof Line & string, string, string][] = [
    ['fc', 'fq', 'Feather Forecast', `Feather Forecast for ${header.month.name}`],
    ['r31', 'r31q', 'Last month', `Last 28 days to ${header.cutOff}, as a rate per day × ${header.month.name}'s ${header.month.days} days`],
    ['ly', 'lyq', 'Last year', `${header.month.name} ${header.month.year - 1}`],
    ...(aop ? [['aop', 'aq', 'AOP', `The annual plan for ${header.month.label}`] as [keyof Line & string, keyof Line & string, string, string]] : []),
  ]
  const measures = ({ all: ['v', 'q', 'a'], vq: ['v', 'q'], v: ['v'], q: ['q'] } as const)[measure]
  const columns = 1 + blocks.length * measures.length + 3

  const pills = (name: string) => {
    const a = state.answers[name], qs = state.questions.filter(q => q.line === name), out: ReactNode[] = []
    if (a?.status === 'accepted') out.push(<StatusPill key="a" tone="positive" className="tl-pill">Accepted</StatusPill>)
    if (a?.status === 'change_proposed') out.push(<StatusPill key="c" tone="neutral" className="tl-pill">Change proposed</StatusPill>)
    if (qs.some(q => !q.answer)) out.push(<StatusPill key="q" tone="caution" className="tl-pill">Question open</StatusPill>)
    else if (qs.some(q => q.answer && !q.seen)) out.push(<StatusPill key="n" tone="neutral" className="tl-pill">New answer</StatusPill>)
    return out
  }

  const cell = (l: Item, [k, q]: [string, string, ...unknown[]], m: 'v' | 'q' | 'a', first: boolean, cls: string) => {
    const v = (l as unknown as Record<string, number>)[k], qty = (l as unknown as Record<string, number>)[q]
    return <td key={`${k}${m}`} className={`${first ? 'tl-b0 ' : ''}${cls}`}>{m === 'v' ? inr(v) : m === 'q' ? count(qty) : asp(v, qty)}</td>
  }

  const row = (l: Item, cls: string, label?: ReactNode) => {
    const name = isGroup(l) ? l.name : l.name, key = isGroup(l) ? `group:${l.index}` : l.name
    const isOpen = open === key
    const g = !isGroup(l) && groupView === 'off' ? groupOf(l.name) : undefined
    return (
      <Fragment key={key}>
        <tr className={`tl-row ${cls}`} data-n={isGroup(l) ? name : l.name} aria-selected={isOpen} aria-expanded={isOpen}
          onClick={e => { if ((e.target as HTMLElement).closest('a') && (e.metaKey || e.ctrlKey || e.shiftKey)) return; setOpen(isOpen ? null : key) }}>
          <td>
            <span className="tl-name">
              <span className="tl-twisty" aria-hidden>{isOpen ? '▾' : '▸'}</span>
              {g && <Hover text={`In group ${g.index + 1}: ${g.members.map(m => m.name).join(', ')}`}><Chip hue="violet" compact>G{g.index + 1}</Chip></Hover>}
              {label ?? (isGroup(l) ? <b>{l.name}</b> : <RecordLink table="forecasting.forecast_line_month" rowId={l.rowId} name={l.name} href={hrefFor(l)} onNavigate={() => {}} />)}
              {!isGroup(l) && pills(l.name)}
            </span>
            {isGroup(l) && cls.includes('tl-ghead') && <span className="tl-gwhy">Moved in opposite directions</span>}
          </td>
          {blocks.map((b, bi) => measures.map((m, mi) => cell(l, b, m, mi === 0, bi === 0 ? 'tl-fc' : 'tl-dim')))}
          <td className="tl-b0">{pc(l.fc, l.r31)}</td><td>{pc(l.fc, l.ly)}</td>
          <td className="tl-b0"><PartsBar parts={shares(l)} shape={shape} /></td>
        </tr>
        {isOpen && (
          <tr className="tl-panelrow"><td colSpan={columns}>
            <LinePanel item={l} header={header} storeStep={storeStep} aop={aop} width={panelWidth}
              answer={isGroup(l) ? undefined : state.answers[l.name]} questions={isGroup(l) ? [] : state.questions.filter(q => q.line === l.name)}
              onHelp={topic => { setTab('help'); setHelp({ at: topic, from: l.name }) }}
              onAccept={() => { if (!isGroup(l)) { void actions.accept(l); setOpen(null) } }}
              onPropose={p => { if (!isGroup(l)) { void actions.propose(l, p); setOpen(null) } }}
              onAsk={text => { if (!isGroup(l)) void actions.ask(l, text) }} />
          </td></tr>)}
      </Fragment>
    )
  }

  const body: ReactNode[] = []
  const tag = (g: Group) => <><Chip hue="violet" compact>Group {g.index + 1}</Chip><b>{g.name}</b></>
  const loose = lines.filter(l => groupView === 'off' || !groupOf(l.name))
  if (groupView === 'band') {
    for (const g of groups) { body.push(row(g, 'tl-band tl-ghead', tag(g))); g.members.forEach(m => body.push(row(m, 'tl-band tl-member'))) }
    byGapToLastYear(loose).forEach(l => body.push(row(l, '')))
  } else if (groupView === 'one') {
    for (const it of byGapToLastYear<Item>([...groups, ...loose])) {
      if (!isGroup(it)) { body.push(row(it, '')); continue }
      body.push(row(it, 'tl-band', tag(it)))
      // the group stays open while one of its lines is open
      if (open === `group:${it.index}` || it.members.some(m => m.name === open)) it.members.forEach(m => body.push(row(m, 'tl-band tl-member')))
    }
  } else byGapToLastYear(loose).forEach(l => body.push(row(l, '')))

  const toggle = <T extends string>(label: string, hover: string, value: T, onChange: (v: T) => void, options: { value: T; label: string }[]) => (
    <Hover text={hover}><span className="tl-toolbar-label">{label}</span><Segmented label={label} value={value} onChange={onChange} options={options} /></Hover>)

  const review = (
    <div className="tl">
      <div className="tl-toolbar">
        {toggle<Measure>('Show', 'Value, quantity and average selling price', measure, setMeasure, [{ value: 'all', label: 'All three' }, { value: 'vq', label: 'Value · Qty' }, { value: 'v', label: 'Value' }, { value: 'q', label: 'Qty' }])}
        {toggle<GroupView>('Groups', 'Subcategories that moved in opposite directions: on top with their subcategories, as one row, or tagged on each subcategory', groupView, setGroupView, [{ value: 'band', label: 'On top' }, { value: 'one', label: 'One row' }, { value: 'off', label: 'Tagged' }])}
        {toggle<'bar' | 'donut'>('Built from', 'How Feather Forecast built each number', shape, setShape, [{ value: 'bar', label: 'Bar' }, { value: 'donut', label: 'Donut' }])}
        {toggle<'off' | 'on'>('AOP', 'Show the annual plan', aop ? 'on' : 'off', v => setAop(v === 'on'), [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }])}
      </div>
      <div className="tl-legend">
        {PARTS.map(p => <span key={p.key} style={{ ['--c' as string]: p.color }}>{p.label}</span>)}
        <span>Click any row for how Feather Forecast built it and what other models say.</span>
      </div>
      <div className="tl-scroll" ref={scroller}>
        <table className="tl-table">
          <thead>
            <tr className="tl-blocks"><th />
              {blocks.map(b => <th key={b[2]} colSpan={measures.length} className="tl-b0"><Hover text={b[3]}>{b[2]}</Hover></th>)}
              <th colSpan={2} className="tl-b0"><Hover text="Feather Forecast's value against last month and last year">Value vs</Hover></th>
              <th className="tl-b0">Built from</th></tr>
            <tr><th>Subcategory</th>
              {blocks.map(b => measures.map((m, i) => <th key={b[2] + m} className={i === 0 ? 'tl-b0' : ''}>{{ v: 'Value', q: 'Qty', a: 'ASP' }[m]}</th>))}
              <th className="tl-b0"><Hover text={`Last 28 days at ${header.month.name}'s ${header.month.days} days`}>Last month</Hover></th>
              <th><Hover text={`${header.month.name} ${header.month.year - 1}`}>Last year</Hover></th><th className="tl-b0" /></tr>
          </thead>
          <tbody>{body}</tbody>
          <tfoot><tr><td>Section</td>
            {blocks.map(b => measures.map((m, mi) => cell(section, b, m, mi === 0, '')))}
            <td className="tl-b0">{pc(section.fc, section.r31)}</td><td>{pc(section.fc, section.ly)}</td>
            <td className="tl-b0"><PartsBar parts={shares(section)} shape={shape} /></td></tr></tfoot>
        </table>
      </div>
    </div>
  )

  return (
    <div className="tl flex flex-col" data-testid="team-leader-review">
      <PageHeader title={`${header.store} · ${header.section} · ${header.month.label}`}
        status={`${header.person} · ${header.role} · sales to ${header.cutOff} · before tax`}
        actions={<MyQuestions questions={state.questions} lines={lines} hrefFor={hrefFor} onJump={jumpTo} />} />
      <ContentTabs className="mt-4" label="Review sections" value={tab}
        onChange={t => { setTab(t); if (t === 'review') setHelp({ at: null, from: null }) }}
        tabs={[
          { id: 'review', label: 'Review', content: review },
          { id: 'help', label: 'Help', content: <HelpTab header={header} lines={lines} storeStep={storeStep} at={help.at} from={help.from} onBack={jumpTo} /> },
        ]} />
    </div>
  )
}
