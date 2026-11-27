// My Section (#1419): the Team Leader review of the viewer's own section, on the app's tables. The line open
// is kept in the address (?line=), so a link to a line, or a Comment's "take me to the place", opens it here.
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, EmptyState, RecordPagesProvider, Skeleton } from '@featherbase/shop-floor'
import { liveActions, loadSection, loadState, type Section, type Viewer } from './live'
import { storeStepOf } from './model'
import { TeamLeaderReview } from './TeamLeaderReview'

export function SectionPage({ viewer, href }: { viewer: Viewer; href: (line: string) => string }) {
  const [section, setSection] = useState<Section | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const load = useCallback(async () => {
    try { setSection(await loadSection(viewer)); setFailed(false) } catch { setFailed(true) }
  }, [viewer.name, viewer.place, viewer.role])
  useEffect(() => { setSection(undefined); void load() }, [load])
  const refresh = useCallback(async () => {
    if (!section) return
    const state = await loadState(section.run.run_id, section.storeCode, viewer.name)
    setSection(s => (s ? { ...s, state } : s))
  }, [section, viewer.name])

  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." action={<Button onClick={() => void load()}>Try again</Button>} /></Card>
  if (section === undefined) return <Skeleton label="Opening your section" lines={8} />
  if (!section) return <Card><EmptyState title="No section to review yet"
    body={viewer.place.includes(' · ') ? `Feather Forecast's next official Run for ${viewer.place} is not loaded yet. It opens here once it is.` : `${viewer.name} reviews ${viewer.place}, not one section. My Section is the Team Leader's review.`} /></Card>

  const line = new URLSearchParams(window.location.search).get('line')
  const byRow = new Map(section.lines.map(l => [l.rowId, l.name]))
  return (
    <RecordPagesProvider pageFor={(table, rowId) => (table === 'forecasting.forecast_line_month' && byRow.has(rowId) ? href(byRow.get(rowId)!) : undefined)}>
      <TeamLeaderReview header={section.header} lines={section.lines} storeStep={storeStepOf(section.lines)} state={section.state}
        actions={liveActions(section, viewer.name, () => void refresh())} hrefFor={l => href(l.name)}
        openLine={line && section.lines.some(l => l.name === line) ? line : null}
        onOpenLine={name => {
          const q = new URLSearchParams(window.location.search)
          if (name) q.set('line', name); else q.delete('line')
          history.replaceState(null, '', `?${q}`)
        }} />
    </RecordPagesProvider>
  )
}
