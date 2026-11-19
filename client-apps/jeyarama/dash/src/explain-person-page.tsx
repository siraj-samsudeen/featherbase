// #1340: Explain A Person, rebuilt from the shared pieces (spec item 9): a person picker; the person's header as on a
// record page; the answer first, in one sentence; their fields Today, With business roles and What changes; and their
// business roles, apps and reports as Links sections, each a locked tick (they change on HR or by hand, not here) with
// where it comes from and a Why? that opens the one-line chain. The rules are the server's (explain_person).
import { useState, type ReactNode } from 'react'
import { AreaPicker, Button, FieldGrid, Field, LinkLine, LinkSection, Notice, Select, TextInput, TickMark, ToneChip, fmtDate, pillClasses } from '@featherbase/shop-floor'
import { act } from './api'
import { DASH_AREAS, loadDashArea } from './area-axes'
import { Loading, Shell } from './sections-page'
import { RecordLink } from './record-link'
import { PersonPicker, type Found } from './access-page'
import { type Who } from './person-identity'
import { FEATHERBASE_ROLES, Failed, Parts, REFUSED, ROLE_TABLE, STAFF_BADGE, StaffBadge, counted, explainAddress, messageOf, useRead, type Part } from './roles-shared'

export type Kind = 'loses_dash' | 'gains_dash' | 'stores' | 'reports' | 'decision' | 'needs_dash_role'
export interface Change { kinds: Kind[]; stores_gained: Part[]; stores_lost: Part[]; stores_changed: Part[]; gained: Part[]; lost: Part[]; decisions: Part[]
  /** #1277: the roles that would give them every report, said as such rather than report by report. */
  every_report?: string[] }
export interface Side { opens: boolean; reports: number; stores: number }
interface Explained {
  person: string; name: string; who?: Who; employee: string | null
  header: { employee: Part[]; sites: Part[]; reports_to: Part[] }
  hr_titles: string[]
  roles: { role: string; name: string; source: string; kind?: string; from: string | null; area: { parts: Part[]; stores: number; subcategories: number | null }; until: string | null; reason: string | null; hand: string | null; hand_updated_at: string | null }[]
  unmapped: { title: string; job: string }[]
  apps: { app: string; level: string; via: string[] }[]
  reports: { key: string; name: string; why: string[] }[]
  today: Side
  next: Side
  change: Change
  choices: { id: string; name: string }[]
  places: { stores: { id: string; name: string }[]; default: string | null }
}

/** "Dash opens · 3 reports · 1 store". */
export const accessWords = (side: Side) => `${side.opens ? 'Dash opens' : 'No Dash'} · ${counted(side.reports, 'report')} · ${counted(side.stores, 'store')}`

/** "1 store, whole" or "2 stores · 14 subcategories". */
function reachWords(area: Explained['roles'][number]['area']): string {
  if (!area.stores) return 'Reaches no store'
  return `${counted(area.stores, 'store')}${area.subcategories === null ? ', whole' : ` · ${counted(area.subcategories, 'subcategory', 'subcategories')}`}`
}

/** What changes for one person, in words, each name a link. */
export function ChangeFacts({ change }: { change: Change }) {
  const facts: ReactNode[] = []
  if (change.kinds.includes('loses_dash')) facts.push('Would lose Dash')
  if (change.kinds.includes('gains_dash')) facts.push('Would gain Dash')
  if (change.kinds.includes('needs_dash_role')) facts.push('Business roles would open Dash, but they hold no Dash role to let them in')
  const list = (label: string, parts: Part[]) => { if (parts.length) facts.push(<>{label} <Parts parts={parts} /></>) }
  list('Would reach', change.stores_gained)
  list('Would stop reaching', change.stores_lost)
  list('Other subcategories at', change.stores_changed)
  if (change.gained.length && change.every_report?.length) facts.push(`Would get every report, through ${change.every_report.join(' and ')}`)
  else list('Would get', change.gained)
  list('Would lose', change.lost)
  list('Needs a decision:', change.decisions)
  return <>{facts.map((f, i) => <span key={i} data-testid="change-fact">{i ? ' · ' : ''}{f}</span>)}</>
}

export function ExplainPersonPage() {
  const params = new URLSearchParams(window.location.search)
  const person = params.get('person')
  const { answer, failed, load } = useRead<Explained>('explain_person', person ? { person } : null)
  const choose = (found: Found | null) => { if (found) window.location.search = explainAddress(found.person).slice(1) }
  // #1316: with no one chosen yet, ask whether this viewer may use the page at all.
  const may = useRead<boolean>('manages_roles', person ? null : {})
  // Someone who may not see the page gets the refusal alone, with no search above it.
  const refused = failed?.startsWith('Only a Report Access Manager') || may.answer === false
  return (
    <Shell current="explain" testid="explain-person" title="Explain A Person" wide>
      {!refused && <div className="max-w-xl"><PersonPicker chosen={null} onChoose={choose} label="Find a person" /></div>}
      {!person && (may.answer === false ? <Failed message={REFUSED} onRetry={may.load} />
        : <p className="fd-muted">Choose someone to see their business roles, the apps they would open and the reports they would get, today and with business roles.</p>)}
      {person && !answer && !failed && <Loading />}
      {failed && <Failed message={failed} onRetry={load} />}
      {answer && <Explanation answer={answer} onChanged={load} giving={params.get('give') === '1'} />}
    </Shell>
  )
}

/** The header chips: Employee, Site and Reports To, each a link where the viewer may open it. */
function HeaderChips({ header }: { header: Explained['header'] }) {
  const chip = (label: string, parts: Part[]) => parts.length > 0 && (
    <span key={label} className={pillClasses('bg-subtle text-ink font-normal')} data-testid="header-chip"><span className="text-ink-muted">{label}</span> <Parts parts={parts} /></span>
  )
  return <div className="flex flex-wrap gap-2" data-testid="header-chips">{chip('Employee', header.employee)}{chip('Site', header.sites)}{chip('Reports To', header.reports_to)}</div>
}

/** The answer first: nothing changes, or what does, in one sentence. */
function Answer({ answer }: { answer: Explained }) {
  if (!answer.change.kinds.length)
    return <Notice tone="positive"><span data-testid="explain-answer"><b className="font-semibold">Nothing changes for {answer.name}.</b> Today and with business roles: {accessWords(answer.today)}.</span></Notice>
  return <Notice tone="caution"><span data-testid="explain-answer"><b className="font-semibold">With business roles, {answer.name} changes:</b> <ChangeFacts change={answer.change} />.</span></Notice>
}

/** A source chip: from HR (or a merchandise or buyer assignment) in the action tint; by hand in the caution tint. */
const sourceChip = (role: Explained['roles'][number]) =>
  <ToneChip tone={role.hand ? 'caution' : 'neutral'}>{role.hand ? 'given by hand' : role.source.replace(/^From /, 'from ')}</ToneChip>

function Explanation({ answer, onChanged, giving }: { answer: Explained; onChanged: () => Promise<unknown>; giving: boolean }) {
  const [form, setForm] = useState<'Correct' | 'Also give' | null>(giving ? 'Also give' : null)
  const [error, setError] = useState<string | null>(null)
  // Removing a hand change asks first, on its own line: no browser dialog.
  const [confirming, setConfirming] = useState<string | null>(null)
  const remove = async (role: Explained['roles'][number]) => {
    setError(null)
    try { await act('remove_role', { id: role.hand, updated_at: role.hand_updated_at }); setConfirming(null); await onChanged() } catch (e) { setError(messageOf(e)) }
  }
  const staff = STAFF_BADGE[answer.who?.staff ?? 'none']
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1" data-testid="explain-header">
        <h2 className="text-lg font-semibold text-ink"><RecordLink table="Person" id={answer.person}>{answer.name}</RecordLink></h2>
        <p className="text-sm text-ink-muted" data-testid="explain-subtitle">Person · {staff}{answer.who?.jobs?.length ? ` · ${answer.who.jobs.join(', ')}` : ''}</p>
      </header>
      <HeaderChips header={answer.header} />
      <Answer answer={answer} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div data-testid="explain-fields">
          <FieldGrid groups={[{ fields: [
            { label: 'HR title', value: <span data-testid="hr-title">{answer.hr_titles.join(', ') || 'No current job'}</span> },
            { label: 'Status', value: <StaffBadge who={answer.who} /> },
            { label: 'Today', value: <span data-testid="explain-today">{accessWords(answer.today)}</span> },
            { label: 'With business roles', value: <span data-testid="explain-next">{accessWords(answer.next)}</span> },
            { label: 'What changes', value: <span data-testid="explain-change">{answer.change.kinds.length ? <ChangeFacts change={answer.change} /> : 'Nothing'}</span> },
          ] }]} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {error && <Notice tone="negative">{error}</Notice>}
          <LinkSection heading="Business Roles" count={answer.roles.length} testid="explain-roles"
            actions={<a href={FEATHERBASE_ROLES} className="text-[13px] font-medium text-action hover:underline">All business roles ↗</a>}>
            {answer.roles.map((role, i) => (
              <LinkLine key={`${role.role}-${i}`} testid="explain-role" lead={<TickMark state="locked" label={`${role.name}, held`} />}
                note={<><span data-testid="role-area"><Parts parts={role.area.parts} /></span>{[` · ${reachWords(role.area)}`, role.until ? ` · until ${fmtDate(role.until)}` : '', role.reason ? ` · ${role.reason}` : ''].join('')}</>}
                side={<>
                  {sourceChip(role)}
                  {role.hand && confirming !== role.hand && <button type="button" className="text-[13px] font-medium text-action hover:underline" onClick={() => setConfirming(role.hand)} data-testid="remove-role">Remove</button>}
                </>}
                below={role.hand && confirming === role.hand && (
                  <span className="inline-flex items-center gap-2 text-[13px] text-ink" data-testid="remove-confirm">Remove this?
                    <button type="button" className="font-medium text-negative hover:underline" onClick={() => remove(role)} data-testid="remove-yes">Yes</button>
                    <button type="button" className="font-medium text-action hover:underline" onClick={() => setConfirming(null)} data-testid="remove-keep">Keep</button>
                  </span>
                )}>
                <RecordLink table={ROLE_TABLE} id={role.role}>{role.name}</RecordLink>
              </LinkLine>
            ))}
            {answer.unmapped.map(t => (
              <LinkLine key={t.title} testid="explain-unmapped" lead={<TickMark state="off" label={`HR title ${t.title}, not mapped`} />}
                note={<>Not mapped yet: <a className="font-medium text-action hover:underline" href="/featherbase/admin/table/dash.title_map">map it in the Title Map</a>, or correct this person.</>}>
                <span className="text-ink-muted">HR title “{t.title}”</span>
              </LinkLine>
            ))}
            {answer.roles.length === 0 && answer.unmapped.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-muted">No business role: no current job, merchandise assignment or hand change.</li>}
            <li className="flex flex-wrap gap-3 px-2 pt-2">
              <Button variant="secondary" onClick={() => setForm('Correct')} data-testid="correct-button">Correct</Button>
              <Button variant="secondary" onClick={() => setForm('Also give')} data-testid="also-give-button">Also Give</Button>
            </li>
            {form && <HandForm change={form} person={answer.person} choices={answer.choices} places={answer.places} onDone={async () => { setForm(null); await onChanged() }} onCancel={() => setForm(null)} />}
          </LinkSection>
          <LinkSection heading="Apps They Can Open" count={`${answer.apps.length.toLocaleString('en-IN')} · worked out from their roles`} testid="explain-apps">
            {answer.apps.map(app => (
              <WhyLine key={`${app.app}-${app.level}`} testid="explain-app" name={<span className="font-medium text-ink">{app.app}</span>} note={`at level ${app.level}`}
                via={app.via} chain={`${answer.name} → ${app.via.join(' and ')} → ${app.app} · ${app.level}`} />
            ))}
            {answer.apps.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-muted">No app.</li>}
          </LinkSection>
          <LinkSection heading="Reports They See" count={`${answer.reports.length.toLocaleString('en-IN')} · given to their roles`} testid="explain-reports">
            {answer.reports.map(report => (
              <WhyLine key={report.key} testid="explain-report" name={<RecordLink table="dash.report" id={report.key}>{report.name}</RecordLink>}
                via={viaOf(report.why)} chain={report.why.map(w => `${answer.name} → ${w}`).join('; ')} />
            ))}
            {answer.reports.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-muted">No report.</li>}
          </LinkSection>
          {answer.change.decisions.length > 0 && (
            <LinkSection heading="Needs A Decision" count={answer.change.decisions.length} testid="explain-decisions">
              <li className="px-2 text-[13px] text-ink-muted">They get these today only through a role such as Dash Reader, and business roles don't give them. The owner decides which business roles get them.</li>
              {answer.change.decisions.map(report => (
                <LinkLine key={report.id} testid="explain-decision" lead={<TickMark state="off" label={`${report.name}, not given`} />}>
                  <RecordLink table={report.table ?? 'dash.report'} id={report.id}>{report.name}</RecordLink>
                </LinkLine>
              ))}
            </LinkSection>
          )}
        </div>
      </div>
    </div>
  )
}

/** The roles a report comes through, from its reasons ("Given to Store Manager, for Lakeside"). */
function viaOf(why: string[]): string[] {
  return [...new Set(why.map(w => /^Given to (.+?), for /.exec(w)?.[1] ?? (w.startsWith('Given to them directly') ? 'given directly' : /^Every report, through (.+)$/.exec(w)?.[1] ?? '')).filter(Boolean))]
}

/** A locked line with its via chips and a Why? that opens the one-line chain under it. */
function WhyLine({ name, note, via, chain, testid }: { name: ReactNode; note?: ReactNode; via: string[]; chain: string; testid: string }) {
  const [open, setOpen] = useState(false)
  return (
    <LinkLine testid={testid} lead={<TickMark state="locked" label="Given by a role they hold" />} note={note}
      side={<>
        {via.map(v => <ToneChip key={v}>{v === 'given directly' ? v : `via ${v}`}</ToneChip>)}
        <button type="button" className="text-[13px] font-medium text-action hover:underline" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="why-toggle">{open ? 'Hide why' : 'Why?'}</button>
      </>}
      below={open && <span className="text-ink" data-testid="why-line">{chain}</span>}>
      {name}
    </LinkLine>
  )
}

function HandForm({ change, person, choices, places, onDone, onCancel }: { change: 'Correct' | 'Also give'; person: string; choices: Explained['choices']; places: Explained['places']; onDone: () => Promise<void>; onCancel: () => void }) {
  const [role, setRole] = useState('')
  const [site, setSite] = useState(places.default ?? '')
  // #1282 G1: a store picked on the trees, offered beside the list of stores from then on.
  const [picking, setPicking] = useState(false)
  const [pickedStores, setPickedStores] = useState<{ id: string; name: string }[]>([])
  const stores = [...places.stores, ...pickedStores.filter(p => !places.stores.some(s => s.id === p.id))]
  const [ends, setEnds] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setError(null)
    try { await act('give_role', { person, change, role, site, ends_on: ends || null, reason }); await onDone() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }
  const roleName = choices.find(c => c.id === role)?.name ?? 'the role'
  const siteName = stores.find(s => s.id === site)?.name
  return (
    <li className="mx-2 mt-2 flex flex-col gap-3 rounded-control bg-action-tint p-3" data-testid="hand-form">
      <p className="text-sm" data-testid="hand-sentence">{change === 'Correct' ? 'Correct' : 'Also give'}: treat as <b>{roleName}</b>{siteName ? <> at <b>{siteName}</b></> : ' at the place of their job'}.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Business role" className="min-w-48">
          <Select value={role} onChange={e => setRole(e.target.value)} data-testid="hand-role">
            <option value="">Choose a role</option>
            {choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Place" className="min-w-48">
          <Select value={site} onChange={e => setSite(e.target.value)} data-testid="hand-site">
            <option value="">The place of their job</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Button variant="quiet" onClick={() => setPicking(true)} data-testid="hand-pick-area">Pick on the trees ▸</Button>
        <Field label="Ends on (optional)">
          <TextInput type="date" value={ends} onChange={e => setEnds(e.target.value)} data-testid="hand-ends" />
        </Field>
        <Field label="Reason" className="min-w-56 flex-1">
          <TextInput value={reason} onChange={e => setReason(e.target.value)} placeholder="Why, in a few words" data-testid="hand-reason" />
        </Field>
      </div>
      {picking && (
        <AreaPicker axes={DASH_AREAS} holds={['Site']} load={loadDashArea} onCancel={() => setPicking(false)}
          onUse={(area) => { setPickedStores(was => [...was, { id: area.row.id, name: area.row.name }]); setSite(area.row.id); setPicking(false) }} />
      )}
      {error && <Notice tone="negative">{error}</Notice>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!role} loading={busy} onClick={save} data-testid="hand-save">{change === 'Correct' ? 'Correct' : 'Also Give'}</Button>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </li>
  )
}
