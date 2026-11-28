// Day Review for a Store Manager (their store, by floor › section) and RB (the region, by store › section) (#4935):
// the Team Leader's Day Review (shared/DayReview.tsx) with levels above the subcategories, in the latest official Run
// whose month has started. A Store Manager explains a section's day or a subcategory's at their store; RB reads the
// explanations. A region arrives store by store; the page works from the first.
// /forecasting/?view=days&reach=store&store=LKS · ?view=days&reach=region&region=Kerala
import { useEffect, useMemo, useState } from 'react'
import { Card, EmptyState, PageHeader, RecordLink, RecordPagesProvider, Select, Skeleton, StatusPill } from '@featherbase/shop-floor'
import { saveRow } from '../api'
import { PARTS, day as dayText, inr, monthOfRun, pc } from '../shared/model'
import { addsOf } from '../shared/built'
import { HowBuilt } from '../shared/HowBuilt'
import { DayReview, type DayAt, type DayLevel, type ExplainDraft } from '../shared/DayReview'
import type { DayExplanation, SubDays } from '../shared/days'
import { NO_SECTION } from '../teamLeader/live'
import { eachStore, loadExplanations, loadStoreDays, planOf, type Reach, type ReachPlan, type StoreDays } from './live'
import '../shared/forecasting.css'

const go = (to: string) => { history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')) }
const SECTION: DayLevel = { name: 'Section', key: s => s.section, sub: s => s.floor ?? '', order: s => (s.floorOrder ?? 99) * 1000 }
const STORE: DayLevel = { name: 'Store', key: s => s.store ?? '', label: s => `${s.store} ${s.storeName ?? ''}`.trim() }
type Tab = 'days' | 'how'
/** The tab in the address: How it was built with &tab=how, else the days. */
const tabInAddress = (): Tab => (new URLSearchParams(window.location.search).get('tab') === 'how' ? 'how' : 'days')
/** Feather Forecast against the AOP: within 10% green, 10–20% orange, more red (the Team Leader's Day Review's bands). */
const aopTone = (fc: number, aop: number) => { const off = aop ? Math.abs(fc / aop - 1) : 1; return off < 0.1 ? 'positive' : off < 0.2 ? 'caution' : 'negative' }

export function ReachDayReviewPage({ reach, person, role, reviewHref, lineHref, at, onAt }: {
  reach: Reach; person: string; role: string
  /** The month's review for this reach (the Store Manager's or RB's), in the month being reviewed. */
  reviewHref: (month: string) => string
  /** A subcategory's record: the review with it open, in the month being reviewed. */
  lineHref: (rowId: string, month: string) => string
  /** Where the page stands (keys of its levels), kept in the address. */
  at: string[]; onAt: (path: string[]) => string
}) {
  const [plan, setPlan] = useState<ReachPlan | null | undefined>(undefined)
  const [stores, setStores] = useState<Map<string, StoreDays>>(new Map())
  const [failedStores, setFailedStores] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const [tab, setTabState] = useState<Tab>(tabInAddress)
  const setTab = (t: Tab) => {
    const q = new URLSearchParams(window.location.search)
    if (t === 'how') q.set('tab', t); else q.delete('tab')
    history.replaceState(null, '', `?${q}`)
    setTabState(t)
  }
  // where the page stands, shared by the days and How it was built: the levels gone down, and one subcategory or none
  const [path, setPath] = useState<string[]>(at)
  const [sub, setSub] = useState('')
  useEffect(() => {
    let live = true
    planOf(reach, 'started').then(p => {
      if (!live) return
      setPlan(p)
      if (!p) return
      const days = monthOfRun(p.month).days
      // the store the address names goes first, so a link into one store of a region opens at once
      const first = reach.kind === 'region' && at[0] ? [...p.stores].sort((a, b) => Number(b.store === at[0]) - Number(a.store === at[0])) : p.stores
      void eachStore(first, s => loadStoreDays(s, days), (s, got, bad) => {
        if (!live) return
        if (got) setStores(m => new Map(m).set(s.store, got)); else if (bad) setFailedStores(f => [...f, s.store])
      }, 3)
    }, () => live && setFailed(true))
    return () => { live = false }
  }, [reach.kind === 'store' ? reach.store : reach.region])

  const subs = useMemo(() => [...stores.values()].flatMap(d => d.subs), [stores])
  const rowIds = useMemo(() => new Map([...stores.values()].flatMap(d => [...d.rowIds])), [stores])
  const byRow = useMemo(() => new Map([...rowIds].map(([id, row]) => [row, id])), [rowIds])
  const explanations = useMemo(() => [...stores.values()].flatMap(d => d.explanations.map(e => ({ ...e, store: d.store.store }))), [stores])

  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." /></Card>
  if (plan === undefined) return <Skeleton label={reach.kind === 'store' ? "Opening the store's days" : "Opening the region's days"} lines={10} />
  if (!plan) return <Card><EmptyState title="No days to look at yet" body={`No official Run for a month that has started is loaded for ${reach.kind === 'store' ? reach.store : reach.region}.`} /></Card>
  // a link into one store of a region waits for that store; otherwise the first to arrive opens the page
  const wanted = reach.kind === 'region' && at[0] && plan.stores.some(s => s.store === at[0]) && !failedStores.includes(at[0]) ? at[0] : null
  const first = wanted ? (stores.has(wanted) ? plan.stores.find(s => s.store === wanted) : undefined) : plan.stores.find(s => stores.has(s.store))
  if (!first) return <Skeleton label={`Reading ${plan.stores[0].store} ${plan.stores[0].name}'s days`} lines={10} />

  const m = monthOfRun(plan.month), month = { ...m, index: Number(plan.month.slice(5, 7)) - 1 }, monthKey = plan.month.slice(0, 7)
  const region = reach.kind === 'region'
  const levels = region ? [STORE, SECTION] : [SECTION]
  const rootName = region ? reach.region : `${first.store} ${first.name}`
  // who the page speaks as: the person named, else the store's Store Manager today (the org chart)
  const speaker = region || person !== 'Store Manager' ? person : stores.get(first.store)?.org.storeManagers[0] ?? person
  const salesTo = [...stores.values()].reduce<string | null>((a, d) => (d.salesTo && (!a || d.salesTo > a) ? d.salesTo : a), null)

  // where a day is explained: a section's day (no subcategory) or a subcategory's, at its store
  const explainedHere = (d: number, a: DayAt): DayExplanation | undefined => {
    const deepest = a.path.length === levels.length || !!a.sub
    if (!deepest || !a.members.length) return undefined
    const s0 = a.members[0]
    return explanations.filter(e => e.day === d && e.store === s0.store && e.section === s0.section && e.subcategory === (a.sub?.name ?? null))
      .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0]
  }
  const count = (d: number, members: SubDays[]) => {
    const places = new Set(members.map(s => `${s.store}|${s.section}`))
    return explanations.filter(e => e.day === d && places.has(`${e.store}|${e.section}`)).length
  }
  // a Store Manager explains their store's sections and subcategories; a section the org chart places nowhere can't be
  const canExplain = (a: DayAt) => !region && (a.path.length === levels.length || !!a.sub) && a.members[0]?.section !== NO_SECTION
  const save = async (d: ExplainDraft, replacing: DayExplanation | undefined, a: DayAt) => {
    const s0 = a.members[0], got = stores.get(s0.store ?? '')!
    const mine = replacing && replacing.by === speaker ? { row_id: replacing.id, updated_at: replacing.updatedAt } : {}
    await saveRow('forecasting.day_explanation', { ...mine, run_id: got.store.run.run_id, store_code: got.store.storeCode, section_name: s0.section, subcategory_name: d.subcategory,
      explained_date: `${monthKey}-${String(d.day).padStart(2, '0')}`, direction: d.direction, causes: d.causes.join('\n'), tags: d.tags.join('\n'), note: d.note, explained_by: speaker })
    const fresh = await loadExplanations(got.store)
    setStores(m => new Map(m).set(got.store.store, { ...got, explanations: fresh }))
  }
  const arrived = stores.size, of = plan.stores.length
  const note = region && arrived + failedStores.length < of ? `${arrived} of ${of} stores in; the rest are arriving`
    : failedStores.length ? `${failedStores.join(', ')} couldn't be read` : undefined
  const review = reviewHref(monthKey)

  /** How it was built for where the page stands (the same place as the days), with a choice of what is in view. */
  const Built = () => {
    const inPath = subs.filter(x => path.every((k, i) => levels[i].key(x) === k))
    const inView = sub ? inPath.filter(x => x.id === sub) : inPath
    const built = inView.map(x => [...stores.values()].find(d => d.store.store === x.store)?.built.get(x.id ?? '')).filter(Boolean) as { fc: number; aop: number; bases: { code: string; adds: number }[] }[]
    const fc = built.reduce((t, b) => t + b.fc, 0), aop = built.reduce((t, b) => t + b.aop, 0)
    const labelOf = (d: number) => levels[d].label?.(inPath[0]) ?? levels[d].key(inPath[0])
    const where = sub ? inView[0]?.name ?? rootName : path.length ? labelOf(path.length - 1) : rootName
    const next = !sub && path.length < levels.length ? levels[path.length] : null
    const kids = next ? [...new Map(inPath.map(x => [next.key(x), x])).values()].sort((a, b) => (next.order?.(a) ?? 0) - (next.order?.(b) ?? 0) || next.key(a).localeCompare(next.key(b))) : []
    const enc = (p: string[], s2 = '') => JSON.stringify([p, s2])
    return <HowBuilt fc={fc} adds={addsOf(built as never)} month={m.name} otherLabel={PARTS.find(p => p.key === 'adj')!.label} onDays={() => setTab('days')}
      title={<>How Feather Forecast reached {inr(fc)} for {where}</>}
      facts={<>{path.map((_, i) => labelOf(i)).join(' · ') || rootName} · Forecast {inr(fc)} · {aop ? <>AOP {inr(aop)} <StatusPill tone={aopTone(fc, aop)}>{pc(fc, aop)}</StatusPill></> : 'no AOP'} · {inView.length} {inView.length === 1 ? 'subcategory' : 'subcategories'}</>}
      picker={<Select aria-label="Whose figure" value={enc(path, sub)} onChange={e => { const [p, s2] = JSON.parse(e.target.value) as [string[], string]; setPath(p); setSub(s2); history.replaceState(null, '', onAt(p)) }}>
        <option value={enc([])}>{rootName} ({region ? 'region' : 'store'})</option>
        {path.map((_, i) => <option key={i} value={enc(path.slice(0, i + 1))}>{labelOf(i)}</option>)}
        {kids.map(k => <option key={next!.key(k)} value={enc([...path, next!.key(k)])}>{'\u2003'}{next!.label?.(k) ?? next!.key(k)}</option>)}
        {path.length === levels.length && inPath.map(x => <option key={x.id} value={enc(path, x.id ?? x.name)}>{'\u2003'}{x.name}</option>)}
      </Select>} />
  }

  return (
    <RecordPagesProvider pageFor={(table, rowId) => (table === 'forecasting.forecast_line_month' && byRow.has(rowId) ? lineHref(rowId, monthKey) : undefined)}>
      <div className="flex flex-col" data-testid="reach-day-review-page">
        <PageHeader title={<>{region ? reach.region : <RecordLink table="Site" rowId={first.store} name={first.store} href={`?${new URLSearchParams({ view: 'sections', store: first.store })}`} onNavigate={go} />} · {m.label}, day by day</>}
          count={region ? `${of} stores` : undefined}
          status={`${speaker} · ${role} · sales to ${salesTo ? dayText(salesTo) : '—'} · before tax`} />
        {/* the underlined tab row the Team Leader's Day Review uses: one look on every forecasting page */}
        <div className="fr-tabs mt-4" role="tablist" aria-label="Day review">
          {([['month', 'Review the month'], ['days', 'Days'], ['how', 'How it was built']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => (id === 'month' ? go(review) : setTab(id))}>{label}</button>))}
        </div>
        <div className="mt-4">{tab === 'days'
          ? <DayReview section={rootName} rootKind={region ? 'region' : 'store'} subs={subs} month={month} explanations={[]} rowIdOf={id => rowIds.get(id)}
            onSave={save} monthLink={{ label: m.name, href: review }} levels={levels} initialPath={path} initialScope={sub} onScope={setSub}
            onPath={p => { setPath(p); setSub(''); history.replaceState(null, '', onAt(p)) }}
            pathHref={onAt} explainedFor={explainedHere} canExplain={canExplain} explainedCount={count} note={note} />
          : <Built />}</div>
      </div>
    </RecordPagesProvider>
  )
}
