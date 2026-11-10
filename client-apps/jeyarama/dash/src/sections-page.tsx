// Your sections and Waiting for your approval (#975), in Shop Floor's components. Each page says
// what to do next when it has nothing to show. The rules are the server's: my-sections.ts.
import { createElement, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, Field, fmtDate, Notice, SearchInput, Select, Skeleton, StatusPill, TextInput, touchLinkClasses, type StatusTone } from '@featherbase/shop-floor'
import { act, read } from './api'
import { reportAddress } from './page'

export type DashView = 'report' | 'sections' | 'approvals' | 'access'
export function currentView(search = window.location.search): DashView {
  const view = new URLSearchParams(search).get('view')
  return view === 'sections' || view === 'approvals' || view === 'access' ? view : 'report'
}
/** The Report access page (#1046), for Report Access Managers and System Managers. */
export const ACCESS_ADDRESS = '?view=access'
export const SECTIONS_ADDRESS = '?view=sections'
export const APPROVALS_ADDRESS = '?view=approvals'

interface Named { id: string; name: string }
interface Placed extends Named { waiting_for: string | null }
interface SectionChoice extends Named { floor: string | null }
interface Job {
  id: string
  job: string
  store: string
  is_store: boolean
  reports_to: string | null
  waiting_for: string
  section: SectionChoice | null
  subcategories: Placed[]
  other_sections: SectionChoice[]
}
interface Proposal {
  id: string
  kind: 'move' | 'add' | 'section'
  what: string
  from: string
  to: string
  store: string
  state: 'Pending' | 'Applied' | 'Rejected' | 'Needs fresh review'
  waiting_for: string
  reason: string | null
  asked_on: string
  decided_on: string
  who?: string
}
type Mine = { state: 'not_set_up' | 'unknown_person' } | { state: 'ok'; name: string; jobs: Job[]; proposals: Proposal[]; waiting_for_me: number }
type Waiting = { state: 'not_set_up' } | { state: 'ok'; proposals: Proposal[] }
interface Found { code: string; name: string; now_in: string | null; asked: boolean }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not go through. Try again.')
const sectionLabel = (section: SectionChoice) => (section.floor ? `${section.name} · ${section.floor}` : section.name)

/** What a proposal asks for, in one plain sentence. */
export function askedFor(proposal: Pick<Proposal, 'kind' | 'what' | 'from' | 'to'>): string {
  const { kind, what, from, to } = proposal
  const nowhere = from === 'No section'
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
        <span className="max-sm:hidden">Waiting for your approval{waiting > 0 ? ` (${waiting})` : ''}</span>
        <span className="sm:hidden">Approve{waiting > 0 ? ` (${waiting})` : ''}</span>
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
          <p className="fd-muted" data-testid="person-name">{answer.name}. If something here is wrong, say so. Nothing changes until it is approved.</p>
          {answer.waiting_for_me > 0 && (
            <Notice tone="caution"><a href={APPROVALS_ADDRESS} className={touchLinkClasses('pointer-coarse:-my-3')} data-testid="approvals-notice">{approvalsLabel(answer.waiting_for_me)}</a></Notice>
          )}
          {answer.jobs.length === 0 && (
            <Card data-testid="no-job"><EmptyState title="You have no current job on the staff list" body="Ask your manager to check it with HR." /></Card>
          )}
          {answer.jobs.map(job => <JobCard key={job.id} job={job} onSent={load} />)}
          {answer.proposals.length > 0 && <YourProposals proposals={answer.proposals} />}
        </>
      )}
    </Shell>
  )
}

function JobCard({ job, onSent }: { job: Job; onSent: () => Promise<unknown> }) {
  // One correction open at a time on a job, so a phone never holds two forms.
  const [open, setOpen] = useState<{ kind: 'section' | 'missing' } | { kind: 'move'; subcategory: Named } | null>(null)
  const [sentNote, setSentNote] = useState(false)
  const close = () => setOpen(null)
  const sent = async () => { close(); setSentNote(true); await onSent() }
  const start = (next: NonNullable<typeof open>) => { setSentNote(false); setOpen(next) }
  return (
    <Card data-testid="job-card" title={`${job.job} · ${job.store}`}>
      <div className="flex flex-col gap-3 p-4">
        <p className="fd-muted" data-testid="reports-to">{job.reports_to ? `You report to ${job.reports_to}` : 'No manager is set against this job'}</p>
        {sentNote && <Notice tone="positive"><span data-testid="sent-note">Sent to {job.waiting_for}. Nothing changes until it is approved.</span></Notice>}
        {job.section ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold" data-testid="section-name">{sectionLabel(job.section)}</p>
            {job.other_sections.length > 0 && <Button variant="quiet" className="-mx-3 max-sm:-mx-4" onClick={() => start({ kind: 'section' })}>My section is wrong</Button>}
          </div>
        ) : job.other_sections.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="no-section">
            <p>No section is set against your job.</p>
            <Button variant="quiet" className="-mx-3 max-sm:-mx-4" onClick={() => start({ kind: 'section' })}>Say which section is yours</Button>
          </div>
        ) : (
          <p data-testid="store-no-sections">
            {!job.is_store ? 'This job is not in a store, so it has no sections.'
              : `This store has no sections set up yet. Tell ${job.reports_to ? 'your manager' : 'the master data team'}, so they can be set up.`}
          </p>
        )}
        {open?.kind === 'section' && <PickSection job={job} action="propose_section" label="Your correct section" payload={{}} onCancel={close} onSent={sent} onRefused={onSent} />}
        {job.section && (
          <>
            {job.subcategories.length === 0 && <p className="fd-muted" data-testid="no-subcategories">No subcategories are set against this section yet.</p>}
            {job.subcategories.length > 0 && (
              <ul className="flex flex-col divide-y divide-border" data-testid="subcategories">
                {job.subcategories.map(subcategory => (
                  <li key={subcategory.id} className="py-1">
                    <div className="flex min-h-control flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 break-words">{subcategory.name}</span>
                      {subcategory.waiting_for
                        ? <StatusPill tone="caution" className="max-w-full whitespace-normal!">Waiting for {subcategory.waiting_for}</StatusPill>
                        : job.other_sections.length > 0 && <Button variant="quiet" className="-mx-3 max-sm:-mx-4" onClick={() => start({ kind: 'move', subcategory })}>Not in my section</Button>}
                    </div>
                    {open?.kind === 'move' && open.subcategory.id === subcategory.id && (
                      <PickSection job={job} action="propose_move" label={`Which section is ${subcategory.name} in?`} payload={{ placement: subcategory.id }} onCancel={close} onSent={sent} onRefused={onSent} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div><Button onClick={() => start({ kind: 'missing' })}>A subcategory is missing</Button></div>
            {open?.kind === 'missing' && <FindSubcategory job={job} onCancel={close} onSent={sent} onRefused={onSent} />}
          </>
        )}
      </div>
    </Card>
  )
}

/** Picks another section in the same store, and sends the proposal. */
function PickSection({ job, action, label, payload, onCancel, onSent, onRefused }: {
  job: Job; action: string; label: string; payload: Record<string, unknown>; onCancel: () => void; onSent: () => Promise<void>; onRefused: () => Promise<unknown>
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
      <Field label={label} error={error} hint={`This goes to ${job.waiting_for} to approve.`}>
        <Select value={section} onChange={event => setSection(event.target.value)}>
          <option value="">Choose a section</option>
          {job.other_sections.map(choice => <option key={choice.id} value={choice.id}>{sectionLabel(choice)}</option>)}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy} onClick={send}>Send for approval</Button>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  )
}

/** Searches this store's subcategories, and sends a proposal to add one. */
function FindSubcategory({ job, onCancel, onSent, onRefused }: { job: Job; onCancel: () => void; onSent: () => Promise<void>; onRefused: () => Promise<unknown> }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const typed = query.trim()
    if (typed.length < 2) { setFound(null); return }
    let live = true
    const timer = setTimeout(() => {
      read<Found[]>('subcategory_search', { job: job.id, query: typed }).then(answer => { if (live) setFound(answer) }, failure => { if (live) setError(messageOf(failure)) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [query, job.id])
  async function add(code: string) {
    setBusy(code)
    setError(null)
    try {
      await act('propose_add', { job: job.id, subcategory: code })
      await onSent()
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(null)
      await onRefused()
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-control border border-border bg-subtle p-3" data-testid="find-subcategory">
      <Field label="Find the subcategory" error={error} hint={`Adding it goes to ${job.waiting_for} to approve.`}>
        <SearchInput value={query} onChange={event => setQuery(event.target.value)} placeholder="Type at least 2 letters" />
      </Field>
      {found?.length === 0 && <p className="fd-muted" data-testid="nothing-found">Nothing matches that. Try another word.</p>}
      {found && found.length > 0 && (
        <ul className="flex flex-col divide-y divide-border" data-testid="found">
          {found.map(row => (
            <li key={row.code} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span className="min-w-0 break-words">
                {row.name}
                <span className="block text-sm text-ink-muted">{row.now_in ? `Now in ${row.now_in}` : 'Not in any section here'}</span>
              </span>
              {row.asked
                ? <StatusPill tone="caution">Already asked</StatusPill>
                : <Button variant="primary" loading={busy === row.code} disabled={busy !== null} onClick={() => add(row.code)}>Ask to add</Button>}
            </li>
          ))}
        </ul>
      )}
      <div><Button onClick={onCancel} disabled={busy !== null}>Cancel</Button></div>
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
              <p className="text-sm text-ink-muted">Asked on {fmtDate(proposal.asked_on)}{proposal.decided_on ? ` · Decided on ${fmtDate(proposal.decided_on)}` : ''}</p>
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
    <Shell current="approvals" count={answer?.state === 'ok' ? answer.proposals.length : undefined} title="Waiting for your approval" testid="approvals">
      {note && <Notice tone={note.tone}><span data-testid="decision-note">{note.text}</span></Notice>}
      {!answer && !failed && <Loading />}
      {failed && <LoadFailed onRetry={load} />}
      {answer?.state === 'not_set_up' && <NotSetUp />}
      {answer?.state === 'ok' && answer.proposals.length === 0 && (
        <Card data-testid="nothing-waiting">
          <EmptyState title="Nothing is waiting for you" body="When someone asks to correct their sections and it needs you, it shows here." />
        </Card>
      )}
      {answer?.state === 'ok' && answer.proposals.map(proposal => <ApprovalCard key={proposal.id} proposal={proposal} onDone={after} />)}
    </Shell>
  )
}

function ApprovalCard({ proposal, onDone }: { proposal: Proposal; onDone: (note: { tone: 'positive' | 'negative' | 'caution'; text: string }) => Promise<unknown> }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason.trim()) return setReasonError('Say why, so they know what to do next')
    setBusy(decision)
    setReasonError(null)
    try {
      const after = await act<Proposal>('decide', { proposal: proposal.id, decision, ...(decision === 'reject' ? { reason: reason.trim() } : {}) })
      const name = proposal.who ?? 'They'
      await onDone(after.state === 'Needs fresh review'
        ? { tone: 'caution', text: `Things changed after ${name} asked, so nothing was done. They can ask again.` }
        : after.state === 'Rejected' ? { tone: 'positive', text: `Rejected. ${name} can see your reason.` }
        : { tone: 'positive', text: `Approved: ${askedOfApprover(proposal)}.` })
    } catch (failure) {
      // Decided elsewhere, or no longer theirs: the list as it is now, with the reason.
      await onDone({ tone: 'caution', text: `${proposal.who}: ${askedOfApprover(proposal)}. ${messageOf(failure).replace(/\.?$/, '.')}` })
    }
  }
  return (
    <Card data-testid="approval">
      <div className="flex flex-col gap-3 p-4">
        <div>
          <p className="font-semibold" data-testid="approval-who">{proposal.who} · {proposal.store}</p>
          <p data-testid="approval-what">{askedOfApprover(proposal)}</p>
          <p className="text-sm text-ink-muted">Asked on {fmtDate(proposal.asked_on)}</p>
        </div>
        {rejecting ? (
          <div className="flex flex-col gap-3">
            <Field label="Why are you rejecting this?" error={reasonError}>
              <TextInput value={reason} onChange={event => setReason(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" loading={busy === 'reject'} onClick={() => decide('reject')}>Reject</Button>
              <Button disabled={busy !== null} onClick={() => { setRejecting(false); setReasonError(null) }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === 'approve'} onClick={() => decide('approve')}>Approve</Button>
            <Button variant="danger" disabled={busy !== null} onClick={() => setRejecting(true)}>Reject</Button>
          </div>
        )}
      </div>
    </Card>
  )
}
