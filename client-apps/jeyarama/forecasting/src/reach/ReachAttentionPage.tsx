// Needs Your Attention for a Store Manager (their store, grouped by floor › section) and RB (the region, grouped by
// store) (#4935): the Team Leader's tabs and drill pane (shared/Attention.tsx) over every section of the store, or
// every store of the region, in the newest official Run. A region arrives store by store; the page works from the
// first. A finding opens the Store Manager's or RB's review with its subcategory open.
// /forecasting/?view=attention&reach=store&store=ATK · ?view=attention&reach=region&region=Kerala
import { useEffect, useMemo, useState } from 'react'
import { Card, EmptyState, PageHeader, RecordLink, Skeleton } from '@featherbase/shop-floor'
import { NeedsAttention } from '../shared/Attention'
import type { Finding } from '../shared/findings'
import { day, monthOfRun } from '../shared/model'
import type { Header } from '../shared/review'
import { eachStore, loadStoreFindings, planOf, type Reach, type ReachPlan, type StoreFindings } from './live'
import '../shared/forecasting.css'

const go = (to: string) => { history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')) }
const newest = (ds: (string | null)[]) => ds.reduce<string | null>((a, d) => (d && (!a || d > a) ? d : a), null)

export function ReachAttentionPage({ reach, person, role, lineHref }: {
  reach: Reach; person: string; role: string
  /** A finding's subcategory in the Store Manager's or RB's review, open. */
  lineHref: (f: Finding) => string
}) {
  const [plan, setPlan] = useState<ReachPlan | null | undefined>(undefined)
  const [stores, setStores] = useState<Map<string, StoreFindings | null>>(new Map())
  const [failedStores, setFailedStores] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<string | null>(() => new URLSearchParams(window.location.search).get('tab'))
  useEffect(() => {
    let live = true
    planOf(reach, 'newest').then(p => {
      if (!live) return
      setPlan(p)
      if (!p) return
      const region = p.stores.map(s => s.store)
      void eachStore(p.stores, s => loadStoreFindings(s, region), (s, got, bad) => {
        if (!live) return
        if (bad) setFailedStores(f => [...f, s.store]); else setStores(m => new Map(m).set(s.store, got))
      })
    }, () => live && setFailed(true))
    return () => { live = false }
  }, [reach.kind === 'store' ? reach.store : reach.region])
  const chooseTab = (t: string) => {
    setTab(t)
    const q = new URLSearchParams(window.location.search); q.set('tab', t)
    history.replaceState(null, '', `?${q}`)
  }
  const got = useMemo(() => [...stores.values()].filter((x): x is StoreFindings => !!x), [stores])
  const findings = useMemo(() => got.flatMap(g => g.findings), [got])

  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." /></Card>
  if (plan === undefined) return <Skeleton label="Finding what needs your attention" lines={8} />
  if (!plan) return <Card><EmptyState title="Nothing to look at yet" body={`Feather Forecast's next official Run for ${reach.kind === 'store' ? reach.store : reach.region} is not loaded yet.`} /></Card>
  const region = reach.kind === 'region', s0 = plan.stores[0]
  const m = monthOfRun(plan.month)
  if (!stores.size && !failedStores.length) return <Skeleton label={region ? `Reading ${s0.store} ${s0.name} first; the region's other stores follow` : `Reading every item at ${s0.store} ${s0.name}`} lines={8} />
  const scopeName = region ? reach.region : `${s0.store} ${s0.name}`
  const stockAsOf = newest(got.map(g => g.stockAsOf)), salesTo = newest(got.map(g => g.salesTo))
  // who the page speaks as: the person named, else the store's Store Manager today (the org chart)
  const speaker = region || person !== 'Store Manager' ? person : got[0]?.org.storeManagers[0] ?? person
  const header: Header = { store: region ? '' : s0.store, section: scopeName, person: speaker, role, cutOff: '', month: m, stockAsOf }
  const arrived = stores.size + failedStores.length, of = plan.stores.length
  const progress = region && arrived < of ? `${stores.size} of ${of} stores so far` : failedStores.length ? `${failedStores.join(', ')} couldn't be read` : undefined
  const title = region ? <>{reach.region} · Needs Your Attention</>
    : <><RecordLink table="Site" rowId={s0.store} name={s0.store} href={`?${new URLSearchParams({ view: 'sections', store: s0.store })}`} onNavigate={go} /> · Needs Your Attention</>
  return (
    <div className="flex flex-col" data-testid="reach-attention-page">
      <PageHeader title={title} count={region ? `${of} stores` : undefined}
        status={`${speaker} · ${role} · ${m.label} · sales to ${salesTo ? day(salesTo) : '—'} · stock as of ${stockAsOf ? day(stockAsOf) : '—'}`} />
      {got.length || arrived < of ? <NeedsAttention findings={findings} header={header} othersAsOf={newest(got.map(g => g.othersAsOf))} tab={tab} onTab={chooseTab}
        href={lineHref} onOpen={f => go(lineHref(f))} openLabel={region ? 'Open in RB Review' : 'Open in Store Manager Review'} over={region ? 'store' : 'section'}
        scopeName={scopeName} progress={progress} />
        : <Card className="mt-4"><EmptyState title="Nothing to check yet" body={`The item stock for ${scopeName} is not loaded with this Run, so nothing can be checked yet.`} /></Card>}
    </div>
  )
}
