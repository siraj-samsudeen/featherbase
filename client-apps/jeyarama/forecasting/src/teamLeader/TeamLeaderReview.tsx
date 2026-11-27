// The Team Leader review (#1419), faithful to the prototype agreed on 27-Nov-2026 (data-warehouse #4935, spec
// TL-1..TL-35). It draws one section's subcategories for one Run, from the shared review parts (src/shared);
// what it shows besides the Run (answers, questions) and what it asks to be done come in as `state` and
// `actions`, so the same screen runs on a story's memory or on the app's tables.
import { useMemo, useState, type ReactNode } from 'react'
import { Chip, ContentTabs, PageHeader, RecordLink, StatusPill } from '@featherbase/shop-floor'
import { byGapToLastYear, combine, groupsOf, type Group, type HelpTopic, type Line } from '../shared/model'
import type { Header, ReviewActions, ReviewState } from '../shared/review'
import { DEFAULT_VIEW, PartsLegend, ReviewToolbar, type ViewChoices } from '../shared/ReviewToolbar'
import { MeasureTable, type TableRow } from '../shared/MeasureTable'
import { Hover } from '../shared/Hover'
import { LinePanel } from '../shared/LinePanel'
import { ChangeForm } from '../shared/ChangeForm'
import { MyQuestions, Questions } from '../shared/Questions'
import { HelpTab } from '../shared/Help'
import '../shared/forecasting.css'

const groupKey = (g: Group) => `group:${g.index}`

export function TeamLeaderReview({ header, lines, storeStep, state, actions, hrefFor, openLine: initialLine, onOpenLine }: {
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
  onOpenLine?: (line: string | null) => void
}) {
  const [view, setView] = useState<ViewChoices>(DEFAULT_VIEW)
  const [tab, setTab] = useState('review')
  const [open, setOpenState] = useState<string | null>(initialLine ?? null)
  const [help, setHelp] = useState<{ at: HelpTopic | null; from: string | null }>({ at: null, from: null })
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(initialLine ? { key: initialLine, n: 0 } : null)

  const groups = useMemo(() => groupsOf(lines), [lines])
  const section = useMemo(() => combine(lines, -1, 'Section'), [lines])
  const groupOf = (name: string) => groups.find(g => g.members.some(m => m.name === name))
  const isLine = (key: string | null) => Boolean(key && lines.some(l => l.name === key))
  const setOpen = (key: string | null) => {
    setOpenState(key)
    onOpenLine?.(isLine(key) ? key : null)
    if (key && isLine(key)) void actions.seen(key)
  }
  const jumpTo = (name: string) => { setTab('review'); setHelp({ at: null, from: null }); setOpen(name); setFlash(f => ({ key: name, n: (f?.n ?? 0) + 1 })) }

  const pills = (name: string) => {
    const a = state.answers[name], qs = state.questions.filter(q => q.line === name), out: ReactNode[] = []
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

  const rows: TableRow[] = []
  const loose = lines.filter(l => view.groups === 'off' || !groupOf(l.name))
  if (view.groups === 'band') {
    for (const g of groups) { rows.push(groupRow(g, ['band', 'head'])); g.members.forEach(m => rows.push(lineRow(m, ['band', 'member']))) }
    byGapToLastYear(loose).forEach(l => rows.push(lineRow(l)))
  } else if (view.groups === 'one') {
    for (const it of byGapToLastYear<Line | Group>([...groups, ...loose])) {
      if (!('members' in it)) { rows.push(lineRow(it)); continue }
      rows.push(groupRow(it, ['band']))
      // the group stays open while one of its subcategories is open
      if (open === groupKey(it) || it.members.some(m => m.name === open)) it.members.forEach(m => rows.push(lineRow(m, ['band', 'member'])))
    }
  } else byGapToLastYear(loose).forEach(l => rows.push(lineRow(l)))

  const panel = (row: TableRow, width: number | undefined) => {
    const l = row.item
    const own = 'members' in l ? null : l
    return (
      <LinePanel item={l} header={header} storeStep={storeStep} aop={view.aop} width={width}
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
      <PartsLegend />
      <MeasureTable header={header} view={view} rows={rows} total={section} open={open} onToggle={setOpen} panel={panel} flash={flash} />
    </div>
  )

  return (
    <div className="fr flex flex-col" data-testid="team-leader-review">
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
