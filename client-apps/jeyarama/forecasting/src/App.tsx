// The Forecasting app: one frame (the shared sidebar beside the page) and seven pages, chosen by ?view=.
// Baseline on made-up data (#4870 in the warehouse repo): Runs, bases and sales come from madeUp.ts and
// sales.ts; numbers, their history, Review questions and ideas are Featherbase rows. The month is
// picked beside "Viewing as" and kept in the address (?month=), as Dash's top-bar Month picker keeps it.
import { UNNAMED_TL } from './teamLeader/live'
import { createElement, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, Field, PersonLabel, Select, Skeleton } from '@featherbase/shop-floor'
import { listAll, saveRow } from './api'
import { PEOPLE, person, type Person } from './madeUp'
import { DATASET } from './dataset'
import { MONTH_OPTIONS, monthOf, type Month } from './months'
import { ChartsPage } from './ChartsPage'
import { MyNumbersPage, unseenFor } from './MyNumbersPage'
import { WorkspacePage } from './WorkspacePage'
import { ReviewMonthPage } from './ReviewMonthPage'
import { IdeasPage, NumbersPage, ResultsPage, ReviewPage, RunsPage } from './pages'
import { SectionPage } from './teamLeader/SectionPage'
import { UnassignedPage } from './unassigned/UnassignedPage'
import { AttentionPage } from './attention/AttentionPage'
import { DayReviewPage } from './dayReview/DayReviewPage'
import { StorePage } from './teamLeader/StorePage'

export interface NumberRow {
  row_id: string; month: string; run: string; store: string; section: string; scope_level: 'Store' | 'Division' | 'Category' | 'Subcategory'; scope_name: string; weeks: string | null
  kind: string; value: number; weights_json: string | null; entered_by: string; entered_by_role: string; entered_on: string
  reason: string; status: 'Waiting' | 'Applied' | 'Reference' | 'Not approved' | 'Withdrawn'; waiting_on: string | null
  /** Who last changed it: the server checks their area. */
  changed_by: string | null
  /** A percent number's percent (−100 for a closure), kept as a percent; its rupees are worked out when shown. */
  percent: number | null
}
export interface DecisionRow { row_id: string; number: string | null; month: string; store: string; scope_level: string | null; scope_name: string; weeks: string | null
  decision: string; decided_by: string; note: string | null; decided_on: string }
export interface QuestionRow { row_id: string; ref: string; month: string; scope: string; question: string; detail: string | null; asked_by: string; asked_on: string
  answer: string | null; answered_by: string | null; answered_on: string | null; outcome: string; impact: string | null; follow_up: string | null; idea_ref: string | null; follow_up_on: string | null }
/** One entry in a Review question's thread: a reply, the answer, an outcome change, a follow-up. */
export interface ReviewNote { row_id: string; question: string; kind: string; by: string; on: string; text: string | null; from_outcome: string | null; to_outcome: string | null }
export interface IdeaRow { row_id: string; ref: string; label: string; title: string; kind: string; raised_by: string; raised_on: string; why: string; tried: string; found: string
  verdict: string; outcome: string; status_note: string; decided_on: string; revisit: string | null; areas: string | null; evidence: string | null
  decided_by: string | null; reason: string | null; revisit_on: string | null; related: string | null; question_ref: string | null }
/** One change to an idea, kept in its history. */
export interface IdeaChange { row_id: string; idea: string; changed_by: string; changed_on: string; change: string }

/** Why a day sold more or less than its forecast (ReviewMonthPage): the causes, one a line, and a note. */
export interface ExplanationRow { row_id: string; month: string; store: string; scope_level: string; scope_name: string; day: number; causes: string; note: string | null
  explained_by: string; explained_by_role: string | null; explained_on: string }
export interface Data { explanations: ExplanationRow[]; numbers: NumberRow[]; decisions: DecisionRow[]; questions: QuestionRow[]; ideas: IdeaRow[]; ideaHistory: IdeaChange[]; reviewNotes: ReviewNote[] }
export interface Ctx { data: Data; viewer: Person; month: Month; reload: () => Promise<void>; save: typeof saveRow }

const VIEWS = [
  { key: 'sections', label: 'Sections', group: 'Forecasts', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1' },
  { key: 'section', label: 'My Section', group: 'Forecasts', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z' },
  { key: 'attention', label: 'Needs Your Attention', group: 'Forecasts', icon: 'M12 9v4M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
  { key: 'days', label: 'Day Review', group: 'Forecasts', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { key: 'unassigned', label: 'No Section', group: 'Forecasts', icon: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' },
  { key: 'forecasts', label: 'Workspace', group: 'Forecasts', icon: 'M3 3h18v18H3zM3 9h18M9 3v18' },
  { key: 'numbers', label: 'Ledger', group: 'Forecasts', icon: 'M20 6 9 17l-5-5' },
  { key: 'mine', label: 'My Numbers', group: 'Forecasts', icon: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10' },
  { key: 'runs', label: 'Runs & Targets', group: 'Forecasts', icon: 'M4 6h16M4 12h16M4 18h10' },
  { key: 'results', label: 'Results', group: 'Learning', icon: 'M3 3v18h18M7 14v3m5-8v8m5-12v12' },
  { key: 'charts', label: 'Charts', group: 'Learning', icon: 'M3 3v18h18M7 16l4-5 4 3 5-7' },
  { key: 'review', label: 'Review', group: 'Learning', icon: 'M8 10h8M8 14h5M21 12a9 9 0 1 1-4-7.5L21 3v6h-6' },
  { key: 'ideas', label: 'Idea Register', group: 'Learning', icon: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2' },
] as const
type View = typeof VIEWS[number]['key']

/** The pages of the review, which follow the newest official Run, not the month picked for the older pages. */
const RUN_VIEWS: string[] = ['sections', 'section', 'attention', 'days', 'unassigned']

export const address = (view: View, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(window.location.search)
  q.set('view', view)
  if (RUN_VIEWS.includes(view)) q.delete('month')
  for (const k of ['store', 'level', 'name', 'weeks', 'pane', 'q', 'idea', 'question', 'show', 'division', 'subdivision', 'category', 'sub', 'section', 'tab', 'dview', 'day', 'rows', 'line', 'practice', 'tl', ...CHART_KEYS]) q.delete(k)
  for (const [k, v] of Object.entries(extra)) q.set(k, v)
  return `?${q}`
}

/** The Charts page's own choices in the address; another page drops them. */
export const CHART_KEYS = ['chart', 'region', 'stores', 'subs', 'pick', 'top', 'within', 'bars']

/** The month kept in the address (?month=); none or an unknown one: the current month. */
const monthInAddress = () => monthOf(new URLSearchParams(window.location.search).get('month')).key

/**
 * The page's month, as Dash's top-bar Month picker keeps it: in the address, so it carries to every
 * page (address() keeps it) and survives a reload. An address with no valid month gets the current
 * one written in place (no Back step); a choice is a new history entry, and Back/Forward follow it.
 */
function useMonth() {
  const [key, setKey] = useState(monthInAddress)
  const write = (next: string, replace: boolean) => {
    const q = new URLSearchParams(window.location.search)
    q.set('month', next)
    history[replace ? 'replaceState' : 'pushState'](null, '', `?${q}`)
  }
  useEffect(() => {
    // the review's own pages (and the default page, Sections) carry no month: they follow the newest official Run
    const here = new URLSearchParams(window.location.search).get('view')
    const runPage = !here || RUN_VIEWS.includes(here)
    if (!runPage && new URLSearchParams(window.location.search).get('month') !== monthInAddress()) write(monthInAddress(), true)
    const fromHistory = () => setKey(monthInAddress())
    window.addEventListener('popstate', fromHistory)
    return () => window.removeEventListener('popstate', fromHistory)
  }, [])
  const choose = (next: string) => { if (next === key) return; write(next, false); setKey(next) }
  return [monthOf(key), choose] as const
}

/** Waiting for this person: numbers whose next step is theirs. */
export const waitingFor = (data: Data, viewer: Person) => data.numbers.filter(n => n.status === 'Waiting' && n.waiting_on === viewer.name)

/** The section an administrator is looking at (?store&section&tl), which Needs Your Attention keeps: it is that section's. */
const sectionInAddress = () => {
  const q = new URLSearchParams(window.location.search), out: Record<string, string> = {}
  for (const k of ['store', 'section', 'tl']) { const v = q.get(k); if (v) out[k] = v }
  return out.store && out.section ? out : {}
}

function Sidebar({ current, waiting, news }: { current: View; waiting: number; news: number }) {
  const groups = ['Forecasts', 'Learning']
  return createElement('featherbase-sidebar', { 'aria-label': 'Forecasting navigation' },
    ...groups.flatMap(group => [
      <span key={group} className="fc-sidebar-group">{group}</span>,
      ...VIEWS.filter(v => v.group === group).map(v => (
        <a key={v.key} href={v.key === 'attention' || v.key === 'days' ? address(v.key, sectionInAddress()) : address(v.key)} {...(current === v.key ? { 'aria-current': 'page' as const } : {})}>
          <svg className="max-sm:hidden" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={v.icon} /></svg>
          <span data-testid={`nav-${v.key}`}>{v.label}{v.key === 'numbers' && waiting ? ` (${waiting})` : ''}{v.key === 'mine' && news ? ` (${news} new)` : ''}</span>
        </a>)),
    ]))
}

/** Made-up people only: the baseline shows each one's view without separate sign-ins. The month sits beside it. */
function ViewingAs({ viewer, onChange, month, onMonth, signedIn }: { viewer: Person; onChange: (id: string) => void; month: Month; onMonth: (key: string) => void; signedIn: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-72"><PersonLabel rowId={viewer.code} name={viewer.name} label={{ code: viewer.code, role: viewer.role, place: viewer.place }} canOpen={false} className="w-full" /></div>
      {!signedIn && <div className="w-56">
        <Field label={DATASET ? 'Viewing as' : 'Viewing as (made-up people)'}>
          <Select value={viewer.id} onChange={e => onChange(e.target.value)} data-testid="viewing-as">
            {PEOPLE.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
          </Select>
        </Field>
      </div>}
      <div className="w-52">
        <Field label="Month">
          <Select value={month.key} onChange={e => onMonth(e.target.value)} data-testid="month">
            {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      </div>
    </div>
  )
}

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="fc-title">{title}</h1>
        {actions}
      </div>
      {children}
    </>
  )
}

/** A month with no engine Run yet: nothing to show or change until it is in. */
export function NoRunYet({ month, what }: { month: Month; what: string }) {
  return <Card><EmptyState title={`${month.label} has no Run yet`} body={`The engine writes ${month.name}'s official Run at the end of ${month.before}. ${what}`} /></Card>
}

/**
 * Moving between pages stays inside the app (TL-3, #1419): a click on a link that only changes this page's query
 * (the sidebar, a link from one page to another) and Back/Forward redraw the page instead of reloading the
 * document, so the shell stays put and the loaded data is kept. Each move gives the page a fresh mount, so a page
 * still starts from its address as it did after a reload. Opening a new tab or window stays the browser's.
 */
function useInAppNavigation() {
  const [moves, setMoves] = useState(0)
  useEffect(() => {
    const moved = () => setMoves(n => n + 1)
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self')) return
      const to = new URL(a.href, location.href)
      if (to.origin !== location.origin || to.pathname !== location.pathname) return
      e.preventDefault()
      if (to.search !== location.search) history.pushState(null, '', to.search || '?')
      moved()
      window.scrollTo(0, 0)
    }
    document.addEventListener('click', click)
    window.addEventListener('popstate', moved)
    return () => { document.removeEventListener('click', click); window.removeEventListener('popstate', moved) }
  }, [])
  return moves
}

export function ForecastingApp() {
  const moves = useInAppNavigation()
  const params = new URLSearchParams(window.location.search)
  // Whoever looks after the app opens as the top of the chain (the Chief Executive), not the first name in the list.
  const top = (PEOPLE.find(p => p.role === 'Chief Executive') ?? PEOPLE[0]).id
  const [viewerId, setViewerId] = useState(() => params.get('as') ?? localStorage.getItem('fc_viewer') ?? top)
  const [data, setData] = useState<Data | null>(null)
  const [failed, setFailed] = useState(false)
  // Signed in as a made-up forecaster: the page is theirs, and the server checks the same person. The
  // Administrator keeps "Viewing as", to see any made-up person's view.
  const [me, setMe] = useState<Person | null>(null)
  // Someone signed in who is neither on the chart nor looks after the app sees nobody's view.
  const [offChart, setOffChart] = useState('')
  useEffect(() => {
    fetch('/api/whoami', { credentials: 'same-origin' }).then(r => r.json()).then((u: { row_id?: string; full_name?: string; roles?: string[] }) => {
      const admin = u.row_id === 'Administrator' || (u.roles ?? []).includes('System Manager')
      if (admin) return
      const mine = PEOPLE.find(p => p.name === u.full_name)
      if (mine) setMe(mine); else setOffChart(u.full_name || 'You')
    }, () => {})
  }, [])
  const viewer = me ?? person(PEOPLE.some(p => p.id === viewerId) ? viewerId : top)
  // Whoever looks after the app opens any store's section as its Team Leader would see it:
  // ?view=section&store=<store>&section=<section>&tl=<name> (a loaded Run's sections are not on the made-up chart).
  const asSection = !me && params.get('section') && params.get('store')
    ? { name: params.get('tl') || UNNAMED_TL, role: 'Team Leader', place: `${params.get('store')} · ${params.get('section')}` } : null
  // A Team Leader opens on their own section's review (#1419); everyone else on the Workspace.
  const view = (VIEWS.some(v => v.key === params.get('view')) ? params.get('view') : viewer.role === 'Team Leader' && me ? 'section' : 'sections') as View
  const [month, chooseMonth] = useMonth()

  const reload = useCallback(async () => {
    try {
      const [numbers, decisions, questions, ideas, ideaHistory, reviewNotes, explanations] = await Promise.all([
        listAll<NumberRow>('forecasting.number', ['month', 'run', 'store', 'section', 'scope_level', 'scope_name', 'weeks', 'kind', 'value', 'weights_json', 'entered_by', 'entered_by_role', 'entered_on', 'reason', 'status', 'waiting_on', 'changed_by', 'percent']),
        listAll<DecisionRow>('forecasting.decision', ['number', 'month', 'store', 'scope_level', 'scope_name', 'weeks', 'decision', 'decided_by', 'decided_by_role', 'note', 'decided_on']),
        listAll<QuestionRow>('forecasting.review_question', ['ref', 'month', 'scope', 'question', 'detail', 'asked_by', 'asked_on', 'answer', 'answered_by', 'answered_on', 'outcome', 'impact', 'follow_up', 'idea_ref', 'follow_up_on']),
        listAll<IdeaRow>('forecasting.idea', ['ref', 'label', 'title', 'kind', 'raised_by', 'raised_on', 'why', 'tried', 'found', 'verdict', 'outcome', 'status_note', 'decided_on', 'revisit', 'areas', 'evidence', 'decided_by', 'reason', 'revisit_on', 'related', 'question_ref']),
        listAll<IdeaChange>('forecasting.idea_history', ['idea', 'changed_by', 'changed_on', 'change']),
        listAll<ReviewNote>('forecasting.review_note', ['question', 'kind', 'by', 'on', 'text', 'from_outcome', 'to_outcome']),
        listAll<ExplanationRow>('forecasting.explanation', ['month', 'store', 'scope_level', 'scope_name', 'day', 'causes', 'note', 'explained_by', 'explained_by_role', 'explained_on'])])
      // A Currency column comes back as text ("750000.00"); the pages add and compare it.
      setData({ numbers: numbers.map(n => ({ ...n, value: Number(n.value), percent: n.percent == null ? null : Number(n.percent) })), decisions, questions, ideas, ideaHistory, reviewNotes, explanations }); setFailed(false)
    } catch (e) {
      if ((e as { status?: number }).status === 401) window.location.href = `/featherbase/login?next=${encodeURIComponent(location.pathname + location.search)}`
      setFailed(true)
    }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const pick = (id: string) => {
    setViewerId(id)
    try { localStorage.setItem('fc_viewer', id) } catch { /* private window */ }
    const q = new URLSearchParams(window.location.search); q.set('as', id); history.replaceState(null, '', `?${q}`)
  }

  const ctx: Ctx | null = data ? { data, viewer, month, reload, save: saveRow } : null
  // My Numbers' count of updates not yet seen; opening the page marks them seen and redraws the sidebar.
  const [, setSeen] = useState(0)
  return (
    <div className="fc-shell">
      <Sidebar current={view} waiting={data ? waitingFor(data, viewer).length : 0} news={data ? unseenFor(data, viewer).length : 0} />
      <main key={moves} className="fc-page" data-testid={`page-${view}`}>
        {offChart ? <Card><EmptyState title="You are not on the forecasting org chart" body={`${offChart} has no store, section or merchandise to review in this month's Run. If that is wrong, your job or merchandise assignment needs setting up in Featherbase.`} /></Card> : <>
        {/* My Section is the screen as agreed (#1419): no picker bar above it for the person it belongs to. */}
        {!(view === 'section' || view === 'attention' || view === 'days' || view === 'unassigned' || view === 'sections') && <ViewingAs viewer={viewer} onChange={pick} month={month} onMonth={chooseMonth} signedIn={!!me} />}
        {failed ? <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." action={<Button onClick={() => void reload()}>Try again</Button>} /></Card>
          : !ctx ? <Skeleton label="Opening Forecasting" lines={6} />
            : view === 'unassigned' ? <UnassignedPage store={params.get('store') || viewer.place.split(' · ')[0]} href={line => address('unassigned', { line, ...(params.get('store') ? { store: params.get('store')! } : {}) })} />
            : view === 'sections' || ((view === 'section' || view === 'attention' || view === 'days') && !me && !asSection) ? <StorePage store={params.get('store')}
              sectionHref={(store, s) => address(view === 'attention' || view === 'days' ? view : 'section', { store, section: s.section, ...(s.teamLeaders[0] ? { tl: s.teamLeaders[0] } : {}) })}
              noSectionHref={store => address('unassigned', { store })} onStore={store => { history.pushState(null, '', address('sections', { store })); window.dispatchEvent(new PopStateEvent('popstate')) }} />
            : view === 'section' ? <SectionPage key={`${asSection ? asSection.place : viewer.id}|${params.get('month') ?? ''}`} viewer={asSection ?? viewer} month={params.get('month')}
              sectionHref={asSection ? (store, s) => address('section', { store, section: s.section, ...(s.teamLeaders[0] ? { tl: s.teamLeaders[0] } : {}) }) : undefined}
              storeHref={store => address('sections', { store })}
              href={line => address('section', { line, ...(params.get('month') ? { month: params.get('month')! } : {}), ...(asSection ? { store: params.get('store')!, section: params.get('section')!, ...(params.get('tl') ? { tl: params.get('tl')! } : {}) } : {}) })} />
            : view === 'attention' ? <AttentionPage key={asSection ? asSection.place : viewer.id} viewer={asSection ?? viewer}
              reviewHref={(line, band) => `${address('section', sectionInAddress())}#${new URLSearchParams({ open: line, ...(band ? { band } : {}) })}`}
              onReview={href => { history.pushState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate')) }} />
            : view === 'days' ? <DayReviewPage key={asSection ? asSection.place : viewer.id} viewer={asSection ?? viewer}
              href={line => address('section', { line, ...sectionInAddress() })} monthHref={address('section', sectionInAddress())} />
            : view === 'forecasts' ? (DATASET ? <ReviewMonthPage ctx={ctx} /> : <WorkspacePage ctx={ctx} />)
              : view === 'numbers' ? <NumbersPage ctx={ctx} />
              : view === 'mine' ? <MyNumbersPage key={viewer.id} ctx={ctx} onSeen={() => setSeen(t => t + 1)} />
                : view === 'runs' ? <RunsPage ctx={ctx} />
                  : view === 'results' ? <ResultsPage ctx={ctx} />
                  : view === 'charts' ? <ChartsPage key={month.key} ctx={ctx} />
                    : view === 'review' ? <ReviewPage ctx={ctx} />
                      : <IdeasPage ctx={ctx} />}</>}
      </main>
    </div>
  )
}
