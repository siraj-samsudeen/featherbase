// My Section (#1419): the Team Leader review of the viewer's own section, on the app's tables. The line open
// is kept in the address (?line=), so a link to a line, or a Comment's "take me to the place", opens it here; a
// Needs Your Attention finding links with #open=<subcategory>&band=<price band>.
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, EmptyState, RecordPagesProvider, Skeleton } from '@featherbase/shop-floor'
import { liveActions, loadSection, loadState, loadStore, type Section, type SectionSummary, type StoreSummary, type Viewer } from './live'
import { SectionSwitcher } from './SectionSwitcher'
import { storeStepOf } from '../shared/model'
import { TeamLeaderReview } from './TeamLeaderReview'

export function SectionPage({ viewer, month, href, sectionHref, storeHref }: {
  viewer: Viewer; href: (line: string) => string
  /** The month to review (YYYY-MM, from the address): that month's Run; none for the newest. */
  month?: string | null
  /** Where another section of the store opens, for the switcher; none for a Team Leader on their own section. */
  sectionHref?: (store: string, s: SectionSummary) => string
  storeHref?: (store: string) => string
}) {
  const [section, setSection] = useState<Section | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const load = useCallback(async () => {
    try { setSection(await loadSection(viewer, month)); setFailed(false) } catch { setFailed(true) }
  }, [viewer.name, viewer.place, viewer.role, month])
  useEffect(() => { setSection(undefined); void load() }, [load])
  const [store, setStore] = useState<StoreSummary | null>(null)
  useEffect(() => { if (sectionHref) loadStore(viewer.place.split(' · ')[0]).then(setStore, () => setStore(null)) }, [viewer.place, sectionHref])
  const refresh = useCallback(async () => {
    if (!section) return
    const state = await loadState(section.run, section.storeCode, section.header.person, section.lines)
    setSection(s => (s ? { ...s, state } : s))
  }, [section])

  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." action={<Button onClick={() => void load()}>Try again</Button>} /></Card>
  if (section === undefined) return <Skeleton label="Opening your section" lines={8} />
  if (!section) return <Card><EmptyState title="No section to review yet"
    body={viewer.place.includes(' · ') ? `Feather Forecast's next official Run for ${viewer.place} is not loaded yet. It opens here once it is.` : `${viewer.name} reviews ${viewer.place}, not one section. My Section is the Team Leader's review.`} /></Card>

  // a line opens from ?line=, or from #open=<subcategory>&band=<price band> (a Needs Your Attention finding)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const line = hash.get('open') ?? new URLSearchParams(window.location.search).get('line')
  const band = hash.get('open') ? hash.get('band') : null
  const byRow = new Map(section.lines.map(l => [l.rowId, l.name]))
  return (
    <RecordPagesProvider pageFor={(table, rowId) => (table === 'forecasting.forecast_line_month' && byRow.has(rowId) ? href(byRow.get(rowId)!) : undefined)}>
      <TeamLeaderReview header={section.header} lines={section.lines} storeStep={storeStepOf(section.lines)} state={section.state}
        actions={liveActions(section, viewer.name, () => void refresh())} hrefFor={l => href(l.name)}
        switcher={store && sectionHref && storeHref ? <SectionSwitcher store={store.store} current={section.header.section} sections={store.sections}
          href={s => sectionHref(store.store, s)} storeHref={storeHref(store.store)} /> : undefined}
        openLine={line && section.lines.some(l => l.name === line) ? line : null} openBand={band}
        onOpenLine={name => {
          const q = new URLSearchParams(window.location.search)
          if (name) q.set('line', name); else q.delete('line')
          history.replaceState(null, '', `?${q}`)
        }} />
    </RecordPagesProvider>
  )
}
