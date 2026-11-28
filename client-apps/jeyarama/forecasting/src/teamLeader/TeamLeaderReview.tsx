// The Team Leader review (#1419), faithful to the prototype agreed on 27-Nov-2026 (data-warehouse #4935, spec
// TL-1..TL-35). It draws one section's subcategories for one Run, from the shared review parts (src/shared);
// what it shows besides the Run (answers, questions) and what it asks to be done come in as `state` and
// `actions`, so the same screen runs on a story's memory or on the app's tables.
import { useMemo, useState, type ReactNode } from 'react'
import { Chip, PageHeader, RecordLink, StatusPill } from '@featherbase/shop-floor'
import { byGapToLastYear, combine, groupsOf, inr, matches, type Group, type HelpTopic, type Line } from '../shared/model'
import { SubcategorySearch } from '../shared/SubcategorySearch'
import type { Header, ReviewActions, ReviewState } from '../shared/review'
import { DEFAULT_VIEW, PartsLegend, ReviewToolbar, type ViewChoices } from '../shared/ReviewToolbar'
import { MeasureTable, type TableRow } from '../shared/MeasureTable'
import { Hover } from '../shared/Hover'
import { LinePanel } from '../shared/LinePanel'
import { ChangeForm } from '../shared/ChangeForm'
import { MyQuestions, Questions } from '../shared/Questions'
import { HelpTab } from '../shared/Help'
import { ShortOfStock } from '../shared/PriceBands'
import '../shared/forecasting.css'

const groupKey = (g: Group) => `group:${g.index}`

export function TeamLeaderReview({ header, lines, storeStep, state, actions, hrefFor, openLine: initialLine, openBand, onOpenLine, switcher }: {
  header: Header
  lines: Line[]
  /** The store's usual December rise, for a group's sentences (a subcategory has its own). */
  storeStep: number
  state: ReviewState
  actions: ReviewActions
  /** Where a subcategory opens on its own (its RecordLink): this screen with it open. */
  hrefFor: (line: Line) => string
  /** A subcategory to open on arrival (a link to it, or a jump from My questions). */
  openLine?: string | null
  /** The price band to open under it on arrival (a Needs Your Attention finding). */
  openBand?: string | null
  onOpenLine?: (line: string | null) => void
  /** A way to another section, in the header (the app's SectionSwitcher); none in the story. */
  switcher?: ReactNode
}) {
  const [view, setView] = useState<ViewChoices>(DEFAULT_VIEW)
  const [tab, setTab] = useState('review')
  const [query, setQuery] = useState('')
  const [open, setOpenState] = useState<string | null>(initialLine ?? null)
  const [band, setBand] = useState<string | null>(initialLine ? openBand ?? null : null)
  const [help, setHelp] = useState<{ at: HelpTopic | null; from: string | null }>({ at: null, from: null })
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(initialLine ? { key: initialLine, n: 0 } : null)

  const groups = useMemo(() => groupsOf(lines), [lines])
  const section = useMemo(() => combine(lines, -1, 'Section'), [lines])
  const groupOf = (name: string) => groups.find(g => g.members.some(m => m.name === name))
  const isLine = (key: string | null) => Boolean(key && lines.some(l => l.name === key))
  const setOpen = (key: string | null) => {
    setOpenState(key)
    setBand(null)
    onOpenLine?.(isLine(key) ? key : null)
    if (key && isLine(key)) void actions.seen(key)
  }
  const jumpTo = (name: string) => { setTab('review'); setHelp({ at: null, from: null }); setOpen(name); setFlash(f => ({ key: name, n: (f?.n ?? 0) + 1 })) }

  const pills = (name: string) => {
    const a = state.answers[name], qs = state.questions.filter(q => q.line === name), out: ReactNode[] = []
    const m = state.moved?.[name]
    if (m && !a) out.push(<Hover key="m" text={`Your answer was given when Feather Forecast was ${inr(m.from)}; it is now ${inr(m.to)}.`}><StatusPill tone="caution" className="fr-pill">Feather Forecast moved: answer again</StatusPill></Hover>)
    if (a?.status === 'accepted') out.push(<StatusPill key="a" tone="positive" className="fr-pill">Accepted</StatusPill>)
    if (a?.status === 'change_proposed') out.push(<StatusPill key="c" tone="neutral" className="fr-pill">Change proposed</StatusPill>)
    if (qs.some(q => !q.answer)) out.push(<StatusPill key="q" tone="caution" className="fr-pill">Question open</StatusPill>)
    else if (qs.some(q => q.answer && !q.seen)) out.push(<StatusPill key="n" tone="neutral" className="fr-pill">New answer</StatusPill>)
    return out
  }
  const lineRow = (l: Line, look: TableRow['look'] = []): TableRow => {
    const g = view.groups === 'off' ? groupOf(l.name) : undefined
    return {
      key: l.name, item: l, look,
      label: <>
        {g && <Hover text={`In group ${g.index + 1}: ${g.members.map(m => m.name).join(', ')}`}><Chip hue="violet" compact>G{g.index + 1}</Chip></Hover>}
        <RecordLink table="forecasting.forecast_line_month" rowId={l.rowId} name={l.name} href={hrefFor(l)} onNavigate={() => {}} />
      </>,
      after: pills(l.name),
    }
  }
  const groupRow = (g: Group, look: TableRow['look']): TableRow => ({
    key: groupKey(g), dataName: g.name, item: g, look,
    label: <><Chip hue="violet" compact>Group {g.index + 1}</Chip><b>{g.name}</b></>,
    note: look?.includes('head') ? 'Moved in opposite directions' : undefined,
  })

  // the search narrows the table: a subcategory shows when it matches; a group when any of its members does
  const searching = query.trim() !== ''
  const hit = (l: Line) => matches(l, query)
  const shown = (g: Group) => g.members.some(hit)
  const rows: TableRow[] = []
  const loose = lines.filter(l => (view.groups === 'off' || !groupOf(l.name)) && hit(l))
  if (view.groups === 'band') {
    for (const g of groups.filter(shown)) { rows.push(groupRow(g, ['band', 'head'])); g.members.forEach(m => rows.push(lineRow(m, ['band', 'member']))) }
    byGapToLastYear(loose).forEach(l => rows.push(lineRow(l)))
  } else if (view.groups === 'one') {
    for (const it of byGapToLastYear<Line | Group>([...groups.filter(shown), ...loose])) {
      if (!('members' in it)) { rows.push(lineRow(it)); continue }
      rows.push(groupRow(it, ['band']))
      // the group stays open while one of its subcategories is open, and opens to show the ones a search matches
      if (open === groupKey(it) || it.members.some(m => m.name === open) || searching)
        it.members.filter(m => !searching || hit(m) || open === groupKey(it)).forEach(m => rows.push(lineRow(m, ['band', 'member'])))
    }
  } else byGapToLastYear(loose).forEach(l => rows.push(lineRow(l)))

  const panel = (row: TableRow, width: number | undefined) => {
    const l = row.item
    const own = 'members' in l ? null : l
    return (
      <LinePanel item={l} header={header} storeStep={storeStep} aop={view.aop} width={width} band={band} onBand={setBand}
        onHelp={topic => { setTab('help'); setHelp({ at: topic, from: row.key }) }}
        answer={own && <>
          <ChangeForm key={`${own.rowId}:${state.answers[own.name]?.status ?? ''}`} l={own} answer={state.answers[own.name]} month={header.month}
            onAccept={() => { void actions.accept(own); setOpen(null) }} onPropose={p => { void actions.propose(own, p); setOpen(null) }} />
          <Questions l={own} questions={state.questions.filter(q => q.line === own.name)} initial={header.person.slice(0, 1)} onAsk={text => void actions.ask(own, text)} />
        </>} />
    )
  }

  const review = (
    <div className="fr">
      <ReviewToolbar value={view} onChange={setView} />
      <ShortOfStock lines={lines} header={header} onOpen={(name, b) => { jumpTo(name); setBand(b) }} />
      <PartsLegend />
      <MeasureTable header={header} view={view} rows={rows} total={section} open={open} onToggle={setOpen} panel={panel} flash={flash} />
    </div>
  )

  return (
    <div className="fr flex flex-col" data-testid="team-leader-review">
      <PageHeader title={`${header.store} · ${header.section} · ${header.month.label}`}
        status={`${header.person} · ${header.role} · sales to ${header.cutOff} · before tax`}
        actions={<>{switcher}<MyQuestions questions={state.questions} lines={lines} hrefFor={hrefFor} onJump={jumpTo} /></>} />
      <div className="mt-4"><SubcategorySearch lines={lines} query={query} onOpen={jumpTo}
        onQuery={q => { setQuery(q); if (q) { setTab('review'); setHelp({ at: null, from: null }) } }} /></div>
      {/* one underlined tab row, Help last (the prototype's; the same on every forecasting page) */}
      <div className="fr-tabs mt-4" role="tablist" aria-label="Review sections">
        {[['review', 'Review'], ['help', 'Help']].map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`fr-tab-${id}`} aria-controls={`fr-panel-${id}`} aria-selected={tab === id}
            onClick={() => { setTab(id); if (id === 'review') setHelp({ at: null, from: null }) }}>{label}</button>))}
      </div>
      <div className="fr-tabpanel" role="tabpanel" id="fr-panel-review" aria-labelledby="fr-tab-review" hidden={tab !== 'review'}>{review}</div>
      <div className="fr-tabpanel" role="tabpanel" id="fr-panel-help" aria-labelledby="fr-tab-help" hidden={tab !== 'help'}>
        <HelpTab header={header} lines={lines} storeStep={storeStep} at={help.at} from={help.from} onBack={jumpTo} /></div>
    </div>
  )
}
