// The Forecasting app: one frame (the shared sidebar beside the page) and eight pages, chosen by ?view=. Every page
// is built on the read-only copies of the warehouse (the Run, its days, sales) and the review Tables, and follows the
// newest official Run, so no page carries a month picker. Who a page is for comes from the live org chart (signed_in).
import { UNNAMED_TL, officialRuns } from './teamLeader/live'
import { createElement, useEffect, useState } from 'react'
import { Button, Card, EmptyState, Skeleton } from '@featherbase/shop-floor'
import { readOp } from './api'
import { SectionPage } from './teamLeader/SectionPage'
import { StoreManagerReview } from './storeManager/StoreManagerReview'
import { CategoryHeadReview } from './categoryHead/CategoryHeadReview'
import { RbReview } from './rb/RbReview'
import { ownerOf, type ChainPageProps, type SignedIn } from './shared/chainPage'
import { loadRealChain, type Chain } from './shared/chainData'
import { madeUpChain } from './shared/madeUpChain'
import { RecordPagesProvider } from '@featherbase/shop-floor'
import { UnassignedPage } from './unassigned/UnassignedPage'
import { AttentionPage } from './attention/AttentionPage'
import { DayReviewPage } from './dayReview/DayReviewPage'
import { StorePage } from './teamLeader/StorePage'
import { ReachDayReviewPage } from './reach/ReachDayReviewPage'
import { ReachAttentionPage } from './reach/ReachAttentionPage'
import type { Reach } from './reach/live'

const VIEWS = [
  { key: 'sections', label: 'Sections', group: 'Forecasts', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1' },
  { key: 'section', label: 'My Section', group: 'Forecasts', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z' },
  { key: 'attention', label: 'Needs Your Attention', group: 'Forecasts', icon: 'M12 9v4M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
  { key: 'days', label: 'Day Review', group: 'Forecasts', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { key: 'unassigned', label: 'No Section', group: 'Forecasts', icon: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' },
  { key: 'store-review', label: 'Store Manager Review', group: 'Forecasts', icon: 'M3 10 12 3l9 7v11H3zM9 21v-7h6v7' },
  { key: 'category-review', label: 'Category Review', group: 'Forecasts', icon: 'M3 3h18v18H3zM3 9h18M9 9v12' },
  { key: 'rb-review', label: 'RB Review', group: 'Forecasts', icon: 'M3 3v18h18M8 17v-4m5 4V9m5 8V6' },
] as const
type View = typeof VIEWS[number]['key']

export const address = (view: View, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(window.location.search)
  q.set('view', view)
  q.delete('month')
  for (const k of ['store', 'section', 'tab', 'dview', 'day', 'rows', 'line', 'tl', 'reach', 'region', 'at']) q.delete(k)
  for (const [k, v] of Object.entries(extra)) q.set(k, v)
  return `?${q}`
}

/** The section an administrator is looking at (?store&section&tl), which Needs Your Attention keeps: it is that section's. */
const sectionInAddress = () => {
  const q = new URLSearchParams(window.location.search), out: Record<string, string> = {}
  for (const k of ['store', 'section', 'tl']) { const v = q.get(k); if (v) out[k] = v }
  return out.store && out.section ? out : {}
}

/** A Store Manager's or RB's Day Review and Needs Your Attention (#4935): ?reach=store&store=LKS, ?reach=region&region=Kerala. */
const reachInAddress = (): Reach | null => {
  const q = new URLSearchParams(window.location.search)
  if (q.get('reach') === 'store' && q.get('store')) return { kind: 'store', store: q.get('store')! }
  if (q.get('reach') === 'region' && q.get('region')) return { kind: 'region', region: q.get('region')! }
  return null
}
const reachParams = (r: Reach | null): Record<string, string> => (!r ? {} : r.kind === 'store' ? { reach: 'store', store: r.store } : { reach: 'region', region: r.region })

function Sidebar({ current }: { current: View }) {
  return createElement('featherbase-sidebar', { 'aria-label': 'Forecasting navigation' },
    <span key="Forecasts" className="fc-sidebar-group">Forecasts</span>,
    ...VIEWS.map(v => (
      <a key={v.key} href={v.key === 'attention' || v.key === 'days' ? address(v.key, reachInAddress() ? reachParams(reachInAddress()) : sectionInAddress()) : address(v.key)} {...(current === v.key ? { 'aria-current': 'page' as const } : {})}>
        <svg className="max-sm:hidden" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={v.icon} /></svg>
        <span data-testid={`nav-${v.key}`}>{v.label}</span>
      </a>)))
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

/** The managers' review pages (#1419): the newest real official Run in the app's tables (a local instance loads one
 *  outside the repository), else the made-up chain; the screen as agreed, with no picker bar above it. A subcategory is
 *  kept in the address (?line=<rowId>) and its record opens here. The Run is read once and kept while the app is open. */
const CHAIN_PAGES = { 'store-review': StoreManagerReview, 'category-review': CategoryHeadReview, 'rb-review': RbReview } as const
type ChainView = keyof typeof CHAIN_PAGES
// the made-up chain only where the made-up fixture Run is installed (a development or stand-in instance, started with
// --made-up-data); an instance with no Run loaded yet (production before the first copy) says so instead of inventing one
type Loaded = { chain: Chain | 'none'; me: SignedIn | null }
/** The Run and who is signed in (#1438): the page opens for that person, matched on the org chart by Employee row. */
let meLoad: Promise<SignedIn | null> | null = null
/** Who is signed in, or null when that couldn't be told: the page then opens for nobody (fails closed). */
const loadMe = () => (meLoad ??= readOp<SignedIn>('signed_in').catch(() => { meLoad = null; return null }))
// one load per month: the newest Run's ('') or the month a link names (?month=YYYY-MM, the Day Review's "Review the month")
const chainLoads = new Map<string, Promise<Loaded>>()
const loadChain = (month = '') => {
  if (!chainLoads.has(month)) chainLoads.set(month, Promise.all([
    loadRealChain(month || null).then(async real => real
      ?? ((await officialRuns()).some(r => r.model === 'made_up') ? madeUpChain() : 'none' as const)),
    loadMe(),
  ]).then(([chain, me]) => ({ chain, me }), e => { chainLoads.delete(month); throw e }))
  return chainLoads.get(month)!
}
function ChainPage({ view }: { view: ChainView }) {
  const Page = CHAIN_PAGES[view]
  const [loaded, setLoaded] = useState<{ chain: Chain | 'none'; me: SignedIn | null } | null>(null)
  const [failed, setFailed] = useState(false)
  const month = new URLSearchParams(window.location.search).get('month') ?? ''
  useEffect(() => { loadChain(month).then(setLoaded, () => setFailed(true)) }, [month])
  const q = new URLSearchParams(window.location.search), line = q.get('line')
  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." action={<Button onClick={() => { setFailed(false); loadChain(month).then(setLoaded, () => setFailed(true)) }}>Try again</Button>} /></Card>
  if (!loaded) return <Skeleton label="Opening the review" lines={8} />
  const { chain, me } = loaded
  if (chain === 'none') return <Card><EmptyState title="No official Run is loaded yet" body="The month opens here once Feather Forecast's official Run is loaded." /></Card>
  const retry = () => { setLoaded(null); chainLoads.delete(month); loadChain(month).then(setLoaded, () => setFailed(true)) }
  if (!me) return <Card><EmptyState title="We couldn't tell who you are" body="The review opens for your job on the org chart, and that couldn't be read just now. Try again in a moment." action={<Button onClick={retry}>Try again</Button>} /></Card>
  // the signed-in person's own page; ?as=<Employee row> only for an administrator, as "view as"
  const owner = ownerOf(view, chain, me, q.get('as'))
  if ('missing' in owner) return <Card><EmptyState title={owner.missing.title} body={owner.missing.body} /></Card>
  const props: ChainPageProps = {
    chain, person: owner.person, admin: me.admin,
    hrefFor: l => address(view, { line: l.rowId, ...(month ? { month } : {}) }),
    openLine: line,
    // the Store Manager's and RB's Day Review and Needs Your Attention, as tabs beside the review's own (#4935)
    pagesFor: view === 'category-review' ? undefined : at => {
      const reach: Record<string, string> = 'store' in at ? { reach: 'store', store: at.store } : { reach: 'region', region: at.region }
      return [{ id: 'days', label: 'Days', href: address('days', reach) }, { id: 'attention', label: 'Needs Your Attention', href: address('attention', reach) }]
    },
    onOpenLine: rowId => {
      const q = new URLSearchParams(window.location.search)
      if (rowId) q.set('line', rowId); else q.delete('line')
      history.replaceState(null, '', `?${q}`)
    },
  }
  return (
    <RecordPagesProvider pageFor={(table, rowId) => (table === 'forecasting.forecast_line_month' ? address(view, { line: rowId, ...(month ? { month } : {}) }) : undefined)}>
      <Page {...props} />
    </RecordPagesProvider>
  )
}

export function ForecastingApp() {
  const moves = useInAppNavigation()
  const params = new URLSearchParams(window.location.search)
  // Whoever looks after the app opens any store's section as its Team Leader would see it:
  // ?view=section&store=<store>&section=<section>&tl=<name> (a loaded Run's sections are not on a chart in the app).
  const asSection = params.get('section') && params.get('store')
    ? { name: params.get('tl') || UNNAMED_TL, role: 'Team Leader', place: `${params.get('store')} · ${params.get('section')}` } : null
  const view = (VIEWS.some(v => v.key === params.get('view')) ? params.get('view') : 'sections') as View
  // a Store Manager's or RB's own Day Review and Needs Your Attention: named in the address
  const reach: Reach | null = reachInAddress()
  const reachWho = reach ? { person: reach.kind === 'store' ? 'Store Manager' : 'RB', role: reach.kind === 'store' ? 'Store Manager' : 'Chief Executive' } : null
  return (
    <div className="fc-shell">
      <Sidebar current={view} />
      <main key={moves} className="fc-page" data-testid={`page-${view}`}>
        {CHAIN_PAGES[view as ChainView] ? <ChainPage view={view as ChainView} />
          : view === 'unassigned' ? <UnassignedPage store={params.get('store') ?? ''} href={line => address('unassigned', { line, ...(params.get('store') ? { store: params.get('store')! } : {}) })} />
          : (view === 'days' || view === 'attention') && reach && reachWho ? (view === 'days'
            ? <ReachDayReviewPage key={JSON.stringify(reach)} reach={reach} {...reachWho} at={(params.get('at') ?? '').split('›').filter(Boolean)}
              onAt={p => address('days', { ...reachParams(reach), ...(p.length ? { at: p.join('›') } : {}) })}
              reviewHref={m => address(reach.kind === 'store' ? 'store-review' : 'rb-review', { ...(reach.kind === 'store' ? { store: reach.store } : {}), month: m })}
              lineHref={(rowId, m) => address(reach.kind === 'store' ? 'store-review' : 'rb-review', { ...(reach.kind === 'store' ? { store: reach.store } : {}), line: rowId, month: m })} />
            : <ReachAttentionPage key={JSON.stringify(reach)} reach={reach} {...reachWho}
              lineHref={f => address(reach.kind === 'store' ? 'store-review' : 'rb-review', { ...(f.place ? { store: f.place.store } : {}), ...(f.place?.rowId ? { line: f.place.rowId } : {}) })} />)
          : view === 'sections' || !asSection ? <StorePage store={params.get('store')}
            wholeStoreHref={view === 'attention' || view === 'days' ? store => address(view, { reach: 'store', store }) : undefined}
            sectionHref={(store, s) => address(view === 'attention' || view === 'days' ? view : 'section', { store, section: s.section, ...(s.teamLeaders[0] ? { tl: s.teamLeaders[0] } : {}) })}
            noSectionHref={store => address('unassigned', { store })} onStore={store => { history.pushState(null, '', address('sections', { store })); window.dispatchEvent(new PopStateEvent('popstate')) }} />
          : view === 'section' ? <SectionPage key={`${asSection.place}|${params.get('month') ?? ''}`} viewer={asSection} month={params.get('month')}
            sectionHref={(store, s) => address('section', { store, section: s.section, ...(s.teamLeaders[0] ? { tl: s.teamLeaders[0] } : {}) })}
            storeHref={store => address('sections', { store })}
            href={line => address('section', { line, ...(params.get('month') ? { month: params.get('month')! } : {}), store: params.get('store')!, section: params.get('section')!, ...(params.get('tl') ? { tl: params.get('tl')! } : {}) })} />
          : view === 'attention' ? <AttentionPage key={asSection.place} viewer={asSection}
            reviewHref={(line, band) => `${address('section', sectionInAddress())}#${new URLSearchParams({ open: line, ...(band ? { band } : {}) })}`}
            onReview={href => { history.pushState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate')) }} />
          : <DayReviewPage key={asSection.place} viewer={asSection}
            href={line => address('section', { line, ...sectionInAddress() })} monthHref={address('section', sectionInAddress())} />}
      </main>
    </div>
  )
}
