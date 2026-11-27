// Subcategories in no section (#1419): the official Run's subcategories at a store that the org chart places in
// no section, so no Team Leader reviews them. One table in the review's own look, largest Feather Forecast first.
// A subcategory's name opens how Feather Forecast got its number, here; "Assign section" opens the org chart's
// new Section Subcategory row, prefilled, in production Featherbase, because the fix belongs to the org chart and
// never to the copy of the Run. /forecasting/?view=unassigned&store=<store>
import { useEffect, useState } from 'react'
import { Card, EmptyState, Notice, PageHeader, RecordLink, RecordPagesProvider, Skeleton } from '@featherbase/shop-floor'
import { NO_SECTION, loadSection, type Section } from '../teamLeader/live'
import { combine, storeStepOf, type Line } from '../shared/model'
import { MeasureTable } from '../shared/MeasureTable'
import { LinePanel } from '../shared/LinePanel'
import { DEFAULT_VIEW } from '../shared/ReviewToolbar'
import '../shared/forecasting.css'

/** Where the org chart is kept: production Featherbase for the JeyaRama instance. */
const ORG_CHART = 'https://dash.jeyarama.com'

/** Today's date in India, YYYY-MM-DD. */
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

/** The org chart's id for a re-placed row, `<store>-<code>-<starts on>`, with -2, -3 … when that one is taken. */
export function newRowId(store: string, code: string, startsOn: string, taken: string[] = []) {
  const base = `${store}-${code}-${startsOn}`
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`
}

/** What the org chart's new Section Subcategory row starts with: store, subcategory, its id, the suggested section
 *  (blank when nothing suggests one), today, and where the row came from. */
export function assignPrefill(store: string, l: Pick<Line, 'code' | 'suggestedSection' | 'sectionRowIds'>, today = todayIST()) {
  const [y, m, d] = today.split('-')
  return {
    store,
    ...(l.code ? { subcategory: l.code, section_subcategory_id: newRowId(store, l.code, today, l.sectionRowIds) } : {}),
    ...(l.suggestedSection ? { section: l.suggestedSection } : {}),
    starts_on: today,
    source_key: `Forecasting No Section page, ${d}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]}-${y}`,
  }
}

/** The org chart's new-row form, prefilled (#100): /featherbase/admin/table/<table>/new?prefill=<JSON>. Spaces are
 *  written %20, never +, which Featherbase's router would keep as a plus sign. */
export const assignHref = (store: string, l: Pick<Line, 'code' | 'suggestedSection' | 'sectionRowIds'>) =>
  `${ORG_CHART}/featherbase/admin/table/section-subcategory/new?prefill=${encodeURIComponent(JSON.stringify(assignPrefill(store, l)))}`

export function UnassignedPage({ store, href }: { store: string; href: (line: string) => string }) {
  const [section, setSection] = useState<Section | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(window.location.search).get('line'))
  useEffect(() => {
    loadSection({ name: '', role: '', place: `${store} · ${NO_SECTION}` }).then(setSection, () => setFailed(true))
  }, [store])
  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." /></Card>
  if (section === undefined) return <Skeleton label="Opening the subcategories in no section" lines={8} />
  if (!section) return <Card><EmptyState title={`Every subcategory at ${store} has a section`} body="Each one is reviewed by its section's Team Leader." /></Card>
  const lines = [...section.lines].sort((a, b) => b.fc - a.fc)
  const byRow = new Map(lines.map(l => [l.rowId, l.name]))
  const toggle = (name: string | null) => {
    setOpen(name)
    const q = new URLSearchParams(window.location.search)
    if (name) q.set('line', name); else q.delete('line')
    history.replaceState(null, '', `?${q}`)
  }
  // the hover says which section is suggested and why, or that the form leaves Section for the person to pick
  const assign = (l: Line) => <a className="fr-link ml-2" href={assignHref(section.header.store, l)} target="_blank" rel="noopener"
    title={l.suggestedSectionNote ?? `Nothing on the org chart suggests a section for ${l.name}: pick one on the form.`} onClick={e => e.stopPropagation()}>Assign section</a>
  return (
    <RecordPagesProvider pageFor={(table, rowId) => (table === 'forecasting.forecast_line_month' && byRow.has(rowId) ? href(byRow.get(rowId)!) : undefined)}>
      <div className="fr flex flex-col gap-4" data-testid="unassigned-subcategories">
        <PageHeader title={`${section.header.store} · Subcategories in No Section · ${section.header.month.label}`}
          count={`${lines.length} subcategories`} status={`sales to ${section.header.cutOff} · before tax`} />
        <Notice>These subcategories belong to no section on the org chart, so no Team Leader reviews them. Assign them in Section Subcategory.</Notice>
        <MeasureTable header={section.header} view={{ ...DEFAULT_VIEW, measure: 'vq', aop: true }} open={open} onToggle={toggle}
          total={combine(lines, -1, 'Total')} totalLabel="Total"
          panel={(row, width) => <LinePanel item={row.item} header={section.header} storeStep={storeStepOf(lines)} aop width={width} onHelp={() => {}}
            answer={!('members' in row.item) ? <><h4>Who reviews it</h4><p className="text-[13px]">Nobody yet: it is in no section at {section.header.store}.{' '}
              {assign(row.item as Line)}</p></> : null} />}
          rows={lines.map(l => ({ key: l.name, item: l, note: <span style={{ color: 'var(--color-ink-muted)' }}>{l.path}</span>,
            label: <RecordLink table="forecasting.forecast_line_month" rowId={l.rowId} name={l.name} onNavigate={() => {}} />, after: assign(l) }))} />
      </div>
    </RecordPagesProvider>
  )
}
