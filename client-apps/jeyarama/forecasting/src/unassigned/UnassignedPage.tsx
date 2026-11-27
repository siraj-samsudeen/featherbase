// Subcategories in no section (#1419): the official Run's subcategories at a store that the org chart places in
// no section, so no Team Leader reviews them. One table in the review's own look, largest Feather Forecast first,
// with the way to fix it (Section Subcategory). /forecasting/?view=unassigned&store=<store>
import { useEffect, useState } from 'react'
import { Card, EmptyState, Notice, PageHeader, RecordLink, Skeleton } from '@featherbase/shop-floor'
import { loadSection, type Section } from '../teamLeader/live'
import { combine } from '../shared/model'
import { MeasureTable } from '../shared/MeasureTable'
import { DEFAULT_VIEW } from '../shared/ReviewToolbar'
import '../shared/forecasting.css'

/** The section name the copy gives a subcategory that the org chart places in no section. */
export const NO_SECTION = 'Not placed in a section'

export function UnassignedPage({ store }: { store: string }) {
  const [section, setSection] = useState<Section | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    loadSection({ name: '', role: '', place: `${store} · ${NO_SECTION}` }).then(setSection, () => setFailed(true))
  }, [store])
  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." /></Card>
  if (section === undefined) return <Skeleton label="Opening the subcategories in no section" lines={8} />
  if (!section) return <Card><EmptyState title={`Every subcategory at ${store} has a section`} body="Each one is reviewed by its section's Team Leader." /></Card>
  const lines = [...section.lines].sort((a, b) => b.fc - a.fc)
  return (
    <div className="fr flex flex-col gap-4" data-testid="unassigned-subcategories">
      <PageHeader title={`${section.header.store} · Subcategories in No Section · ${section.header.month.label}`}
        count={`${lines.length} subcategories`} status={`sales to ${section.header.cutOff} · before tax`} />
      <Notice>These subcategories belong to no section on the org chart, so no Team Leader reviews them. Assign them in Section Subcategory.</Notice>
      <MeasureTable header={section.header} view={{ ...DEFAULT_VIEW, measure: 'vq', aop: true }} open={null} onToggle={() => {}} panel={() => null}
        total={combine(lines, -1, 'Total')} totalLabel="Total"
        rows={lines.map(l => ({ key: l.name, item: l, opens: false, note: l.path,
          label: <RecordLink table="forecasting.forecast_line_month" rowId={l.rowId} name={l.name} /> }))} />
    </div>
  )
}
