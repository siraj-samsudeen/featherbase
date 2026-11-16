// #1240: "Report an issue" on a report: a button on the report's header line that opens a side
// panel (option A of docs/design/mockups/report-an-issue.html). The reader picks what is wrong and
// may say which item and more; the panel shows what goes with it, raises the ticket in Tickets as
// the reader, and lists their open reports on this report.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Notice, StatusPill, fmtCount, fmtInstant } from '@featherbase/shop-floor'
import { openFeedback, raiseTicket, read, ticketsRunning, type OpenFeedback } from './api'
import { TicketLink } from './record-links'
import { PROBLEMS, reachText, submissionFor, viewPath, type FeedbackContext, type PageView, type Problem, type Submission } from './report-issue'

type Sent = { row_id: string }
/** Where the one submission stands: going, answered with its ticket, or failed. */
type Sending = { busy: boolean; sent: Sent | null; error: string | null }

/** The header button and its panel, for the report on show. Nothing is drawn until Tickets is known to run here. */
export function ReportIssue({ reportKey, reportName, store, month, diveFilters, pickersInDive = false, chosen = '' }: {
  reportKey: string; reportName: string; store?: string; month?: 'this' | 'last'; diveFilters?: Readonly<Record<string, string>>
  /** A Dive on show picks its own store and month: what it reports is the view, never the address's. */
  pickersInDive?: boolean
  /** The store and month the reader chose in the bar or the address; it changes only when they choose. */
  chosen?: string
}) {
  const [running, setRunning] = useState(false)
  const [open, setOpen] = useState(false)
  const [mine, setMine] = useState<OpenFeedback[] | null>(null)
  // The send lives here, above the panel: closed mid-Send and opened again, the panel shows the same
  // submission still going, its answer, or its failure, and a retry resends that submission itself.
  const pending = useRef<Submission | null>(null)
  const [sending, setSending] = useState<Sending>({ busy: false, sent: null, error: null })
  // The reader choosing another store or month in the bar is a new view to report on: an unanswered
  // submission of the old one is not resent for it. Only the reader's own choice (`chosen`) drops it;
  // the page moving from its cached view to the Dive, or a Dive's message, never does.
  useEffect(() => { if (!sending.busy) { pending.current = null; setSending(now => now.busy ? now : { busy: false, sent: null, error: null }) } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportKey, chosen])
  useEffect(() => { let live = true; ticketsRunning().then(yes => { if (live) setRunning(yes) }, () => {}); return () => { live = false } }, [])
  const refresh = useCallback(() => openFeedback(reportKey).then(answer => setMine(answer.tickets), () => setMine(null)), [reportKey])
  useEffect(() => { if (running) void refresh() }, [running, refresh])
  const send = useCallback(async (submission: Submission) => {
    pending.current = submission
    setSending({ busy: true, sent: null, error: null })
    try {
      const { ticket } = await raiseTicket(submission)
      pending.current = null
      setSending({ busy: false, sent: { row_id: ticket.row_id }, error: null })
      await refresh()
    } catch (failure) {
      setSending({ busy: false, sent: null, error: failure instanceof Error ? failure.message : 'That did not go through. Try again.' })
    }
  }, [refresh])
  const another = useCallback(() => { pending.current = null; setSending({ busy: false, sent: null, error: null }) }, [])
  if (!running) return null
  const count = mine?.length ?? 0
  return (
    <>
      <Button variant="secondary" className="fd-report-issue" data-testid="report-issue" aria-expanded={open} onClick={() => setOpen(true)}>
        Report an issue{count > 0 && <span className="fd-report-issue-count"> · {fmtCount(count)} open</span>}
      </Button>
      {open && (
        <IssuePanel reportKey={reportKey} reportName={reportName} view={{ path: viewPath(location, reportKey, { pickersInDive, store, month }), ...(pickersInDive ? {} : { store, month }), diveFilters }}
          mine={mine} pending={pending.current} sending={sending} send={send} another={another} close={() => setOpen(false)} />
      )}
    </>
  )
}

function IssuePanel({ reportKey, reportName, view, mine, pending, sending, send: submit, another: fresh, close }: {
  reportKey: string; reportName: string; view: PageView; mine: OpenFeedback[] | null
  pending: Submission | null; sending: Sending; send: (submission: Submission) => Promise<void>; another: () => void; close: () => void
}) {
  const [context, setContext] = useState<FeedbackContext | 'refused' | null>(null)
  // A submission still unanswered when the panel was closed comes back as it was, to be sent again as itself.
  const [problem, setProblem] = useState<Problem | null>(pending?.said.problem ?? null)
  const [about, setAbout] = useState(pending?.said.about ?? '')
  const [note, setNote] = useState(pending?.said.note ?? '')
  const { busy, sent, error } = sending
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let live = true
    read<FeedbackContext | { state: 'no_access' }>('feedback_context', { report: reportKey, ...(view.store ? { store: view.store } : {}) })
      .then(answer => { if (live) setContext(answer.state === 'ok' ? answer : 'refused') }, () => { if (live) setContext('refused') })
    return () => { live = false }
  }, [reportKey, view.store])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const send = () => {
    if (busy || !problem || !context || context === 'refused') return
    // A retry after a lost answer resends the same submission, so Tickets answers it again rather than raising a second ticket.
    void submit(submissionFor(pending, context, view, { problem, about, note }, new Date(), () => crypto.randomUUID()))
  }
  const another = () => { fresh(); setProblem(null); setAbout(''); setNote(''); setNow(new Date()) }
  const store = view.store && context && context !== 'refused' ? context.reach.find(s => s.store === view.store) : undefined
  return (
    <aside className="fd-issue-panel shadow-lg" role="dialog" aria-modal="false" aria-labelledby="fd-issue-title" data-testid="issue-panel">
      <header className="fd-issue-head">
        <h2 id="fd-issue-title" className="text-base font-semibold">Report an issue</h2>
        <button type="button" className="fd-issue-close" aria-label="Close" onClick={close}>✕</button>
      </header>
      <p className="fd-issue-sub">About {reportName}. Support sees it in Tickets.</p>
      {sent ? (
        <div className="fd-issue-body">
          <Notice tone="positive">
            <span data-testid="issue-sent"><strong>Sent.</strong> Your ticket is <span data-testid="issue-ticket-link"><TicketLink id={sent.row_id} /></span>. Support will reply there; you'll find it in Tickets under your requests.</span>
          </Notice>
          <div><Button variant="secondary" onClick={another}>Report another</Button></div>
        </div>
      ) : context === 'refused' ? (
        <div className="fd-issue-body"><Notice tone="negative">This report can't take an issue from you. Open one of your reports and try again.</Notice></div>
      ) : (
        <form className="fd-issue-body" onSubmit={event => { event.preventDefault(); send() }}>
          <fieldset className="fd-issue-field" disabled={busy}>
            <legend className="fd-issue-label">What's wrong?</legend>
            <div className="fd-chips" role="radiogroup" aria-label="What's wrong?">
              {PROBLEMS.map(p => (
                <button key={p} type="button" role="radio" aria-checked={problem === p} className={`fd-chip${problem === p ? ' fd-chip-on' : ''}`}
                  data-testid="issue-pick" onClick={() => setProblem(p)}>{p}</button>
              ))}
            </div>
          </fieldset>
          <label className="fd-issue-field">
            <span className="fd-issue-label">Which item, store or number? <span className="fd-issue-optional">optional</span></span>
            <input className="fd-input" value={about} maxLength={200} disabled={busy} data-testid="issue-about"
              placeholder="Kanchipuram silk target" onChange={event => setAbout(event.target.value)} />
          </label>
          <label className="fd-issue-field">
            <span className="fd-issue-label">Tell us more <span className="fd-issue-optional">optional</span></span>
            <textarea className="fd-input fd-textarea" value={note} disabled={busy} data-testid="issue-note" rows={4}
              onChange={event => setNote(event.target.value)} />
          </label>
          <section className="fd-issue-context" aria-label="Sent with your report" data-testid="issue-context">
            <h3 className="fd-issue-label">Sent with your report</h3>
            {!context ? <p className="fd-muted">Reading…</p> : (
              <dl>
                <dt>Report</dt><dd>{reportName} (a link back to this view)</dd>
                {view.store && <><dt>Store on show</dt><dd>{store?.name ?? view.store}{view.month ? ` · ${view.month === 'last' ? 'Last month' : 'This month'}` : ''}</dd></>}
                {view.diveFilters && Object.keys(view.diveFilters).length > 0 && <><dt>Filters</dt><dd>{Object.entries(view.diveFilters).map(([k, v]) => `${k}: ${v}`).join(' · ')}</dd></>}
                <dt>Your reach</dt><dd>{reachText(context.reach)}</dd>
                <dt>You</dt><dd>{[context.person, ...context.jobs].filter(Boolean).join(' · ') || '—'}</dd>
                <dt>Time</dt><dd>{fmtInstant(now)}</dd>
              </dl>
            )}
          </section>
          {error && <Notice tone="negative"><span data-testid="issue-error">{error}</span></Notice>}
          <footer className="fd-issue-foot">
            <Button variant="quiet" onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" loading={busy} disabled={!problem || !context} data-testid="issue-send">Send</Button>
          </footer>
        </form>
      )}
      <MyOpenReports mine={mine} />
    </aside>
  )
}

/** The reader's own open reports on this report, each a link to its ticket. */
function MyOpenReports({ mine }: { mine: OpenFeedback[] | null }) {
  if (!mine?.length) return null
  return (
    <section className="fd-issue-mine" data-testid="issue-mine">
      <h3 className="fd-issue-label">Your open reports on this report · {fmtCount(mine.length)}</h3>
      <ul>
        {mine.map(ticket => (
          <li key={ticket.row_id}>
            <TicketLink id={ticket.row_id} />
            <span className="fd-issue-mine-what">{[ticket.problem, ticket.about].filter(Boolean).join(' · ')}</span>
            <StatusPill tone="caution">{ticket.ticket_state}</StatusPill>
          </li>
        ))}
      </ul>
    </section>
  )
}
