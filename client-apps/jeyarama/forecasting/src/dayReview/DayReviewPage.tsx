// Day Review (#1425): a Team Leader's section, day by day, in the latest official Run whose month has started
// (November until 30-Nov, December from 1-Dec), and their explanations of the days that went more than 10% off.
// The same shell as the Workspace (the 26-Nov mockup): Review the month (the section's review, a link to it) · Days ·
// How it was built, the tab kept in the address (&tab=how), and the month › the scope above the days.
// /forecasting/?view=days (an administrator adds &store=<store>&section=<section>&tl=<name>)
import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, PageHeader, RecordPagesProvider, Select, Skeleton, StatusPill } from '@featherbase/shop-floor'
import { listWhere, saveRow } from '../api'
import { officialRuns, type Viewer } from '../teamLeader/live'
import { BASIS_CODES, PARTS, day as dayText, inr, monthOfRun, pc, type Base, type RunRow } from '../shared/model'
import { addsOf } from '../shared/built'
import { HowBuilt } from '../shared/HowBuilt'
import { ACTUALS_DAY_FIELDS, DAY_EXPLANATION_FIELDS, FORECAST_DAY_FIELDS, explanationOf, loadedTo, subDaysFrom,
  type ActualsDayRow, type DayExplanation, type DayExplanationRow, type ForecastDayRow, type SubDays } from '../shared/days'
import { DayReview, type DayMonth, type ExplainDraft } from '../shared/DayReview'
import '../shared/forecasting.css'

/** Today in India, YYYY-MM-DD. */
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

/** A subcategory's month for How it was built: Feather Forecast, what each base adds, and the AOP. */
interface Built { name: string; fc: number; aop: number; bases: Base[] }
interface Days { run: RunRow; storeCode: string; store: string; section: string; month: DayMonth & { label: string }; subs: SubDays[]; rowIds: Map<string, string>
  explanations: DayExplanation[]; salesTo: string | null; built: Built[] }

type Tab = 'days' | 'how'
const ADDS = BASIS_CODES.map((_, i) => `adds_value_b${i + 1}`)

/** The latest official Run whose month has started, and the viewer's section in it, with its days and explanations. */
async function loadDays(viewer: Viewer): Promise<Days | null> {
  const [store, section] = viewer.place.split(' · ')
  if (!section) return null
  const today = todayIST()
  const run = (await officialRuns()).find(r => r.horizon_from.slice(0, 10) <= today)
  if (!run) return null
  const lines = await listWhere<{ row_id: string; store_code: string; category_name: string; subcategory_name: string; forecast_value_before_tax: number | string | null } & Record<string, number | string | null>>('forecasting.forecast_line_month',
    ['store_code', 'category_name', 'subcategory_name', 'forecast_value_before_tax', ...ADDS], [['run_id', '=', run.run_id], ['store_name', '=', store], ['section_name', '=', section]])
  if (!lines.length) return null
  const storeCode = lines[0].store_code, subs = lines.map(l => l.subcategory_name)
  const at = [['run_id', '=', run.run_id], ['store_code', '=', storeCode], ['subcategory_name', 'in', subs]] as [string, string, unknown][]
  const [fc, sold, said, plans] = await Promise.all([
    listWhere<ForecastDayRow>('forecasting.forecast_line_day', FORECAST_DAY_FIELDS, at),
    listWhere<ActualsDayRow>('forecasting.actuals_day', ACTUALS_DAY_FIELDS, at),
    listWhere<DayExplanationRow>('forecasting.day_explanation', DAY_EXPLANATION_FIELDS, [['run_id', '=', run.run_id], ['store_code', '=', storeCode], ['section_name', '=', section]]),
    listWhere<{ subcategory_name: string; plan_value_before_tax: number | string | null }>('forecasting.annual_plan_line', ['subcategory_name', 'plan_value_before_tax'],
      [['store_code', '=', storeCode], ['subcategory_name', 'in', subs], ['calendar_year', '=', Number(run.horizon_from.slice(0, 4))], ['calendar_month', '=', Number(run.horizon_from.slice(5, 7))]]),
  ])
  const m = monthOfRun(run.horizon_from), month = { ...m, index: Number(run.horizon_from.slice(5, 7)) - 1 }
  const upTo = loadedTo(sold, run.horizon_from)
  const asOf = sold.reduce<string | null>((a, r) => (r.actuals_as_of_date && (!a || r.actuals_as_of_date > a) ? r.actuals_as_of_date.slice(0, 10) : a), null)
  return { run, storeCode, store, section, month,
    subs: subDaysFrom(lines.map(l => ({ name: l.subcategory_name, category: l.category_name, section })), fc, sold, storeCode, month.days, upTo)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    rowIds: new Map(lines.map(l => [l.subcategory_name, l.row_id])), explanations: said.map(explanationOf), salesTo: asOf,
    built: lines.map(l => ({ name: l.subcategory_name, fc: Number(l.forecast_value_before_tax ?? 0),
      aop: plans.filter(p => p.subcategory_name === l.subcategory_name).reduce((t, p) => t + Number(p.plan_value_before_tax ?? 0), 0),
      bases: BASIS_CODES.map((code, i) => ({ code, own: null, w: null, mw: null, adds: Number(l[ADDS[i]] ?? 0) })) })) }
}

/** The tab in the address: How it was built with &tab=how, else the days. */
const tabInAddress = (): Tab => (new URLSearchParams(window.location.search).get('tab') === 'how' ? 'how' : 'days')
/** Moves within the app, as a link does (App's in-app navigation redraws on popstate). */
const go = (to: string) => { history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')) }
/** Feather Forecast against the AOP: within 10% green, 10–20% orange, more red (the Workspace's bands). */
const aopTone = (fc: number, aop: number) => { const off = aop ? Math.abs(fc / aop - 1) : 1; return off < 0.1 ? 'positive' : off < 0.2 ? 'caution' : 'negative' }

export function DayReviewPage({ viewer, href, monthHref }: {
  viewer: Viewer; href: (line: string) => string
  /** The section's month review (the Team Leader review page): Review the month and the month in the breadcrumb open it. */
  monthHref: string
}) {
  const [tab, setTabState] = useState<Tab>(tabInAddress)
  // what is in view: the section ('') or one subcategory, shared by the days and How it was built
  const [scope, setScope] = useState('')
  const setTab = (t: Tab) => {
    const q = new URLSearchParams(window.location.search)
    if (t === 'how') q.set('tab', t); else q.delete('tab')
    history.replaceState(null, '', `?${q}`)
    setTabState(t)
  }
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
  const inView = scope ? days.built.filter(b => b.name === scope) : days.built
  const fc = inView.reduce((t, b) => t + b.fc, 0), aop = inView.reduce((t, b) => t + b.aop, 0)
  return (
    <RecordPagesProvider pageFor={(table, rowId) => (table === 'forecasting.forecast_line_month' && byRow.has(rowId) ? href(byRow.get(rowId)!) : undefined)}>
      <div className="flex flex-col" data-testid="day-review-page">
        <PageHeader title={`${days.store} · ${days.section} · ${days.month.label}, day by day`}
          status={`${viewer.name} · ${viewer.role} · sales to ${days.salesTo ? dayText(days.salesTo) : '—'} · before tax`} />
        {/* the underlined tab row the review and the 26-Nov mockup use: one look on every forecasting page */}
        <div className="fr-tabs mt-4" role="tablist" aria-label="Day review">
          {([['month', 'Review the month'], ['days', 'Days'], ['how', 'How it was built']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => (id === 'month' ? go(monthHref) : setTab(id))}>{label}</button>))}
        </div>
        <div className="mt-4">{tab === 'days'
          ? <DayReview section={days.section} subs={days.subs} month={days.month} explanations={days.explanations} rowIdOf={name => days.rowIds.get(name)} onSave={save}
            monthLink={{ label: days.month.name, href: monthHref }} initialScope={scope} onScope={setScope} />
          : <HowBuilt fc={fc} adds={addsOf(inView)} month={days.month.name} otherLabel={PARTS.find(p => p.key === 'adj')!.label} onDays={() => setTab('days')}
            title={<>How Feather Forecast reached {inr(fc)} for {scope || days.section}</>}
            facts={<>{days.store} · {days.section} · Forecast {inr(fc)} · AOP {aop ? inr(aop) : '—'} · {aop ? <StatusPill tone={aopTone(fc, aop)}>{pc(fc, aop)}</StatusPill> : 'no AOP'} · {inView.length} {inView.length === 1 ? 'subcategory' : 'subcategories'}</>}
            picker={<Select aria-label="Whose figure" value={scope} onChange={e => setScope(e.target.value)}>
              <option value="">{days.section} (section)</option>
              {days.built.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
            </Select>} />}</div>
      </div>
    </RecordPagesProvider>
  )
}
