// Feather Dash's report page (rendered by main.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { accessFacts, read } from './api'
import { MEASURE_LINE, TOTALS_NOTE, noAccessHelp, type NoAccessHelp, headingTitle, periodLine, sectionHeading, whyLine, storeChooser, totalCells, visibleState, blankNote, dataLine, firstStore, inr, pageView, percent, quickBody, reportLoader, signedInr, subcategoryLabel, subtotalLabel, type LoadState } from './page'
import type { Heading, Report, ReportRow, Totals } from './report'

/** The store the bar's picker keeps in the address (`?store=`). */
const storeInAddress = () => new URLSearchParams(window.location.search).get('store') ?? undefined

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

export function FeatherDash() {
  // undefined until the first store is known: the reads wait for it (one call per read per load).
  const [store, setStore] = useState<{ value: string | undefined } | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState<Report>>({ embed: undefined, report: undefined, frameFailed: false, diveReady: false })
  const frame = useRef<HTMLIFrameElement>(null)
  // One deadline covers the session request and the frame (DIVE_READY_TIMEOUT_MS); past it, the
  // quick view. A late answer, or one for a store no longer on show, is ignored.
  // The Dive sends its ready message to this page's origin (#4453), which only the page knows.
  const loader = useMemo(() => reportLoader<Report>((name, payload) =>
    read(name, name === 'embed_session' ? { ...payload, app_origin: location.origin } : payload), setState), [])
  // Choosing a store: the store on show, repeated, changes nothing (round 9); another store drops
  // the previous store's answers at once (round 8), and its effect below opens it.
  const choose = useMemo(() => storeChooser(loader, value => setStore({ value })), [loader])
  // A store in the address is checked against the reader's stores before anything is read.
  // A store named in the address is checked first and never replaced by the default; a check
  // that runs past STORE_CHECK_TIMEOUT_MS offers Try again, which checks again.
  const [checkFailed, setCheckFailed] = useState(false)
  const [checkAttempt, setCheckAttempt] = useState(0)
  useEffect(() => {
    if (store) return
    setCheckFailed(false)
    return firstStore(storeInAddress(), listenForStore, value => {
      setCheckFailed(false)
      choose(value)
    }, undefined, store => read<{ value: string }[]>('stores').then(options => options.some(o => o.value === store)),
    () => setCheckFailed(true))
    // Runs once per load, and again on Try again while no store is known yet; its listener also
    // carries every later choice (the bar, Back and Forward).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkAttempt])
  useEffect(() => {
    if (!store) return
    loader.open(store.value)
    return () => loader.close()
  }, [loader, store, attempt])
  // The Dive's ready message (B7), checked against its origin and its own frame by the loader.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => loader.message(event, frame.current?.contentWindow)
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [loader])
  const tryAgain = useCallback(() => (checkFailed ? setCheckAttempt : setAttempt)((n) => n + 1), [checkFailed])
  // Only a state of the store now chosen is drawn, whatever reached it (round 8).
  const shown = visibleState(state, store?.value)
  const { report } = shown
  const view = checkFailed && !store ? { kind: 'failed' as const } : pageView(shown)
  const frameAttempt = loader.current()

  return (
    <main className="fd-page" data-testid="feather-dash" data-view={view.kind}>
      {/* The header, in every state with a store on show (#4486): the Dive, the quick view, and each empty state. */}
      {(view.kind === 'dive' || view.kind === 'quick' || view.kind === 'empty') && report?.ok && report.value.heading && (
        <ReportHeading heading={report.value.heading} period={report.value} wide={view.kind === 'dive'} />
      )}
      {view.kind === 'opening' && <p className="fd-opening">Opening your report…</p>}
      {view.kind === 'dive' && (
        <div className="fd-frame-box">
          {!shown.diveReady && <p className="fd-opening fd-opening-over">Opening your report…</p>}
          <iframe
            data-testid="report-frame"
            title="Sales target against sales"
            sandbox="allow-scripts allow-same-origin"
            src={view.src}
            ref={frame}
            // The frame names the attempt it belongs to: a frame of an earlier store is ignored.
            onLoad={() => loader.frameLoaded(frameAttempt)}
            onError={() => loader.frameFailed(frameAttempt)}
            className="fd-frame"
          />
        </div>
      )}
      {view.kind === 'quick' && report?.ok && <QuickView report={report.value} tooLarge={view.why === 'too_large'} />}
      {view.kind === 'empty' && (
        <Notice testid={`empty-${view.why}`}>
          {view.why === 'no_data_yet' && "This month's figures haven't arrived yet. They usually arrive by early morning."}
          {view.why === 'no_sections' && 'This store has no sections set up yet, so there is nothing to show.'}
          {view.why === 'not_built' && 'The figures are being prepared. Try again in a few minutes.'}
        </Notice>
      )}
      {view.kind === 'no_access' && <NoAccess />}
      {view.kind === 'signed_out' && (
        <Notice testid="signed-out"><a href={`/featherbase/login?next=${encodeURIComponent('/feather_dash/' + window.location.search)}`}>Sign in</a> to open your report.</Notice>
      )}
      {view.kind === 'failed' && (
        <Notice testid="failed">
          <span>Your report couldn't load.</span>
          <button type="button" className="fd-button" onClick={tryAgain}>Try again</button>
        </Notice>
      )}
    </main>
  )
}

/** The store on show, the period, why the reader sees the store (left out when no reason is known), and what the figures measure. */
function ReportHeading({ heading, period, wide }: { heading: Heading; period: { period_start: string; period_end: string }; wide: boolean }) {
  const why = whyLine(heading)
  return (
    <header className={`fd-heading${wide ? ' fd-heading-wide' : ''}`} data-testid="report-heading">
      <h1 className="fd-title" data-testid="heading-title">{headingTitle(heading)}</h1>
      <p className="fd-muted" data-testid="period-line">{periodLine(period)}</p>
      {why && <p className="fd-muted" data-testid="why-line">{why}</p>}
      <p className="fd-muted" data-testid="measure-line">{MEASURE_LINE}</p>
    </header>
  )
}

/** Why the report refused. Nothing is said until the platform has answered: a manager never
 *  flashes the reader's "ask your Store Manager". */
function NoAccess() {
  const [help, setHelp] = useState<NoAccessHelp | undefined>(undefined)
  useEffect(() => {
    let live = true
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    accessFacts().then(facts => { if (live) setHelp(noAccessHelp({ ...facts, local })) })
    return () => { live = false }
  }, [])
  if (!help) return <p className="fd-opening">Opening your report…</p>
  if (help.kind === 'reader')
    return <Notice testid="no-access">You don't have access to any store's report yet. Ask your Store Manager if you think you should.</Notice>
  const health = <p><a href="/featherbase/admin/instance-health">Open instance health</a></p>
  if (help.kind === 'not_set_up')
    return (
      <Notice testid="not-set-up">
        <p><strong>Feather Dash isn't set up on this instance yet</strong>, so no store's report can open.</p>
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
      <p><strong>Feather Dash is set up, but your account covers no store</strong>, so it has no report to show you.</p>
      <p>The report opens for people with the Feather Dash Reader role and a job in the store org chart. Give yourself or someone else those, or sign in as someone who has them.</p>
      {help.command && (
        <p>On this machine, <code data-testid="next-command">{help.command}</code> prints made-up people to sign in as. reader-sm@example.test is a made-up Store Manager.</p>
      )}
      {health}
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

function QuickView({ report, tooLarge = false }: { report: Report; tooLarge?: boolean }) {
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
        <h2 className="fd-title">Quick view</h2>
        <p className="fd-muted" data-testid="quick-label">
          {tooLarge ? 'This store is too large for the interactive report yet. Showing the cached table.' : "Cached · the full report couldn't open"}
        </p>
        <p className="fd-muted" data-testid="data-line">{dataLine(report)}</p>
        {!report.targets_available && <p className="fd-muted">Targets for this month aren't available yet; sales are shown.</p>}
      </header>
      {body === 'nothing' && <p data-testid="quick-nothing">Nothing recorded this month for your section yet.</p>}
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
      {body === 'table' && blanks > 0 && <p className="fd-muted fd-small" data-testid="blank-note">{blankNote(blanks)}</p>}
    </section>
  )
}
