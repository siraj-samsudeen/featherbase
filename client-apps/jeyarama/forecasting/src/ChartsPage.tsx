// Charts: what sold against the engine, day by day, for the whole business, a region, some stores or
// some subcategories, in the month the shared top bar has chosen. A closed month shows the whole
// month; the current month shows actuals to its last day loaded in full, and a partly loaded day as
// such, never as a drop. Every figure is a sum of the same made-up days (sales.ts), so the tiles, the
// lines, the bars and the table always agree.
import { useState, type ReactNode } from 'react'
import { Card, Field, SearchInput, Segmented, Select, fmtExact, fmtINR } from '@featherbase/shop-floor'
import { ALL_STORES, CHART_SUBS, REGIONS, UPLIFT, type Sub } from './madeUp'
import { EVENTS, completeTo, daysFor, totalsTo, type DayRow } from './sales'
import { dateOf, type Month } from './months'
import { DailyChart, GapBars, Legend, bias, pct1, signedINR } from './charts'
import { NoRunYet, Page, type Ctx } from './App'

type View = 'all' | 'region' | 'stores' | 'subcategory'
const VIEWS: { value: View; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'region', label: 'Region' }, { value: 'stores', label: 'Stores' }, { value: 'subcategory', label: 'Subcategory' }]
const NAMES = [...new Set(CHART_SUBS.map(s => s.name))]
const TOPS = [3, 5, 8, 10]

interface Choice { chart: View; region: string; stores: string[]; subs: string[]; pick: 'largest' | 'search'; top: number; within: string; bars: '' | 'store' | 'subcategory' }
/** The page's choices live in the address beside ?view= and ?month=, so a link opens the same chart. */
function fromAddress(): Choice {
  const q = new URLSearchParams(window.location.search)
  const list = (k: string) => (q.get(k) ?? '').split(',').filter(Boolean)
  const chart = VIEWS.some(v => v.value === q.get('chart')) ? q.get('chart') as View : 'all'
  const stores = list('stores').filter(s => ALL_STORES.includes(s)), subs = list('subs').filter(s => NAMES.includes(s))
  return { chart, region: REGIONS.some(r => r.name === q.get('region')) ? q.get('region')! : REGIONS[0].name,
    stores: q.has('stores') ? stores : ['Lakeside', 'Hillview'], subs: q.has('subs') ? subs : ['Girls Jean', 'Men Formal Shirt'],
    pick: q.get('pick') === 'search' ? 'search' : 'largest', top: TOPS.includes(Number(q.get('top'))) ? Number(q.get('top')) : 5,
    within: q.get('within') ?? '', bars: q.get('bars') === 'store' || q.get('bars') === 'subcategory' ? q.get('bars') as Choice['bars'] : '' }
}
function toAddress(c: Choice) {
  const q = new URLSearchParams(window.location.search)
  const set = (k: string, v: string) => (v ? q.set(k, v) : q.delete(k))
  set('chart', c.chart); set('region', c.chart === 'region' ? c.region : ''); set('stores', c.chart === 'stores' ? c.stores.join(',') || ',' : '')
  set('subs', c.chart === 'subcategory' && c.pick === 'search' ? c.subs.join(',') || ',' : ''); set('pick', c.chart === 'subcategory' ? c.pick : '')
  set('top', c.chart === 'subcategory' && c.pick === 'largest' ? String(c.top) : ''); set('within', c.chart === 'subcategory' ? c.within : ''); set('bars', c.bars)
  history.replaceState(null, '', `?${q}`)
}

/** "A", "A and B", "A, B and C", "A, B, C and 3 more" */
const listText = (names: string[]) => names.length <= 1 ? names.join('') : names.length <= 4 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
const withinSubs = (within: string) => within.startsWith('region:') ? CHART_SUBS.filter(s => s.region === within.slice(7))
  : within.startsWith('store:') ? CHART_SUBS.filter(s => s.store === within.slice(6)) : CHART_SUBS
const withinText = (within: string) => within.startsWith('region:') ? `${within.slice(7)} region` : within.startsWith('store:') ? within.slice(6) : 'every store'

interface Part { key: string; title: string; subs: Sub[] }
/** What the choice draws: its title, its store × subcategory pairs, and the parts it breaks into. */
function selection(c: Choice, m: Month): { title: string; subs: Sub[]; parts: Part[]; names: string[] } {
  const byStore = (stores: string[]) => stores.map(store => ({ key: store, title: store, subs: CHART_SUBS.filter(s => s.store === store) }))
  if (c.chart === 'region') {
    const region = REGIONS.find(r => r.name === c.region)!
    return { title: `${region.name} region, ${region.stores.length} stores`, subs: CHART_SUBS.filter(s => s.region === region.name), parts: byStore(region.stores), names: [] }
  }
  if (c.chart === 'stores') {
    const stores = ALL_STORES.filter(s => c.stores.includes(s))
    return { title: stores.length === ALL_STORES.length ? `All ${stores.length} stores` : listText(stores), subs: CHART_SUBS.filter(s => stores.includes(s.store)),
      parts: stores.length > 1 ? byStore(stores) : [], names: [] }
  }
  if (c.chart === 'subcategory') {
    const scope = withinSubs(c.within)
    const size = (name: string) => totalsTo(daysFor(m, scope.filter(s => s.name === name)), m.days).final
    const names = c.pick === 'largest' ? [...NAMES].sort((a, b) => size(b) - size(a)).slice(0, c.top) : NAMES.filter(n => c.subs.includes(n))
    return { title: `${c.pick === 'largest' ? `The ${c.top} largest subcategories` : listText(names)}, ${withinText(c.within)}`, subs: scope.filter(s => names.includes(s.name)),
      parts: names.length > 1 ? names.map(name => ({ key: name, title: name, subs: scope.filter(s => s.name === name) })) : [], names }
  }
  return { title: `Whole business, all ${ALL_STORES.length} stores`, subs: CHART_SUBS,
    parts: REGIONS.map(r => ({ key: r.name, title: `${r.name} region`, subs: CHART_SUBS.filter(s => s.region === r.name) })), names: [] }
}

/** "01-Nov-2026 to 22-Nov-2026: actual ₹X | base ₹Y (+9.6%) | final ₹Z (+3.4%)", the weekly pack's title line. A part
 *  of the page takes the page's days, so the parts add up to the whole. */
function toDateLine(m: Month, rows: DayRow[], to = completeTo(rows)) {
  const { period, figures } = toDateParts(m, rows, to)
  return figures ? `${period}: ${figures}` : period
}
function toDateParts(m: Month, rows: DayRow[], to: number) {
  const t = totalsTo(rows, to)
  if (!to) return { period: 'No day is loaded in full yet.', figures: '' }
  return { period: `${dateOf(m, 1)} to ${dateOf(m, to)}`,
    figures: `actual ${fmtINR(t.actual)} | base ${fmtINR(t.base)} (${pct1(bias(t.actual, t.base))}) | final ${fmtINR(t.final)} (${pct1(bias(t.actual, t.final))})` }
}

export function ChartsPage({ ctx }: { ctx: Ctx }) {
  const m = ctx.month
  const [choice, setChoice] = useState(fromAddress)
  const change = (next: Partial<Choice>) => { const c = { ...choice, ...next }; setChoice(c); toAddress(c) }
  if (m.state === 'empty') return <Page title="Charts"><NoRunYet month={m} what="There is nothing to chart until it is in." /></Page>

  const pick = selection(choice, m)
  const rows = daysFor(m, pick.subs)
  const to = completeTo(rows), t = totalsTo(rows, to)
  const closed = m.state === 'closed'
  const partial = rows.filter(r => r.state === 'partial')
  const stores = [...new Set(pick.subs.map(s => s.store))]
  const bars = choice.bars || (choice.chart !== 'subcategory' && stores.length > 1 ? 'store' : 'subcategory')
  const groups = bars === 'store' ? stores.map(st => [st, pick.subs.filter(s => s.store === st)] as const)
    : [...new Set(pick.subs.map(s => s.name))].map(n => [n, pick.subs.filter(s => s.name === n)] as const)
  const gapItems = groups.map(([name, subs]) => { const x = totalsTo(daysFor(m, subs), to); return { name, actual: x.actual, final: x.final } })
  const period = to ? `${dateOf(m, 1)} to ${dateOf(m, to)}` : ''
  const events = EVENTS.filter(e => e.month === m.key)
  const uplift = `${Math.round(UPLIFT * 100)}%`

  return (
    <Page title="Charts">
      <p className="-mt-2 text-sm text-ink-muted">{m.label} · {closed ? 'closed: the whole month' : `actuals to ${dateOf(m, to)}, the last day loaded in full; the forecast to the month end`} · daily sales, ₹ before tax · made-up data</p>
      <Card>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 p-4" data-testid="chart-controls">
          <Field label="View"><Segmented label="View" value={choice.chart} onChange={v => change({ chart: v, bars: '' })} options={VIEWS} /></Field>
          {choice.chart === 'region' && <Field label="Region"><Segmented label="Region" value={choice.region} onChange={v => change({ region: v, bars: '' })} options={REGIONS.map(r => ({ value: r.name, label: `${r.name} region` }))} /></Field>}
          {choice.chart === 'stores' && <StorePicker chosen={choice.stores} onChange={s => change({ stores: s, bars: '' })} />}
          {choice.chart === 'subcategory' && <SubcategoryPicker choice={choice} chosen={pick.names} change={change} />}
        </div>
      </Card>
      {!pick.subs.length ? <Card><p className="p-4 text-sm text-ink-muted">Pick at least one {choice.chart === 'stores' ? 'store' : 'subcategory'} to draw the charts.</p></Card> : <>
        <div className="grid gap-3 md:grid-cols-3" data-testid="tiles">
          <Tile label={`Actual, ${period || 'no full day yet'}`} value={t.actual} testId="tile-actual" note={closed ? 'What sold in the month' : 'What sold, on days loaded in full'} />
          <Tile label="Raw base, same days" value={t.base} testId="tile-base" note={<>Before the flat {uplift} uplift · actual <b className="text-ink">{pct1(bias(t.actual, t.base))}</b> on it</>} />
          <Tile label="Final, same days" value={t.final} testId="tile-final" note={<>With the uplift · actual <b className="text-ink">{pct1(bias(t.actual, t.final))}</b> on it ({signedINR(t.actual - t.final)})</>} />
        </div>
        <p className="-mt-2 text-[13px] text-ink-muted">Bias is actual ÷ forecast − 1: a plus means the forecast was too low, a minus that it was too high.</p>
        <Card>
          <div className="flex flex-col gap-3 p-4">
            <div>
              <h2 className="text-base font-semibold" data-testid="chart-title">{pick.title}: daily sales before tax, {m.label}</h2>
              <p className="text-sm tabular-nums text-ink-muted" data-testid="chart-line">{toDateLine(m, rows)}</p>
            </div>
            <Legend actualLabel={closed ? 'Actual' : `Actual (days loaded in full, to ${dateOf(m, to)})`} partial={partial.length > 0} />
            <DailyChart month={m} rows={rows} height={340} label={`${pick.title}, ${m.label}: ${toDateLine(m, rows)}`} testId="main-chart" />
            <ul className="flex flex-col gap-1 text-[13px] text-ink-muted" data-testid="chart-notes">
              {partial.map(r => <li key={r.day} data-testid="partial-note"><b className="text-ink">{r.date} is only partly loaded</b> for {listText(r.partialStores)} ({fmtINR(r.soFar)} in so far, against a final of {fmtINR(r.final)}). It is shaded and left out of the actual line and of every figure to date, so it does not show as a drop.</li>)}
              {events.map(e => <li key={e.day}>{e.name}, {dateOf(m, e.day)}: {e.note}.</li>)}
              <li>Final is the engine's figure with the flat {uplift} uplift; the raw base is before it. People's applied numbers are not in these lines.</li>
            </ul>
            <DayTable m={m} rows={rows} to={to} />
          </div>
        </Card>
        <Card title={`Gap to final, ${period}`} actions={<Segmented label="Bars by" value={bars} onChange={v => change({ bars: v })}
          options={[{ value: 'store', label: 'By store' }, { value: 'subcategory', label: 'By subcategory' }]} />}>
          <div className="flex flex-col gap-2 px-4 pb-4">
            <p className="text-[13px] text-ink-muted">Actual less final, {bars === 'store' ? 'store by store' : 'subcategory by subcategory'}, largest first. Right of the line, more sold than the final said.</p>
            <GapBars items={gapItems} caption={`Gap to final by ${bars}`} />
          </div>
        </Card>
        {pick.parts.length > 1 && (
          <Card title={`One chart each: ${choice.chart === 'all' ? 'by region' : choice.chart === 'subcategory' ? 'by subcategory' : 'by store'}`}>
            <div className="grid gap-4 px-4 pb-4 xl:grid-cols-2" data-testid="small-multiples">
              {pick.parts.map(p => { const pr = daysFor(m, p.subs), pt = totalsTo(pr, to); return (
                <section key={p.key} className="flex min-w-0 flex-col gap-1 rounded-card bg-subtle/60 p-3" aria-label={p.title} data-testid="part" data-actual={pt.actual} data-final={pt.final} data-base={pt.base}>
                  <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold">{p.title}
                    <span className="text-[12px] font-normal text-ink-muted">{toDateParts(m, pr, to).period}{completeTo(pr) > to ? ` · ${dateOf(m, completeTo(pr))} drawn, not counted` : ''}</span></h3>
                  <p className="text-[12px] tabular-nums text-ink-muted">{toDateParts(m, pr, to).figures}</p>
                  <DailyChart month={m} rows={pr} height={210} compact label={`${p.title}, ${m.label}: ${toDateLine(m, pr, to)}`} testId="small-chart" />
                </section>) })}
            </div>
          </Card>)}
      </>}
    </Page>
  )
}

function Tile({ label, value, note, testId }: { label: string; value: number; note: ReactNode; testId: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-card bg-surface p-4 shadow-raised" data-testid={testId} data-value={value}>
      <span className="text-[13px] font-medium text-ink-muted">{label}</span>
      <span className="text-2xl font-semibold">{fmtINR(value)}</span>
      <span className="text-[13px] text-ink-muted">{note}</span>
    </div>
  )
}

function StorePicker({ chosen, onChange }: { chosen: string[]; onChange: (stores: string[]) => void }) {
  const flip = (s: string) => onChange(chosen.includes(s) ? chosen.filter(x => x !== s) : ALL_STORES.filter(x => x === s || chosen.includes(x)))
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Stores <span className="font-normal text-ink-muted">· {chosen.length} of {ALL_STORES.length}</span></span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {REGIONS.map(r => (
          <div key={r.name} role="group" aria-label={`${r.name} region`} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-ink-muted">{r.name}</span>
            {r.stores.map(s => <Toggle key={s} on={chosen.includes(s)} onClick={() => flip(s)} testId={`store-${s}`}>{s}</Toggle>)}
          </div>))}
        <span className="flex gap-1.5">
          <button type="button" className="text-[13px] font-semibold text-action" onClick={() => onChange([...ALL_STORES])}>All</button>
          <button type="button" className="text-[13px] font-semibold text-action" onClick={() => onChange([])}>Clear</button>
        </span>
      </div>
    </div>
  )
}

function SubcategoryPicker({ choice, chosen, change }: { choice: Choice; chosen: string[]; change: (c: Partial<Choice>) => void }) {
  const [q, setQ] = useState('')
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const found = NAMES.filter(n => words.every(w => n.toLowerCase().includes(w)))
  const flip = (n: string) => change({ subs: choice.subs.includes(n) ? choice.subs.filter(x => x !== n) : [...choice.subs, n] })
  return (
    <>
      <div className="w-52"><Field label="Within"><Select value={choice.within} onChange={e => change({ within: e.target.value })} data-testid="within">
        <option value="">Every store</option>
        {REGIONS.map(r => <option key={r.name} value={`region:${r.name}`}>{r.name} region</option>)}
        {ALL_STORES.map(s => <option key={s} value={`store:${s}`}>{s}</option>)}
      </Select></Field></div>
      <Field label="Pick"><Segmented label="Pick subcategories" value={choice.pick} onChange={v => change({ pick: v })} options={[{ value: 'largest', label: 'The largest' }, { value: 'search', label: 'By search' }]} /></Field>
      {choice.pick === 'largest' ? (
        <div className="w-40"><Field label="How many" hint="Largest by final for the month"><Select value={String(choice.top)} onChange={e => change({ top: Number(e.target.value) })} data-testid="top">
          {TOPS.map(n => <option key={n} value={n}>{n}</option>)}
        </Select></Field></div>
      ) : (
        <div className="flex basis-full flex-col gap-1.5">
          <div className="max-w-md"><Field label="Find subcategories"><SearchInput value={q} placeholder="Try: girls, veg, shirt" onChange={e => setQ(e.target.value)} data-testid="sub-search" /></Field></div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Subcategories">
            {(words.length ? found : NAMES).map(n => <Toggle key={n} on={choice.subs.includes(n)} onClick={() => flip(n)} testId={`sub-${n}`}>{n}</Toggle>)}
            {words.length > 0 && !found.length && <span className="text-[13px] text-ink-muted">No subcategory matches.</span>}
          </div>
        </div>
      )}
      {choice.pick === 'largest' && <p className="basis-full text-[13px] text-ink-muted">Drawn: {listText(chosen)}.</p>}
    </>
  )
}

function Toggle({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return <button type="button" aria-pressed={on} onClick={onClick} data-testid={testId}
    className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${on ? 'bg-ink text-surface' : 'bg-fill text-ink-muted hover:text-ink'}`}>{children}</button>
}

/** The table view: every day's figures, exact, footing to the tiles. */
function DayTable({ m, rows, to }: { m: Month; rows: DayRow[]; to: number }) {
  const t = totalsTo(rows, to)
  const cell = 'px-2 py-1 text-end tabular-nums whitespace-nowrap'
  return (
    <details className="text-sm" data-testid="day-table">
      <summary className="cursor-pointer text-[13px] font-semibold text-action">The figures, day by day</summary>
      <div className="mt-2 max-h-96 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-surface text-[12px] text-ink-muted"><tr>
            <th className="px-2 py-1 text-start font-semibold">Day</th><th className={`${cell} font-semibold`}>Raw base</th><th className={`${cell} font-semibold`}>Final</th>
            <th className={`${cell} font-semibold`}>Actual</th><th className={`${cell} font-semibold`}>Actual on final</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.day} className="border-t border-border">
                <td className="px-2 py-1 whitespace-nowrap">{r.date}{r.events.map(e => <span key={e.kind} className="text-ink-muted"> · {e.name}</span>)}</td>
                <td className={cell}>{fmtExact(r.base)}</td><td className={cell}>{fmtExact(r.final)}</td>
                <td className={cell}>{r.actual != null ? fmtExact(r.actual) : <span className="text-ink-muted">{r.state === 'partial' ? `partly loaded: ${fmtExact(r.soFar)} so far` : 'not loaded yet'}</span>}</td>
                <td className={cell}>{r.actual != null ? pct1(bias(r.actual, r.final)) : ''}</td>
              </tr>))}
          </tbody>
          {to > 0 && <tfoot><tr className="border-t-2 border-border font-semibold" data-testid="table-total">
            <td className="px-2 py-1 whitespace-nowrap">{dateOf(m, 1)} to {dateOf(m, to)}</td>
            <td className={cell}>{fmtExact(t.base)}</td><td className={cell}>{fmtExact(t.final)}</td><td className={cell}>{fmtExact(t.actual)}</td><td className={cell}>{pct1(bias(t.actual, t.final))}</td>
          </tr></tfoot>}
        </table>
      </div>
    </details>
  )
}
