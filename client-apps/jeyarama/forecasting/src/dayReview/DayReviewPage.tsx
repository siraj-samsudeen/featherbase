// Day Review (#1425): a Team Leader's section, day by day, in the latest official Run whose month has started
// (November until 30-Nov, December from 1-Dec), and their explanations of the days that went more than 10% off.
// /forecasting/?view=days (an administrator adds &store=<store>&section=<section>&tl=<name>)
import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, PageHeader, RecordPagesProvider, Skeleton } from '@featherbase/shop-floor'
import { listWhere, saveRow } from '../api'
import { NO_SECTION, officialRuns, orgOf, type Viewer } from '../teamLeader/live'
import { day as dayText, monthOfRun, type RunRow } from '../shared/model'
import { ACTUALS_DAY_FIELDS, DAY_EXPLANATION_FIELDS, FORECAST_DAY_FIELDS, explanationOf, loadedTo, subDaysFrom,
  type ActualsDayRow, type DayExplanation, type DayExplanationRow, type ForecastDayRow, type SubDays } from '../shared/days'
import { DayReview, type DayMonth, type ExplainDraft } from '../shared/DayReview'
import '../shared/forecasting.css'

/** Today in India, YYYY-MM-DD. */
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

interface Days { run: RunRow; storeCode: string; store: string; section: string; month: DayMonth & { label: string }; subs: SubDays[]; rowIds: Map<string, string>
  explanations: DayExplanation[]; salesTo: string | null }

/** The latest official Run whose month has started, and the viewer's section in it, with its days and explanations. */
async function loadDays(viewer: Viewer): Promise<Days | null> {
  const [store, section] = viewer.place.split(' · ')
  if (!section) return null
  const today = todayIST()
  const run = (await officialRuns()).find(r => r.horizon_from.slice(0, 10) <= today)
  if (!run) return null
  // the section's subcategories today, from the live org chart
  const org = await orgOf(store), at0 = org.sections.find(s => s.name === section)
  const inSection = (code: string) => (section === NO_SECTION ? !org.sections.some(s => s.id === org.subcategories[code]?.section) : !!at0 && org.subcategories[code]?.section === at0.id)
  const lines = (await listWhere<{ row_id: string; store_code: string; category_name: string; subcategory_name: string; subcategory_code: string }>('forecasting.forecast_line_month',
    ['store_code', 'category_name', 'subcategory_name', 'subcategory_code'], [['run_id', '=', run.run_id], ['store_short_code', '=', store]])).filter(l => inSection(l.subcategory_code))
  if (!lines.length) return null
  const storeCode = lines[0].store_code, codes = lines.map(l => l.subcategory_code)
  const at = [['run_id', '=', run.run_id], ['store_code', '=', storeCode], ['subcategory_code', 'in', codes]] as [string, string, unknown][]
  const [fc, sold, said] = await Promise.all([
    listWhere<ForecastDayRow>('forecasting.forecast_line_day', FORECAST_DAY_FIELDS, at),
    listWhere<ActualsDayRow>('forecasting.actuals_day', ACTUALS_DAY_FIELDS, at),
    listWhere<DayExplanationRow>('forecasting.day_explanation', DAY_EXPLANATION_FIELDS, [['run_id', '=', run.run_id], ['store_code', '=', storeCode], ['section_name', '=', section]]),
  ])
  const m = monthOfRun(run.horizon_from), month = { ...m, index: Number(run.horizon_from.slice(5, 7)) - 1 }
  const upTo = loadedTo(sold, run.horizon_from)
  const asOf = sold.reduce<string | null>((a, r) => (r.actuals_as_of_date && (!a || r.actuals_as_of_date > a) ? r.actuals_as_of_date.slice(0, 10) : a), null)
  return { run, storeCode, store, section, month,
    subs: subDaysFrom(lines.map(l => ({ name: l.subcategory_name, code: l.subcategory_code, category: l.category_name, section })), fc, sold, storeCode, month.days, upTo)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    rowIds: new Map(lines.map(l => [l.subcategory_name, l.row_id])), explanations: said.map(explanationOf), salesTo: asOf }
}

export function DayReviewPage({ viewer, href }: { viewer: Viewer; href: (line: string) => string }) {
  const [days, setDays] = useState<Days | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => loadDays(viewer).then(setDays, () => setFailed(true)), [viewer.name, viewer.place])
  useEffect(() => { setDays(undefined); void load() }, [load])
  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." /></Card>
  if (days === undefined) return <Skeleton label="Opening your section's days" lines={10} />
  if (!days) return <Card><EmptyState title="No days to look at yet"
    body={viewer.place.includes(' · ') ? `No official Run for a month that has started is loaded for ${viewer.place}.` : `${viewer.name} looks after ${viewer.place}, not one section. Day Review is the Team Leader's.`} /></Card>

  // a later explanation replaces the writer's own earlier one; anyone else's stays, and theirs is added
  const save = async (d: ExplainDraft, replacing?: DayExplanation) => {
    const mine = replacing && replacing.by === viewer.name ? { row_id: replacing.id, updated_at: replacing.updatedAt } : {}
    await saveRow('forecasting.day_explanation', { ...mine, run_id: days.run.run_id, store_code: days.storeCode, section_name: days.section, subcategory_name: d.subcategory,
      explained_date: `${days.run.horizon_from.slice(0, 7)}-${String(d.day).padStart(2, '0')}`, direction: d.direction, causes: d.causes.join('\n'), tags: d.tags.join('\n'), note: d.note, explained_by: viewer.name })
    await load()
  }
  const byRow = new Map([...days.rowIds].map(([name, id]) => [id, name]))
  return (
    <RecordPagesProvider pageFor={(table, rowId) => (table === 'forecasting.forecast_line_month' && byRow.has(rowId) ? href(byRow.get(rowId)!) : undefined)}>
      <div className="flex flex-col" data-testid="day-review-page">
        <PageHeader title={`${days.store} · ${days.section} · ${days.month.label}, day by day`}
          status={`${viewer.name} · ${viewer.role} · sales to ${days.salesTo ? dayText(days.salesTo) : '—'} · before tax`} />
        <div className="mt-4"><DayReview section={days.section} subs={days.subs} month={days.month} explanations={days.explanations} rowIdOf={name => days.rowIds.get(name)} onSave={save} /></div>
      </div>
    </RecordPagesProvider>
  )
}
