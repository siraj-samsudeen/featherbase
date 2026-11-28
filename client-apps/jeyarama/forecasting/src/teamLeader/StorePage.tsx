// The way into the review (#1419): a store's sections in the newest official Run, grouped by floor in building
// order, each with its Team Leaders, subcategories, Feather Forecast and how far its review has got. A row opens
// that section's review; the subcategories in no section have their own page. The search under the header (the review
// page's) narrows the rows to the sections whose name, Team Leader or a subcategory matches; Enter opens the first.
// /forecasting/?view=sections&store=<store>
import { useEffect, useState } from 'react'
import { Card, EmptyState, Field, PageHeader, RecordLink, Select, Skeleton, StatusPill, TABLE_CLASSES, cellClasses, headCellClasses } from '@featherbase/shop-floor'
import { PersonLink } from '../shared/records'
import { count, inr, sectionMatches } from '../shared/model'
import { SearchBox } from '../shared/SubcategorySearch'
import { loadStore, type SectionSummary, type StoreSummary } from './live'

/** Moves within the app, as a link does (App's in-app navigation redraws on popstate). */
const go = (href: string) => { history.pushState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate')) }

export function StorePage({ store, sectionHref, noSectionHref, onStore, wholeStoreHref }: {
  store: string | null
  /** Day Review and Needs Your Attention: the whole store's page, as its Store Manager sees it (#4935). */
  wholeStoreHref?: (store: string) => string
  sectionHref: (store: string, s: SectionSummary) => string
  noSectionHref: (store: string) => string
  onStore: (store: string) => void
}) {
  const [summary, setSummary] = useState<StoreSummary | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => { setSummary(undefined); loadStore(store).then(setSummary, () => setFailed(true)) }, [store])
  if (failed) return <Card><EmptyState title="This page couldn't load" body="Check your connection and try again." /></Card>
  if (summary === undefined) return <Skeleton label="Opening the store's sections" lines={10} />
  if (!summary) return <Card><EmptyState title="No official Run is loaded yet" body="The month opens here once Feather Forecast's official Run is loaded." /></Card>

  const items = summary.sections.map(s => ({ ...s, name: s.section, subcategories: s.subcategoryNames }))
  const shown = new Set(items.filter(s => !query.trim() || sectionMatches(s, query)).map(s => s.section))
  const floors = [...new Set(summary.sections.filter(s => shown.has(s.section)).map(s => s.floor))]
  const head = (first = false, last = false, right = false) => headCellClasses({ first, last, className: right ? 'text-right' : '' })
  const cell = (first = false, last = false, right = false) => cellClasses({ first, last, className: right ? 'text-right tabular-nums' : '' })
  return (
    <div className="flex flex-col gap-4" data-testid="store-sections">
      <PageHeader title={`${summary.store} · Sections · ${summary.month.label}`}
        count={`${summary.sections.length} sections`}
        status={`Feather Forecast, sales to ${summary.cutOff} · before tax`}
        actions={<>
          {summary.stores.length > 1 && (
            <div className="w-48"><Field label="Store"><Select value={summary.store} onChange={e => onStore(e.target.value)}>
              {summary.stores.map(s => <option key={s} value={s}>{s}</option>)}</Select></Field></div>)}
          {wholeStoreHref && <a className="text-sm font-medium text-action hover:underline" href={wholeStoreHref(summary.store)} data-testid="whole-store">The whole store</a>}
          {summary.noSection.subcategories > 0 && (
            <a className="text-sm font-medium text-action hover:underline" href={noSectionHref(summary.store)}>
              Subcategories in No Section ({summary.noSection.subcategories} · {inr(summary.noSection.fc)})</a>)}
        </>} />
      <SearchBox items={items} match={sectionMatches} query={query} onQuery={setQuery}
        onOpen={name => { const s = summary.sections.find(x => x.section === name); if (s) go(sectionHref(summary.store, s)) }}
        label="Search sections, Team Leaders or subcategories" many="sections" none={`No section, Team Leader or subcategory in ${summary.store} matches`} />
      <table className={TABLE_CLASSES}>
        <thead><tr>
          <th className={head(true)}>Section</th><th className={head()}>Team Leader</th>
          <th className={head(false, false, true)}>Subcategories</th><th className={head(false, false, true)}>Feather Forecast</th>
          <th className={head(false, true)}>Review</th>
        </tr></thead>
        <tbody>{floors.flatMap(floor => {
          const all = summary.sections.filter(s => s.floor === floor), mine = all.filter(s => shown.has(s.section))
          return [
            <tr key={`floor:${floor}`}><td colSpan={5} className="px-3 pt-4 pb-1 text-xs font-medium text-ink-muted">{floor} · {inr(all.reduce((t, s) => t + s.fc, 0))}</td></tr>,
            ...mine.map(s => {
              const href = sectionHref(summary.store, s)
              return (
                <tr key={s.section} className="group cursor-pointer" data-section={s.section} onClick={e => { if (!(e.target as HTMLElement).closest('a')) go(href) }}>
                  <td className={cell(true)}><RecordLink table="Section" rowId={s.id} name={s.section} href={href} onNavigate={go} /></td>
                  <td className={cell()}>{s.teamLeaders.length
                    ? s.teamLeaders.map((n, i) => <span key={n}>{i ? ', ' : ''}<PersonLink id={summary.people[n]} name={n} /></span>)
                    : <span className="text-ink-muted">No Team Leader</span>}</td>
                  <td className={cell(false, false, true)}>{count(s.subcategories)}</td>
                  <td className={cell(false, false, true)}>{inr(s.fc)}</td>
                  <td className={cell(false, true)}>
                    {s.reviewed === 0 ? <span className="text-ink-muted">Not started</span>
                      : s.reviewed >= s.subcategories ? <StatusPill tone="positive">All {s.subcategories} answered</StatusPill>
                        : <StatusPill tone="caution">{s.reviewed} of {s.subcategories} answered</StatusPill>}
                  </td>
                </tr>)
            }),
          ]
        })}</tbody>
      </table>
    </div>
  )
}
