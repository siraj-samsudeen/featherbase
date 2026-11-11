// Feather Dash's report page (rendered by main.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { accessFacts, read } from './api'
import { REPORT_TIMEOUT_MS, reachMessage, MEASURE_LINE, TOTALS_NOTE, isMonthChoice, monthChooser, monthWords, notArrivedLine, type MonthChoice, noAccessHelp, type NoAccessHelp, headingParts, periodLine, sectionHeading, whyLine, storeChooser, totalCells, visibleState, blankNote, dataLine, firstStore, inr, liveFrame, pageView, percent, quickBody, reportLoader, signedInr, subcategoryLabel, subtotalLabel, type LoadState } from './page'
import type { Heading, Report, ReportRow, Totals } from './report'
import { DashSidebar, SECTIONS_ADDRESS, readReports, type ReportLink } from './sections-page'

/** The store the bar's picker keeps in the address (`?store=`). */
const storeInAddress = () => new URLSearchParams(window.location.search).get('store') ?? undefined

/** The month the bar's month picker keeps in the address (`?month=`, #750): this month unless it says last. */
const monthInAddress = (): MonthChoice => {
  const month = new URLSearchParams(window.location.search).get('month')
  return isMonthChoice(month) ? month : 'this'
}

/** The bar's month choices, announced as `featherbase:bar-change` and by Back/Forward. */
function listenForMonth(onMonth: (month: string) => void): () => void {
  const fromBar = (event: Event) => {
    const { key, value } = (event as CustomEvent<{ key: string; value: string }>).detail ?? {}
    if (key === 'month' && value) onMonth(value)
  }
  const fromHistory = () => onMonth(monthInAddress())
  window.addEventListener('featherbase:bar-change', fromBar)
  window.addEventListener('popstate', fromHistory)
  return () => {
    window.removeEventListener('featherbase:bar-change', fromBar)
    window.removeEventListener('popstate', fromHistory)
  }
}

/** The bar's store choices, announced as `featherbase:bar-change` and by Back/Forward. */
function listenForStore(onStore: (store: string) => void): () => void {
  const fromBar = (event: Event) => {
    const { key, value } = (event as CustomEvent<{ key: string; value: string }>).detail ?? {}
    if (key === 'store' && value) onStore(value)
  }
  const fromHistory = () => { const store = storeInAddress(); if (store) onStore(store) }
  window.addEventListener('featherbase:bar-change', fromBar)
  window.addEventListener('popstate', fromHistory)
  return () => {
    window.removeEventListener('featherbase:bar-change', fromBar)
    window.removeEventListener('popstate', fromHistory)
  }
}

/** The report named in the address; none: the reader's first. A report change reloads the page. */
const reportInAddress = () => new URLSearchParams(window.location.search).get('report') ?? undefined

const NO_FILTER_READS: Readonly<Record<string, string>> = { report: 'report_open', embed_session: 'embed_open' }

export function Dash() {
  // The reader's reports, for whether this one takes a store: undefined until answered.
  const [reports, setReports] = useState<ReportLink[] | undefined>(undefined)
  useEffect(() => {
    // A slow read never holds the page: past the deadline it opens, and the server judges the report.
    const timer = setTimeout(() => setReports(answer => answer ?? []), REPORT_TIMEOUT_MS)
    readReports().then(list => setReports(list), () => setReports([])).finally(() => clearTimeout(timer))
    return () => clearTimeout(timer)
  }, [])
  const named = reportInAddress()
  const current = reports?.find(report => report.key === named) ?? (named ? undefined : reports?.[0])
  // A report taking no filter opens through its own reads, which need no reach.
  const noFilter = useRef(false)
  noFilter.current = !!current?.no_filter
  // undefined until the first store is known: the reads wait for it (one call per read per load).
  const [store, setStore] = useState<{ value: string | undefined } | undefined>(undefined)
  const [month, setMonth] = useState<MonthChoice>(monthInAddress)
  // The choosers read the store and month now chosen, not the render's.
  const chosen = useRef<{ store?: string; month: MonthChoice }>({ month })
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState<Report>>({ embed: undefined, report: undefined, frameFailed: false, timedOut: false, diveReady: false })
  const frame = useRef<HTMLIFrameElement>(null)
  // One deadline covers the session request and the frame (DIVE_READY_TIMEOUT_MS); past it, the
  // quick view. A late answer, or one for a store no longer on show, is ignored.
  // The Dive sends its ready message to this page's origin (#4453), which only the page knows.
  const loader = useMemo(() => reportLoader<Report>((name, payload) =>
    read(noFilter.current ? NO_FILTER_READS[name] ?? name : name, { ...payload, ...(named ? { report: named } : {}), ...(name === 'embed_session' ? { app_origin: location.origin } : {}) }), setState), [named])
  // Choosing a store: the store on show, repeated, changes nothing (round 9); another store drops
  // the previous store's answers at once (round 8), and its effect below opens it.
  const choose = useMemo(() => storeChooser(loader, value => { chosen.current.store = value; setStore({ value }) }, () => chosen.current.month), [loader])
  // Choosing a month (#750) works the same way: the month on show, repeated, changes nothing.
  const chooseMonth = useMemo(() => monthChooser(loader, () => chosen.current.store,
    value => { chosen.current.month = value; setMonth(value) }, chosen.current.month), [loader])
  useEffect(() => listenForMonth(chooseMonth), [chooseMonth])
  // A store in the address is checked against the reader's stores before anything is read.
  // A store named in the address is checked first and never replaced by the default; a check
  // that runs past STORE_CHECK_TIMEOUT_MS offers Try again, which checks again.
  const [checkFailed, setCheckFailed] = useState(false)
  const [checkAttempt, setCheckAttempt] = useState(0)
  useEffect(() => {
    if (store || !reports) return
    // A report taking no store, or none of the reader's: open it now; the server judges it.
    // #1159: a Dive with its own pickers opens at once on the address's store; the server checks it.
    if (current?.pickers_in_dive) { setStore({ value: storeInAddress() }); return }
    if (!current?.takes_store) { setStore({ value: undefined }); return }
    setCheckFailed(false)
    return firstStore(storeInAddress(), listenForStore, value => {
      setCheckFailed(false)
      choose(value)
    }, undefined, store => read<{ value: string }[]>('stores', named ? { report: named } : {}).then(options => options.some(o => o.value === store)),
    () => setCheckFailed(true))
    // Runs once per load, and again on Try again while no store is known yet; its listener also
    // carries every later choice (the bar, Back and Forward).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkAttempt, reports])
  useEffect(() => {
    if (!store) return
    loader.open(store.value, month)
    return () => loader.close()
  }, [loader, store, month, attempt])
  // The Dive's ready message (B7), checked against its origin and its own frame by the loader.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => loader.message(event, frame.current?.contentWindow)
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [loader])
  const tryAgain = useCallback(() => (checkFailed ? setCheckAttempt : setAttempt)((n) => n + 1), [checkFailed])
  // Only a state of the store now chosen is drawn, whatever reached it (round 8).
  const shown = visibleState(state, store?.value, month)
  const { report } = shown
  const view = checkFailed && !store ? { kind: 'failed' as const } : pageView(shown)
  const frameAttempt = loader.current()
  const frameSrc = liveFrame(shown)

  return (
    <div className="fd-shell">
    <DashSidebar current="report" />
    <main className="fd-page" data-testid="dash" data-view={view.kind}>
      {/* The header, in every state with a store on show (#4486): the Dive, the quick view, and each empty state. */}
      {/* #1159: over a Dive with its own pickers the Dive names the store itself; the heading stays for its cached view. */}
      {(view.kind === 'dive' || view.kind === 'quick' || view.kind === 'empty') && !(view.kind === 'dive' && report?.ok && report.value.pickers_in_dive) && report?.ok && report.value.heading && (report.value.heading.name || report.value.heading.reasons.length > 0) && (
        <ReportHeading heading={report.value.heading} period={report.value} wide={view.kind === 'dive'} />
      )}
      {view.kind === 'opening' && <p className="fd-opening">Opening your report…</p>}
      {/* #1143: one place for the frame, on show or out of sight behind the quick view, so the Dive
          that says it is ready after the deadline takes over in the same frame, never reloaded. */}
      {/* Also behind "being prepared" and "not arrived yet": they speak for the cached copy, but the Dive reads the warehouse itself. */}
      {frameSrc && (view.kind === 'dive' || view.kind === 'quick' || view.kind === 'failed' || (view.kind === 'empty' && view.why !== 'whole_stores_only')) && (
        <div className={view.kind === 'dive' ? 'fd-frame-box' : 'fd-frame-box fd-frame-behind'}
          aria-hidden={view.kind === 'dive' ? undefined : true} inert={view.kind !== 'dive'}>
          {view.kind === 'dive' && !shown.diveReady && <p className="fd-opening fd-opening-over">Opening your report…</p>}
          <iframe
            data-testid="report-frame"
            title={current?.name ?? 'Report'}
            sandbox="allow-scripts allow-same-origin"
            src={frameSrc}
            ref={frame}
            // The frame names the attempt it belongs to: a frame of an earlier store is ignored.
            onLoad={() => loader.frameLoaded(frameAttempt)}
            onError={() => loader.frameFailed(frameAttempt)}
            className="fd-frame"
          />
        </div>
      )}
      {view.kind === 'quick' && report?.ok && <QuickView report={report.value} />}
      {view.kind === 'empty' && (
        <Notice testid={`empty-${view.why}`}>
          {view.why === 'no_data_yet' && notArrivedLine(month)}
          {view.why === 'not_built' && 'The figures are being prepared. Try again in a few minutes.'}
          {view.why === 'whole_stores_only' && "This report covers whole stores, so it isn't available for your job."}
        </Notice>
      )}
      {view.kind === 'no_access' && <NoAccess otherReports={!!reports?.length} />}
      {view.kind === 'signed_out' && (
        <Notice testid="signed-out"><a href={`/featherbase/login?next=${encodeURIComponent('/dash/' + window.location.search)}`}>Sign in</a> to open your report.</Notice>
      )}
      {view.kind === 'failed' && (
        <Notice testid="failed">
          <span>This report couldn't open.</span>
          <button type="button" className="fd-button" onClick={tryAgain}>Try again</button>
        </Notice>
      )}
    </main>
    </div>
  )
}

/** The store on show, the period, why the reader sees the store (left out when no reason is known), and what the figures measure. */
function ReportHeading({ heading, period, wide }: { heading: Heading; period: { period_start?: string; period_end?: string; no_quick_view?: boolean }; wide: boolean }) {
  const why = whyLine(heading)
  const { lead, count } = headingParts(heading)
  const [listOpen, setListOpen] = useState(false)
  return (
    <header className={`fd-heading${wide ? ' fd-heading-wide' : ''}`} data-testid="report-heading">
      <h1 className="fd-title" data-testid="heading-title">
        {lead}
        {count && <button type="button" className="fd-count" aria-expanded={listOpen} onClick={() => setListOpen(open => !open)}>{count}</button>}
      </h1>
      {period.period_start && period.period_end && <p className="fd-muted" data-testid="period-line">{periodLine({ period_start: period.period_start, period_end: period.period_end })}</p>}
      {why && <p className="fd-muted" data-testid="why-line">{why}</p>}
      {!period.no_quick_view && <p className="fd-muted" data-testid="measure-line">{MEASURE_LINE}</p>}
      {count && listOpen && <p className="fd-sections" data-testid="sections-list">{heading.sections.join(' · ')}</p>}
    </header>
  )
}

/** Why the report refused. Nothing is said until the platform has answered: a manager never
 *  flashes the reader's "ask your Store Manager". */
function NoAccess({ otherReports }: { otherReports: boolean }) {
  const [help, setHelp] = useState<NoAccessHelp | undefined>(undefined)
  // Why this job reaches nothing, when it is something the person can act on or wait for.
  const [message, setMessage] = useState<ReturnType<typeof reachMessage>>(null)
  useEffect(() => {
    let live = true
    read<{ problems: string[] }>('reach_problem').then(answer => { if (live) setMessage(reachMessage(answer.problems)) }, () => {})
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    accessFacts().then(facts => { if (live) setHelp(noAccessHelp({ ...facts, local })) })
    return () => { live = false }
  }, [])
  if (!help) return <p className="fd-opening">Opening your report…</p>
  // A report that isn't one of theirs, or doesn't exist, while others are (#967 point 7).
  if (otherReports)
    return (
      <Notice testid="not-your-report">
        <span>You can't open this report. Choose one of your reports from the list.</span>
      </Notice>
    )
  if (message && (!message.readerOnly || help.kind === 'reader'))
    return (
      <Notice testid="reach-problem">
        <span>{message.text}</span>
        {message.sectionsLink && <a href={SECTIONS_ADDRESS} data-testid="fix-link">Open Your sections to see what is set against you, and correct it</a>}
      </Notice>
    )
  if (help.kind === 'reader') return <AskForAccess />
  const health = <p><a href="/featherbase/admin/instance-health">Open instance health</a></p>
  if (help.kind === 'not_set_up')
    return (
      <Notice testid="not-set-up">
        <p><strong>Dash isn't set up on this instance yet</strong>, so no store's report can open.</p>
        <p data-testid="setup-missing">It lacks: {help.missing.join(', ')}.</p>
        {help.fix && <p>{help.fix}</p>}
        {help.command && (
          <>
            <p>To see the report with made-up data on this machine, stop the server (Ctrl-C) and run:</p>
            <p><code data-testid="next-command">{help.command}</code></p>
            <p>It prints who to sign in as.</p>
          </>
        )}
        {health}
      </Notice>
    )
  return (
    <Notice testid="manager-no-store">
      <p><strong>Dash is set up, but it has no report to show you</strong>: none has been given to you, or your job reaches no store.</p>
      <p>A report opens for people it has been given to, directly, through a role or through their job, and shows what their job in the store org chart reaches. Give reports on the <a href="?view=access">Report access</a> page, or sign in as someone who has one.</p>
      {help.command && (
        <p>On this machine, <code data-testid="next-command">{help.command}</code> prints made-up people to sign in as. reader-sm@example.test is a made-up Store Manager.</p>
      )}
      {health}
    </Notice>
  )
}

/**
 * No report for this person (#967 point 11). Who gives reports, and recording the request when
 * someone opens Dash with none, belong to report bundles (#1046): until then the page says so.
 */
function AskForAccess() {
  return (
    <Notice testid="no-access">
      <span>You don't have a report to open yet. Ask the person who gives Dash reports in your company for access.</span>
      <a href={SECTIONS_ADDRESS} data-testid="fix-link">If you work in a store, open Your sections to see what is set against you</a>
    </Notice>
  )
}

function Notice({ children, testid }: { children: React.ReactNode; testid: string }) {
  return <section className="fd-card fd-notice" data-testid={testid}>{children}</section>
}

/** Row figures under the display rule: "—" where nothing was recorded, the old report's figure otherwise. */
function RowFigures({ row }: { row: ReportRow }) {
  const both = row.targetRecorded && row.salesRecorded
  return (
    <>
      <td className="fd-num">{row.targetRecorded ? inr(row.target) : '—'}</td>
      <td className="fd-num">{row.salesRecorded ? inr(row.actual) : '—'}</td>
      <td className={`fd-num ${both && row.gap != null && row.gap < 0 ? 'fd-negative' : ''}`}>{both ? signedInr(row.gap) : '—'}</td>
      <td className="fd-num">{both ? percent(row.achievement) : '—'}</td>
    </>
  )
}

/** Subtotal and total figures: the old report's sums, drawn under the display rule. */
function TotalFigures({ t }: { t: Totals }) {
  const cells = totalCells(t)
  const both = t.targets_recorded > 0 && t.sales_recorded > 0
  return (
    <>
      <td className="fd-num">{cells.target}</td>
      <td className="fd-num">{cells.sales}</td>
      <td className={`fd-num ${both && t.gap != null && t.gap < 0 ? 'fd-negative' : ''}`}>{cells.gap}</td>
      <td className="fd-num">{cells.achieved}</td>
    </>
  )
}

function QuickView({ report }: { report: Report }) {
  const [showQuiet, setShowQuiet] = useState(false)
  // Whether the table is wider than its box (the swipe cue), and whether more of it lies to the
  // right of what is in view (the edge fade); both re-checked on scroll and resize.
  const box = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [moreRight, setMoreRight] = useState(false)
  const measure = useCallback(() => {
    const el = box.current
    setOverflows(!!el && el.scrollWidth > el.clientWidth + 1)
    setMoreRight(!!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure, showQuiet, report])
  const quiet = report.rows.filter((r) => r.noTargetNoSale).length
  const shown = (r: ReportRow) => showQuiet || !r.noTargetNoSale
  const blanks = report.rows.filter((r) => shown(r) && (!r.targetRecorded || !r.salesRecorded)).length
  const body = quickBody(report.rows, showQuiet)
  return (
    <section className="fd-card fd-quick" data-testid="quick-view">
      <header className="fd-quick-head">
        <p className="fd-muted fd-quick-line">
          <span data-testid="quick-label">{"Cached · the full report couldn't open"}</span>
          <span data-testid="data-line">{dataLine(report)}</span>
        </p>
        {!report.targets_available && <p className="fd-muted">Targets for {monthWords(report.month)} aren't available yet; sales are shown.</p>}
      </header>
      {body === 'nothing' && <p data-testid="quick-nothing">{report.month === 'last' ? 'Nothing was recorded last month for your section.' : 'Nothing recorded this month for your section yet.'}</p>}
      {body === 'table' && overflows && <p className="fd-muted fd-small" data-testid="scroll-hint">Swipe the table sideways to see Gap and Achieved.</p>}
      {body === 'table' && (
        <div className={`fd-table-box${moreRight ? ' fd-more-right' : ''}`} ref={box} onScroll={measure}>
          <table className="fd-table">
            <thead>
              <tr><th scope="col">Subcategory</th><th scope="col" className="fd-num">Target</th><th scope="col" className="fd-num">Sales</th>
                <th scope="col" className="fd-num">Gap</th><th scope="col" className="fd-num">Achieved</th></tr>
            </thead>
            {/* A section whose rows are all hidden (no target and no sales) is hidden with them. */}
            {report.sections.filter((section) => report.rows.some((r) => r.section === section.section && shown(r))).map((section) => (
              <tbody key={section.section ?? ''} data-testid="quick-section">
                <tr className="fd-section-row"><th scope="rowgroup" colSpan={5}><span className="fd-sticky-name">{sectionHeading(section.section)}</span></th></tr>
                {report.rows.filter((r) => r.section === section.section && shown(r)).map((row) => {
                  const label = subcategoryLabel(row)
                  return (
                    <tr key={row.code}>
                      <th scope="row" className={`fd-sub${label.unnamed ? ' fd-unnamed' : ''}`}>
                        {label.name}
                      </th>
                      <RowFigures row={row} />
                    </tr>
                  )
                })}
                <tr className="fd-subtotal"><th scope="row">{subtotalLabel(section.section)}</th><TotalFigures t={section} /></tr>
              </tbody>
            ))}
            <tfoot>
              <tr className="fd-total"><th scope="row">Total</th><TotalFigures t={report.total} /></tr>
            </tfoot>
          </table>
        </div>
      )}
      {quiet > 0 && (
        <button type="button" className="fd-link" onClick={() => setShowQuiet((s) => !s)} data-testid="toggle-quiet">
          {showQuiet ? `Hide ${quiet} with no target and no sales` : `Show ${quiet} with no target and no sales`}
        </button>
      )}
      {body === 'table' && <p className="fd-muted fd-small" data-testid="totals-note">{TOTALS_NOTE}</p>}
      {body === 'table' && blanks > 0 && <p className="fd-muted fd-small" data-testid="blank-note">{blankNote(blanks, report.month)}</p>}
    </section>
  )
}
