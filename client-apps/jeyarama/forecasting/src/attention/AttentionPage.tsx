// Needs Your Attention (#1419, Siraj 28-Nov-2026): its own page under Forecasting, scoped to the viewer's section.
// It reads the section as the review does, then the section's item health, who to ask and the same items at the
// region's other stores. The open tab is kept in the address (?tab=); a finding opens the review with its subcategory
// and band open (#open=…&band=…). /forecasting/?view=attention
import { useEffect, useState } from 'react'
import { Card, EmptyState, PageHeader, Skeleton } from '@featherbase/shop-floor'
import { loadFindings, loadSection, type Section, type Viewer } from '../teamLeader/live'
import { NeedsAttention } from '../shared/Attention'
import type { Finding } from '../shared/findings'
import { day } from '../shared/model'
import '../shared/forecasting.css'

export function AttentionPage({ viewer, reviewHref, onReview }: {
  viewer: Viewer
  /** The review with a subcategory, and its band, open. */
  reviewHref: (line: string, band: string | null) => string
  onReview: (href: string) => void
}) {
  const [page, setPage] = useState<{ section: Section | null; found: Awaited<ReturnType<typeof loadFindings>> } | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<string | null>(() => new URLSearchParams(window.location.search).get('tab'))
  useEffect(() => {
    setPage(undefined)
    loadSection(viewer).then(async section => setPage({ section, found: section ? await loadFindings(section) : null }), () => setFailed(true))
  }, [viewer.name, viewer.place])
  const chooseTab = (t: string) => {
    setTab(t)
    const q = new URLSearchParams(window.location.search); q.set('tab', t)
    history.replaceState(null, '', `?${q}`)
  }

  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." /></Card>
  if (page === undefined) return <Skeleton label="Finding what needs your attention" lines={8} />
  const { section, found } = page
  if (!section) return <Card><EmptyState title="No section to look at yet"
    body={viewer.place.includes(' · ') ? `Feather Forecast's next official Run for ${viewer.place} is not loaded yet.` : `${viewer.name} looks after ${viewer.place}, not one section. Needs Your Attention is the Team Leader's.`} /></Card>
  const h = section.header
  const href = (f: Finding) => reviewHref(f.line, f.band)
  return (
    <div className="flex flex-col" data-testid="attention-page">
      <PageHeader title={`${h.store} · ${h.section} · Needs Your Attention`}
        status={`${h.person} · ${h.role} · ${h.month.label} · sales to ${found?.salesTo ? day(found.salesTo) : '—'} · stock as of ${found?.stockAsOf ? day(found.stockAsOf) : h.stockAsOf ? day(h.stockAsOf) : '—'}`} />
      {found ? <NeedsAttention findings={found.findings} header={h} othersAsOf={found.othersAsOf} tab={tab} onTab={chooseTab} href={href} onOpen={f => onReview(href(f))} />
        : <Card className="mt-4"><EmptyState title="Nothing to check yet" body={`The item stock for ${h.store} is not loaded with this Run, so nothing can be checked yet.`} /></Card>}
    </div>
  )
}
