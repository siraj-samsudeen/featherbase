// Your sections and Waiting for your approval (#975), in Shop Floor's components. Each page says
// what to do next when it has nothing to show. The rules are the server's: my-sections.ts.
import { createElement, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, Field, fmtDate, Notice, Select, Skeleton, StatusPill, TextInput, touchLinkClasses, type StatusTone } from '@featherbase/shop-floor'
import { HierarchyGroups, HierarchyPath, HierarchyPicker, type HierarchyLeaf, type HierarchyNode } from '@featherbase/shop-floor/hierarchy'
import { act, read } from './api'
import { reportAddress } from './page'

export type DashView = 'report' | 'sections' | 'approvals' | 'access' | 'unplaced'
export function currentView(search = window.location.search): DashView {
  const view = new URLSearchParams(search).get('view')
  return view === 'sections' || view === 'approvals' || view === 'access' || view === 'unplaced' ? view : 'report'
}
/** The Report access page (#1046), for Report Access Managers and System Managers. */
export const ACCESS_ADDRESS = '?view=access'
export const SECTIONS_ADDRESS = '?view=sections'
export const APPROVALS_ADDRESS = '?view=approvals'
/** The master data team's list of subcategories in no section (#1175). */
export const UNPLACED_ADDRESS = '?view=unplaced'

interface Named { id: string; name: string }
interface Leveled extends HierarchyNode { code: string; name: string }
/** A subcategory in their section; `pending` when they asked for it to go. */
interface Placed extends Leveled { id: string; pending: { id: string; kind: 'removal' | 'move'; to: string | null; waiting_for: string; applied?: boolean } | null }
/** A subcategory they asked to add, waiting for approval; or added at once, waiting for review (#1191). */
interface Addition extends Leveled { id: string; waiting_for: string; applied?: boolean }
/** #1191: whether each kind of change happens at once on this instance. */
interface AtOnce { add: boolean; removal: boolean; section: boolean }
interface SectionChoice extends Named { floor: string | null }
interface Job {
  id: string
  job: string
  store: string
  is_store: boolean
  reports_to: string | null
  waiting_for: string
  section: SectionChoice | null
  /** #1191: a section change made at once, until it is reviewed. */
  section_change?: { id: string; from: string; waiting_for: string } | null
  subcategories: Placed[]
  additions: Addition[]
  other_sections: SectionChoice[]
}
interface Proposal {
  id: string
  kind: 'removal' | 'move' | 'add' | 'section'
  what: string
  from: string
  to: string
  store: string
  state: 'Pending' | 'Applied' | 'Rejected' | 'Needs fresh review' | 'Withdrawn' | 'Not yet reviewed' | 'Confirmed' | 'Undone'
  applied?: boolean
  /** #1191: undone by the person who made it, not by a reviewer. */
  taken_back?: boolean
  waiting_for: string
  reason: string | null
  asked_on: string
  decided_on: string
  who?: string
}
/** Where a subcategory is and who holds it there, as the approver reads it. */
interface Place { section: string; holder: string | null }
interface Approval extends Omit<Proposal, 'from' | 'to'> { who: string; from: Place | null; to: Place | null; path: HierarchyNode | null; sections: Named[] }
type Mine = { state: 'not_set_up' | 'unknown_person' } | { state: 'ok'; name: string; jobs: Job[]; proposals: Proposal[]; waiting_for_me: number; applies_at_once?: AtOnce }
const NOT_AT_ONCE: AtOnce = { add: false, removal: false, section: false }
type Waiting = { state: 'not_set_up' } | { state: 'ok'; proposals: Approval[] }
type Holder = { kind: 'mine' } | { kind: 'none' } | { kind: 'other'; section: string; team_leader: string | null }
interface Choice extends HierarchyLeaf { holder: Holder; asked: boolean; taken_out?: boolean }
interface Levels { start: HierarchyNode | null; levels: HierarchyNode[] }
type Unplaced = { state: 'not_set_up' | 'not_allowed' } | { state: 'ok'; rows: (Leveled & { store: string; was_in: string; since: string })[] }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not go through. Try again.')
const sectionLabel = (section: SectionChoice) => (section.floor ? `${section.name} · ${section.floor}` : section.name)

/** What a proposal asks for, in one plain sentence. */
export function askedFor(proposal: Pick<Proposal, 'kind' | 'what' | 'from' | 'to'>): string {
  const { kind, what, from, to } = proposal
  const nowhere = from === 'No section'
  if (kind === 'removal') return `Take ${what} out of ${from}`
  if (kind === 'section') return nowhere ? `Set your section to ${to}` : `Change section from ${from} to ${to}`
  return nowhere ? `Add ${what} to ${to}` : `Move ${what} from ${from} to ${to}`
}

/** The same, as the approver reads it about someone else. */
export function askedOfApprover(proposal: Pick<Proposal, 'kind' | 'what' | 'from' | 'to'>): string {
  const { kind, from, to } = proposal
  if (kind !== 'section') return askedFor(proposal)
  return from === 'No section' ? `Set their section to ${to}` : `Change their section from ${from} to ${to}`
}

/** The proposal's state, as the pill says it. */
export function outcome(proposal: Pick<Proposal, 'state' | 'waiting_for'>): { tone: StatusTone; label: string } {
  if (proposal.state === 'Applied') return { tone: 'positive', label: 'Approved' }
  if (proposal.state === 'Rejected') return { tone: 'negative', label: 'Rejected' }
  if (proposal.state === 'Needs fresh review') return { tone: 'missing', label: 'Needs asking again' }
  if (proposal.state === 'Withdrawn') return { tone: 'missing', label: 'Withdrawn' }
  if (proposal.state === 'Not yet reviewed') return { tone: 'positive', label: `Done · ${proposal.waiting_for} will review it` }
  if (proposal.state === 'Confirmed') return { tone: 'positive', label: 'Done · confirmed' }
  if (proposal.state === 'Undone') return { tone: 'negative', label: 'Undone' }
  return { tone: 'caution', label: `Waiting for ${proposal.waiting_for}` }
}

const approvalsLabel = (waiting: number) => (waiting === 1 ? '1 change is waiting for your approval' : `${waiting} changes are waiting for your approval`)

/** The app's navigation. The approvals row appears only when something waits for this person.
 *  A page that already knows the count passes it, so the row follows what the page shows. */
/** One report the reader may open, as the `reports` read answers it. */
export interface ReportLink { key: string; name: string; takes_store: boolean; takes_month: boolean; no_filter?: boolean
  /** #1159: the Dive has its own Store and Month pickers: the page passes it the address's store and month. */
  pickers_in_dive?: boolean }
export const readReports = () => read<ReportLink[]>('reports')

export function DashSidebar({ current, count }: { current: DashView; count?: number }) {
  const [reports, setReports] = useState<ReportLink[]>([])
  useEffect(() => { let live = true; readReports().then(list => { if (live) setReports(list) }, () => {}); return () => { live = false } }, [])
  const named = new URLSearchParams(window.location.search).get('report')
  const shown = current === 'report' ? (named ?? reports[0]?.key) : null
  const [fromRead, setWaiting] = useState(0)
  const waiting = count ?? fromRead
  useEffect(() => {
    if (count !== undefined) return
    let live = true
    read<Waiting>('approvals').then(answer => { if (live && answer.state === 'ok') setWaiting(answer.proposals.length) }, () => {})
    return () => { live = false }
  }, [count])
  // #1046: the Report access link shows only to someone who manages it.
  const [manages, setManages] = useState(false)
  useEffect(() => { let live = true; read<boolean>('manages_access').then(answer => { if (live) setManages(answer === true) }, () => {}); return () => { live = false } }, [])
  // #1175: the master data team's list, to whoever holds Master Data Editor.
  const [masterData, setMasterData] = useState(false)
  useEffect(() => { let live = true; read<boolean>('holds_master_data').then(answer => { if (live) setMasterData(answer === true) }, () => {}); return () => { live = false } }, [])
  const here = (view: DashView) => (current === view ? { 'aria-current': 'page' as const } : {})
  return createElement('featherbase-sidebar', { 'aria-label': 'Dash navigation' },
    reports.length > 0 && <span className="fd-sidebar-group" data-testid="reports-group">Reports</span>,
    ...reports.map(report => (
      <a key={report.key} href={reportAddress(report.key, window.location.search)} data-testid="report-link" {...(shown === report.key ? { 'aria-current': 'page' as const } : {})}>
        <svg className="max-sm:hidden" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 14v3m5-8v8m5-12v12" /></svg>
        <span>{report.name}</span>
      </a>
    )),
    <a href={SECTIONS_ADDRESS} {...here('sections')}>
      <svg className="max-sm:hidden" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
      <span>Your sections</span>
    </a>,
    (waiting > 0 || current === 'approvals') && (
      <a href={APPROVALS_ADDRESS} {...here('approvals')} data-testid="approvals-link">
        <svg className="max-sm:hidden" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>
        <span className="max-sm:hidden">Waiting for you{waiting > 0 ? ` (${waiting})` : ''}</span>
        <span className="sm:hidden">To do{waiting > 0 ? ` (${waiting})` : ''}</span>
      </a>
    ),
    (masterData || current === 'unplaced') && (
      <a href={UNPLACED_ADDRESS} {...here('unplaced')} data-testid="unplaced-link">
        <svg className="max-sm:hidden" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" /></svg>
        <span>Not in any section</span>
      </a>
    ),
    (manages || current === 'access') && (
      <a href={ACCESS_ADDRESS} {...here('access')} data-testid="access-link">
        <svg className="max-sm:hidden" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg>
        <span>Report access</span>
      </a>
    ))
}

function Shell({ current, count, title, testid, children }: { current: DashView; count?: number; title: string; testid: string; children: ReactNode }) {
  return (
    <div className="fd-shell">
      <DashSidebar current={current} count={count} />
      <main className="fd-page" data-testid={testid}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <h1 className="fd-title">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  )
}

/** Loads one read, with Try again when it fails. */
function useAnswer<T>(name: string) {
  const [answer, setAnswer] = useState<T | undefined>()
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => {
    setFailed(false)
    return read<T>(name).then(setAnswer, () => setFailed(true))
  }, [name])
  useEffect(() => { void load() }, [load])
  return { answer, failed, load }
}

const Loading = () => <div className="flex flex-col gap-3" data-testid="loading"><Skeleton label="Opening your sections" lines={6} /></div>
const LoadFailed = ({ onRetry }: { onRetry: () => void }) => (
  <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." action={<Button onClick={onRetry}>Try again</Button>} /></Card>
)
const NotSetUp = () => (
  <Card data-testid="not-set-up">
    <EmptyState title="This isn't set up here yet" body="Tell an administrator that Dash's linked Tables setting needs the store and staff Tables." />
  </Card>
)

export function YourSections() {
  const { answer, failed, load } = useAnswer<Mine>('my_sections')
  return (
    <Shell current="sections" count={answer?.state === 'ok' ? answer.waiting_for_me : undefined} title="Your sections" testid="your-sections">
      {!answer && !failed && <Loading />}
      {failed && <LoadFailed onRetry={load} />}
      {answer?.state === 'not_set_up' && <NotSetUp />}
      {answer?.state === 'unknown_person' && (
        <Card data-testid="unknown-person">
          <EmptyState title="We can't find you on the staff list yet" body="Ask your manager to check that HR has you on the list. Once you are on it, your sections show here." />
        </Card>
      )}
      {answer?.state === 'ok' && (
        <>
          <p className="fd-muted" data-testid="person-name">{answer.name}. {Object.values(answer.applies_at_once ?? NOT_AT_ONCE).every(Boolean)
            ? 'If something here is wrong, change it. It changes at once, and your manager reviews it afterwards.'
            : 'If something here is wrong, say so. Nothing changes until it is approved.'}</p>
          {answer.waiting_for_me > 0 && (
            <Notice tone="caution"><a href={APPROVALS_ADDRESS} className={touchLinkClasses('pointer-coarse:-my-3')} data-testid="approvals-notice">{approvalsLabel(answer.waiting_for_me)}</a></Notice>
          )}
          {answer.jobs.length === 0 && (
            <Card data-testid="no-job"><EmptyState title="You have no current job on the staff list" body="Ask your manager to check it with HR." /></Card>
          )}
          {/* Keyed by the job, not its row: a section change replaces the row, and the card keeps its note. */}
          {answer.jobs.map((job, index) => <JobCard key={`${job.job}|${job.store}|${index}`} job={job} atOnce={answer.applies_at_once ?? NOT_AT_ONCE} onSent={load} />)}
          {answer.proposals.length > 0 && <YourProposals proposals={answer.proposals} />}
        </>
      )}
    </Shell>
  )
}

function JobCard({ job, atOnce, onSent }: { job: Job; atOnce: AtOnce; onSent: () => Promise<unknown> }) {
  // One form open at a time on a job, so a phone never holds two.
  const [open, setOpen] = useState<'section' | 'add' | null>(null)
  const [note, setNote] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const close = () => setOpen(null)
  const sent = async (text = `Sent to ${job.waiting_for}. Nothing changes until it is approved.`) => { close(); setNote({ tone: 'positive', text }); await onSent() }
  const start = (next: NonNullable<typeof open>) => { setNote(null); setOpen(next) }
  /** One click, one request: Not mine and Undo need nothing more from the person. */
  async function run(key: string, action: string, payload: Record<string, unknown>, done: string) {
    setBusy(key)
    setNote(null)
    try { await act(action, payload); await sent(done) }
    catch (failure) { setNote({ tone: 'negative', text: messageOf(failure) }); await onSent() }
    finally { setBusy(null) }
  }
  const rows: ({ placed: Placed } | { added: Addition })[] = [...job.subcategories.map(placed => ({ placed })), ...job.additions.map(added => ({ added }))]
  const pathOf = (row: (typeof rows)[number]) => ('placed' in row ? row.placed : row.added)
  return (
    <Card data-testid="job-card" title={`${job.job} · ${job.store}`}>
      <div className="flex flex-col gap-3 p-4">
        <p className="fd-muted" data-testid="reports-to">{job.reports_to ? `You report to ${job.reports_to}` : 'No manager is set against this job'}</p>
        {note && <Notice tone={note.tone}><span data-testid={note.tone === 'positive' ? 'sent-note' : 'refused-note'}>{note.text}</span></Notice>}
        {job.section ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold" data-testid="section-name">{sectionLabel(job.section)}</p>
            {job.other_sections.length > 0 && <Button variant="quiet" className="-mx-3 max-sm:-mx-4" onClick={() => start('section')}>My section is wrong</Button>}
          </div>
        ) : job.other_sections.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="no-section">
            <p>No section is set against your job.</p>
            <Button variant="quiet" className="-mx-3 max-sm:-mx-4" onClick={() => start('section')}>Say which section is yours</Button>
          </div>
        ) : (
          <p data-testid="store-no-sections">
            {!job.is_store ? 'This job is not in a store, so it has no sections.'
              : `This store has no sections set up yet. Tell ${job.reports_to ? 'your manager' : 'the master data team'}, so they can be set up.`}
          </p>
        )}
        {job.section_change && (
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="section-change">
            <span className="text-sm text-ink-muted">Changed from {job.section_change.from} · {job.section_change.waiting_for} will review it</span>
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill tone="neutral" className="max-w-full whitespace-normal!">Changed · not yet reviewed</StatusPill>
              <Button variant="quiet" className="-mx-3 max-sm:-mx-4" loading={busy === job.section_change.id} disabled={busy !== null}
                onClick={() => run(job.section_change!.id, 'withdraw', { proposal: job.section_change!.id }, `Undone: your section is ${job.section_change!.from} again.`)}>Undo</Button>
            </span>
          </div>
        )}
        {open === 'section' && <PickSection job={job} atOnce={atOnce.section} action="propose_section" label="Your correct section" payload={{}} onCancel={close}
          onSent={() => sent(atOnce.section ? `Done: your section is changed. ${job.waiting_for} will review it.` : undefined)} onRefused={onSent} />}
        {job.section && (
          <>
            {rows.length === 0 && <p className="fd-muted" data-testid="no-subcategories">No subcategories are set against this section yet.</p>}
            {rows.length > 0 && (
              <HierarchyGroups items={rows} pathOf={pathOf}>
                {group => (
                  <ul className="flex flex-col divide-y divide-border" data-testid="subcategories">
                    {group.map(row => 'placed' in row
                      ? <PlacedRow key={row.placed.id} placed={row.placed} busy={busy}
                          onNotMine={() => run(row.placed.id, 'propose_removal', { job: job.id, placement: row.placed.id }, atOnce.removal
                            ? `Done: ${row.placed.name} is out of your section. ${job.waiting_for} will review it.`
                            : `Asked to take ${row.placed.name} out of your section. It waits for ${job.waiting_for}.`)}
                          onUndo={id => run(id, 'withdraw', { proposal: id }, row.placed.pending?.applied ? `Undone: ${row.placed.name} is back in your section.` : `Undone: ${row.placed.name} stays in your section.`)} />
                      : <AddedRow key={row.added.id} added={row.added} busy={busy}
                          onUndo={id => run(id, 'withdraw', { proposal: id }, row.added.applied ? `Undone: ${row.added.name} is out of your section again.` : `Undone: ${row.added.name} is not asked for.`)} />)}
                  </ul>
                )}
              </HierarchyGroups>
            )}
            <div><Button onClick={() => start('add')}>Add subcategories</Button></div>
            {open === 'add' && <AddSubcategories job={job} atOnce={atOnce.add} onCancel={close} onRefused={onSent}
              onSent={count => sent(atOnce.add ? `Added ${count === 1 ? '1 subcategory' : `${count} subcategories`}. ${job.waiting_for} will review ${count === 1 ? 'it' : 'them'}.`
                : `Asked to add ${count === 1 ? '1 subcategory' : `${count} subcategories`}. Nothing changes until it is approved.`)} />}
          </>
        )}
      </div>
    </Card>
  )
}

const waitingLine = (waiting: string) => <span className="block text-sm text-ink-muted">Waiting for {waiting}</span>

function PlacedRow({ placed, busy, onNotMine, onUndo }: { placed: Placed; busy: string | null; onNotMine: () => void; onUndo: (id: string) => void }) {
  const asked = placed.pending
  return (
    <li className="flex min-h-control flex-wrap items-center justify-between gap-2 py-1" data-testid="subcategory">
      <span className="min-w-0 break-words">
        <span className={asked ? 'text-ink-muted line-through' : undefined} data-testid="subcategory-name">{placed.name}</span>
        {asked && (asked.applied ? <span className="block text-sm text-ink-muted">Taken out of your section · {asked.waiting_for} will review it</span> : waitingLine(asked.waiting_for))}
      </span>
      {asked ? (
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill tone={asked.applied ? 'neutral' : 'caution'} className="max-w-full whitespace-normal!">{asked.applied ? 'Taken out · not yet reviewed'
            : asked.kind === 'move' && asked.to ? `Move to ${asked.to} waiting for approval` : 'Removal waiting for approval'}</StatusPill>
          <Button variant="quiet" className="-mx-3 max-sm:-mx-4" loading={busy === asked.id} disabled={busy !== null} onClick={() => onUndo(asked.id)}>Undo</Button>
        </span>
      ) : <Button variant="quiet" className="-mx-3 max-sm:-mx-4" loading={busy === placed.id} disabled={busy !== null} onClick={onNotMine}>Not mine</Button>}
    </li>
  )
}

function AddedRow({ added, busy, onUndo }: { added: Addition; busy: string | null; onUndo: (id: string) => void }) {
  return (
    <li className="flex min-h-control flex-wrap items-center justify-between gap-2 py-1" data-testid="addition">
      <span className="min-w-0 break-words">
        <span data-testid="subcategory-name"><span aria-hidden="true">+ </span>{added.name}</span>
        {added.applied ? <span className="block text-sm text-ink-muted">Added to your section · {added.waiting_for} will review it</span> : waitingLine(added.waiting_for)}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <StatusPill tone={added.applied ? 'neutral' : 'caution'} className="max-w-full whitespace-normal!">{added.applied ? 'Added · not yet reviewed' : 'Addition waiting for approval'}</StatusPill>
        <Button variant="quiet" className="-mx-3 max-sm:-mx-4" loading={busy === added.id} disabled={busy !== null} onClick={() => onUndo(added.id)}>Undo</Button>
      </span>
    </li>
  )
}

/** Picks another section in the same store, and sends the proposal. */
function PickSection({ job, atOnce, action, label, payload, onCancel, onSent, onRefused }: {
  job: Job; atOnce: boolean; action: string; label: string; payload: Record<string, unknown>; onCancel: () => void; onSent: () => Promise<void>; onRefused: () => Promise<unknown>
}) {
  const [section, setSection] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function send() {
    if (!section) return setError('Pick a section')
    setBusy(true)
    setError(null)
    try {
      await act(action, { job: job.id, to_section: section, ...payload })
      await onSent()
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
      // The page behind the form may be out of date: that is often why it was refused.
      await onRefused()
    }
  }
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-control border border-border bg-subtle p-3" data-testid="pick-section">
      <Field label={label} error={error} hint={atOnce ? `This changes at once. ${job.waiting_for} reviews it afterwards.` : `This goes to ${job.waiting_for} to approve.`}>
        <Select value={section} onChange={event => setSection(event.target.value)}>
          <option value="">Choose a section</option>
          {job.other_sections.map(choice => <option key={choice.id} value={choice.id}>{sectionLabel(choice)}</option>)}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy} onClick={send}>{atOnce ? 'Change it' : 'Send for approval'}</Button>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  )
}

/** Where a subcategory is now, in a few words. */
export function holderLine(choice: Pick<Choice, 'holder' | 'asked' | 'taken_out'>): string {
  if (choice.asked) return 'Already asked for'
  if (choice.taken_out) return 'You took this out · use Undo to put it back'
  if (choice.holder.kind === 'mine') return 'Already yours'
  if (choice.holder.kind === 'none') return 'Not in any section'
  return `Now in ${choice.holder.section}${choice.holder.team_leader ? ` · ${choice.holder.team_leader}` : ''}`
}

/** Browses the hierarchy from their own division, and asks to add what they tick. */
function AddSubcategories({ job, atOnce, onCancel, onSent, onRefused }: { job: Job; atOnce: boolean; onCancel: () => void; onSent: (count: number) => Promise<void>; onRefused: () => Promise<unknown> }) {
  const [levels, setLevels] = useState<Levels | null>(null)
  const [chosen, setChosen] = useState<Choice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    read<Levels>('subcategory_levels', { job: job.id }).then(answer => { if (live) setLevels(answer) }, failure => { if (live) setError(messageOf(failure)) })
    return () => { live = false }
  }, [job.id])
  const loadLeaves = useCallback((node: HierarchyNode) => read<Omit<Choice, 'disabled'>[]>('category_subcategories', { job: job.id, ...node })
    .then(rows => rows.map(row => ({ ...row, disabled: row.asked || row.taken_out === true || row.holder.kind === 'mine' }))), [job.id])
  async function send() {
    setBusy(true)
    setError(null)
    try {
      await act('propose_adds', { job: job.id, subcategories: chosen.map(choice => choice.code) })
      await onSent(chosen.length)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
      await onRefused()
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-control border border-border bg-subtle p-3" data-testid="add-subcategories">
      <p className="text-sm text-ink-muted">Tick the subcategories that belong in {job.section?.name ?? 'your section'}. {atOnce
        ? `Ticked subcategories are added at once. ${job.waiting_for} reviews them afterwards.` : `Adding goes to ${job.waiting_for} to approve.`}</p>
      {error && <Notice tone="negative"><span data-testid="add-error">{error}</span></Notice>}
      {!levels && !error && <Skeleton label="Opening the subcategories" lines={3} />}
      {levels && <HierarchyPicker label="Subcategories to add" levels={levels.levels} start={levels.start} loadLeaves={loadLeaves}
        selected={chosen} onChange={setChosen} annotate={holderLine} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy} disabled={!chosen.length} onClick={send}>{atOnce ? (chosen.length ? `Add ${chosen.length}` : 'Add') : chosen.length ? `Ask to add ${chosen.length}` : 'Ask to add'}</Button>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  )
}

function YourProposals({ proposals }: { proposals: Proposal[] }) {
  return (
    <Card title="What you have asked for" data-testid="your-proposals">
      <ul className="flex flex-col divide-y divide-border px-4 py-1">
        {proposals.map(proposal => {
          const { tone, label } = outcome(proposal)
          return (
            <li key={proposal.id} className="flex flex-col gap-1 py-3" data-testid="your-proposal">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">{askedFor(proposal)}</span>
                <StatusPill tone={tone} className="max-w-full whitespace-normal!">{label}</StatusPill>
              </div>
              <p className="text-sm text-ink-muted">Asked on {fmtDate(proposal.asked_on)}{proposal.decided_on ? ` · ${proposal.state === 'Withdrawn' ? 'Withdrawn' : proposal.taken_back ? 'Taken back' : proposal.state === 'Confirmed' || proposal.state === 'Undone' ? 'Reviewed' : 'Decided'} on ${fmtDate(proposal.decided_on)}` : ''}</p>
              {proposal.reason && <p className="text-sm" data-testid="proposal-reason">{proposal.reason}</p>}
              {proposal.state === 'Needs fresh review' && <p className="text-sm text-ink-muted">Things changed after you asked, so nothing was done. If it is still wrong, ask again.</p>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export function Approvals() {
  const { answer, failed, load } = useAnswer<Waiting>('approvals')
  // What just happened stays said after the card has gone from the list.
  const [note, setNote] = useState<{ tone: 'positive' | 'negative' | 'caution'; text: string } | null>(null)
  const after = (next: NonNullable<typeof note>) => { setNote(next); return load() }
  return (
    <Shell current="approvals" count={answer?.state === 'ok' ? answer.proposals.length : undefined} title="Waiting for you" testid="approvals">
      {note && <Notice tone={note.tone}><span data-testid="decision-note">{note.text}</span></Notice>}
      {!answer && !failed && <Loading />}
      {failed && <LoadFailed onRetry={load} />}
      {answer?.state === 'not_set_up' && <NotSetUp />}
      {answer?.state === 'ok' && answer.proposals.length === 0 && (
        <Card data-testid="nothing-waiting">
          <EmptyState title="Nothing is waiting for you" body="When someone changes their sections, or asks to, and it needs you, it shows here." />
        </Card>
      )}
      {answer?.state === 'ok' && <ApprovalGroups proposals={answer.proposals} onDone={after} />}
    </Shell>
  )
}

/** #1191: what is already done, to confirm or undo, apart from what waits for approval. */
function ApprovalGroups({ proposals, onDone }: { proposals: Approval[]; onDone: (note: { tone: 'positive' | 'negative' | 'caution'; text: string }) => Promise<unknown> }) {
  const done = proposals.filter(proposal => proposal.applied)
  const waiting = proposals.filter(proposal => !proposal.applied)
  return (
    <>
      {done.length > 0 && <h2 className="font-semibold" data-testid="to-review-heading">Already done · check and confirm, or undo</h2>}
      {done.map(proposal => <ApprovalCard key={proposal.id} proposal={proposal} onDone={onDone} />)}
      {done.length > 0 && waiting.length > 0 && <h2 className="font-semibold" data-testid="to-approve-heading">Waiting for your approval · nothing changes until you approve</h2>}
      {waiting.map(proposal => <ApprovalCard key={proposal.id} proposal={proposal} onDone={onDone} />)}
    </>
  )
}

/** One end of a move: the section, and who holds it. */
function PlaceLine({ label, place }: { label: string; place: Place }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="font-semibold break-words">{place.section}</p>
      <p className="text-sm break-words">{place.holder ?? 'No Team Leader'}</p>
    </div>
  )
}

/** What the approver is asked, in one line. */
export function approvalTitle(proposal: Pick<Approval, 'kind' | 'what' | 'from' | 'to'>): string {
  if (proposal.kind === 'move') return `Move ${proposal.what}`
  if (proposal.kind === 'removal') return `Take ${proposal.what} out of ${proposal.from?.section}`
  if (proposal.kind === 'add') return `Add ${proposal.what} to ${proposal.to?.section}`
  return askedOfApprover({ kind: 'section', what: proposal.what, from: proposal.from?.section ?? 'No section', to: proposal.to?.section ?? '' })
}

function ApprovalCard({ proposal, onDone }: { proposal: Approval; onDone: (note: { tone: 'positive' | 'negative' | 'caution'; text: string }) => Promise<unknown> }) {
  const [mode, setMode] = useState<'decide' | 'reject' | 'elsewhere'>('decide')
  const [reason, setReason] = useState('')
  const [elsewhere, setElsewhere] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'reject' | 'elsewhere' | 'confirm' | null>(null)
  const applied = proposal.applied === true
  const isMove = proposal.kind === 'move'
  const title = approvalTitle(proposal)
  async function decide(decision: 'approve' | 'reject' | 'elsewhere' | 'confirm') {
    if (decision === 'reject' && !reason.trim()) return setFormError('Say why, so they know what to do next')
    if (decision === 'elsewhere' && !elsewhere) return setFormError('Pick a section')
    setBusy(decision)
    setFormError(null)
    const to = proposal.sections.find(section => section.id === elsewhere)?.name
    try {
      // An applied change is confirmed or undone; Reject's form is Undo's for it.
      const sent = applied ? (decision === 'reject' ? 'undo' : 'confirm') : decision === 'reject' ? 'reject' : 'approve'
      const after = await act<Proposal>('decide', { proposal: proposal.id, decision: sent,
        ...(decision === 'reject' ? { reason: reason.trim() } : {}), ...(decision === 'elsewhere' ? { to_section: elsewhere } : {}) })
      await onDone(after.state === 'Confirmed' ? { tone: 'positive', text: `Confirmed: ${title}.` }
        : after.state === 'Undone' ? { tone: 'positive', text: `Undone: ${title}. ${proposal.who} can see your reason.` }
        : after.state === 'Needs fresh review'
        ? { tone: 'caution', text: `Things changed after ${proposal.who} asked, so nothing was done. They can ask again.` }
        : after.state === 'Rejected' ? { tone: 'positive', text: `Rejected. ${proposal.who} can see your reason.` }
        : decision === 'elsewhere' ? { tone: 'positive', text: `Approved: ${proposal.what} is now in ${to}.` }
        : { tone: 'positive', text: `Approved: ${title}.` })
    } catch (failure) {
      // Decided elsewhere, or no longer theirs: the list as it is now, with the reason.
      await onDone({ tone: 'caution', text: `${proposal.who}: ${title}. ${messageOf(failure).replace(/\.?$/, '.')}` })
      // Still listed when the refusal left it waiting, as an undo that can't go back: free to try again.
      setBusy(null)
    }
  }
  const cancel = () => { setMode('decide'); setFormError(null) }
  return (
    <Card data-testid="approval">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <p className="font-semibold" data-testid="approval-who">{proposal.who} · {proposal.store}</p>
          <p data-testid="approval-what">{title}</p>
          {proposal.path && <HierarchyPath path={proposal.path} />}
          <p className="text-sm text-ink-muted">{applied ? `Done on ${fmtDate(proposal.asked_on)} · not yet reviewed` : `Asked on ${fmtDate(proposal.asked_on)}`}</p>
        </div>
        {isMove && proposal.from && proposal.to && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-control border border-border bg-subtle p-3" data-testid="approval-move">
            <PlaceLine label="From" place={proposal.from} />
            <span aria-hidden="true" className="text-ink-muted">→</span>
            <PlaceLine label="To" place={proposal.to} />
          </div>
        )}
        {proposal.kind === 'removal' && <p className="text-sm" data-testid="approval-removal">{applied
          ? `It is in no section at ${proposal.store} now. If you undo it, it goes back to ${proposal.from?.section}.`
          : `If you approve, it will be in no section at ${proposal.store} until someone adds it. The master data team sees it on their list.`}</p>}
        {mode === 'reject' && (
          <div className="flex flex-col gap-3">
            <Field label={applied ? 'Why are you undoing this?' : 'Why are you rejecting this?'} error={formError}
              hint={applied ? `It goes back to how it was before ${proposal.who} changed it. ${proposal.who} sees your reason.` : undefined}>
              <TextInput value={reason} onChange={event => setReason(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" loading={busy === 'reject'} onClick={() => decide('reject')}>{applied ? 'Undo it' : 'Reject'}</Button>
              <Button disabled={busy !== null} onClick={cancel}>Cancel</Button>
            </div>
          </div>
        )}
        {mode === 'elsewhere' && (
          <div className="flex flex-col gap-3">
            <Field label={`Which section should ${proposal.what} go to?`} error={formError}>
              <Select value={elsewhere} onChange={event => setElsewhere(event.target.value)}>
                <option value="">Choose a section</option>
                {proposal.sections.filter(section => section.name !== proposal.from?.section && section.name !== proposal.to?.section).map(section => <option key={section.id} value={section.id}>{section.name}</option>)}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy === 'elsewhere'} onClick={() => decide('elsewhere')}>Move it there</Button>
              <Button disabled={busy !== null} onClick={cancel}>Cancel</Button>
            </div>
          </div>
        )}
        {mode === 'decide' && applied && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === 'confirm'} onClick={() => decide('confirm')}>Confirm</Button>
            <Button variant="danger" disabled={busy !== null} onClick={() => setMode('reject')}>Undo…</Button>
          </div>
        )}
        {mode === 'decide' && !applied && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === 'approve'} onClick={() => decide('approve')}>{isMove ? 'Approve move' : 'Approve'}</Button>
            {isMove && <Button disabled={busy !== null} onClick={() => setMode('elsewhere')}>Move it elsewhere…</Button>}
            <Button variant="danger" disabled={busy !== null} onClick={() => setMode('reject')}>Reject</Button>
          </div>
        )}
      </div>
    </Card>
  )
}

/** The master data team's list: subcategories taken out of a section and in none there now (#1175). */
export function Unplaced() {
  const { answer, failed, load } = useAnswer<Unplaced>('unplaced')
  return (
    <Shell current="unplaced" title="Not in any section" testid="unplaced">
      {!answer && !failed && <Loading />}
      {failed && <LoadFailed onRetry={load} />}
      {answer?.state === 'not_set_up' && <NotSetUp />}
      {answer?.state === 'not_allowed' && (
        <Card data-testid="not-allowed"><EmptyState title="This list is for the master data team" body="Ask an administrator if you need it." /></Card>
      )}
      {answer?.state === 'ok' && answer.rows.length === 0 && (
        <Card data-testid="nothing-unplaced"><EmptyState title="Every subcategory is in a section" body="When a removal is approved, the subcategory shows here until someone adds it to a section." /></Card>
      )}
      {answer?.state === 'ok' && answer.rows.length > 0 && (
        <>
          <p className="fd-muted">Each of these was taken out of a section and is in none at that store now. It leaves this list once someone adds it to a section.</p>
          {[...new Set(answer.rows.map(row => row.store))].map(store => (
            <Card key={store} title={store} data-testid="unplaced-store">
              <div className="p-4">
                <HierarchyGroups items={answer.rows.filter(row => row.store === store)} pathOf={row => row}>
                  {rows => (
                    <ul className="flex flex-col divide-y divide-border">
                      {rows.map(row => (
                        <li key={row.code} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="unplaced-row">
                          <span className="min-w-0 break-words">{row.name}</span>
                          <span className="text-sm text-ink-muted">Out of {row.was_in} since {fmtDate(row.since)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </HierarchyGroups>
              </div>
            </Card>
          ))}
        </>
      )}
    </Shell>
  )
}
