// The Workspace for a loaded Run (dataset.ts): the month under review, before it starts and as it runs.
// What a person sees is their reach (areas.ts: Dash's places), and they move through it as the Sales
// Target Dive does: Store, then Division › Sub-division › Category › Subcategory, each offering only what
// the levels above allow, with Section beside them. Three tabs: the whole month against the AOP, where a
// line's number is changed in lakh or by a percent; the days, 01 to 31, the day beside the month to date,
// with each day more than 10% off explained by its causes; and how the engine built the figure.
import { useMemo, useState, type ReactNode } from 'react'
import { Button, Card, Notice, Segmented, StatusPill, fmtINR } from '@featherbase/shop-floor'
import { BASES, PEOPLE, SUBS, wobble, type Sub } from './madeUp'
import { areaText, inArea } from './areas'
import { combine } from './combine'
import { nowIST } from './months'
import { Page, type Ctx, type NumberRow } from './App'
import { STATUS_TONE, logRow } from './WorkspacePage'

type Level = 'Division' | 'Subdivision' | 'Category' | 'Subcategory'
const LEVELS: { level: Level; key: 'division' | 'subdivision' | 'category' | 'name'; param: string; all: string }[] = [
  { level: 'Division', key: 'division', param: 'division', all: 'All divisions' },
  { level: 'Subdivision', key: 'subdivision', param: 'subdivision', all: 'All sub-divisions' },
  { level: 'Category', key: 'category', param: 'category', all: 'All categories' },
  { level: 'Subcategory', key: 'name', param: 'sub', all: 'All subcategories' },
]
const KEYS = ['region', 'store', 'division', 'subdivision', 'category', 'sub', 'section', 'tab', 'dview', 'day', 'rows', 'line', 'practice'] as const
type State = Partial<Record<typeof KEYS[number], string>>

/** The five causes a gap is filed under (agreed 26-Nov-2026), each with its detail and the evidence that settles it. */
export const CAUSES = [
  { name: 'Target too high or badly phased', subs: ['Month target too high', 'Daily split wrong for the weekday', 'Festival or event on a different day'],
    evidence: 'The approved month target, its daily split, and the weekday and festival adjustments' },
  { name: 'Forecast missed the demand', subs: ['Wrong demand prediction', 'Event not in the forecast', 'New store or new line, no history'],
    evidence: 'The forecast frozen before the day, with its version and when it was issued' },
  { name: 'Stock not available', subs: ['Size or colour missing', 'Insufficient buying', 'Warehouse stock not dispatched', 'Vendor supply failure', 'Inaccurate stock'],
    evidence: 'Item, size and price-band availability in selling hours; replenishment; lost-sale evidence' },
  { name: 'Weak store execution', subs: ['Low footfall', 'Low conversion', 'Short of staff', 'Stock not displayed', 'Wrong pricing'],
    evidence: 'Footfall, conversion, staffing, display and shelf availability' },
  { name: 'Sales data incomplete', subs: ['Day not fully loaded', 'Till or POS not synced', 'Missing sales data'],
    evidence: 'POS-to-report reconciliation and the completed-day cut-off' },
]
const causeOf = (t: string) => CAUSES.find(c => t === c.name || t.startsWith(`${c.name} › `))

const pct = (a: number, b: number) => (b ? (a / b - 1) * 100 : 0)
const signed = (x: number) => (Math.abs(x) < 0.05 ? '0.0%' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}%`)
/** The forecast against the AOP in the run's own bands: within 10% green, 10–20% orange, 20% or more red, grey when both are under ₹1 lakh. */
function aopTone(fc: number, aop: number): 'positive' | 'caution' | 'negative' | 'missing' {
  if (fc < 1e5 && aop < 1e5) return 'missing'
  if (!aop) return 'negative'
  const off = Math.abs(fc / aop - 1)
  return off < 0.1 ? 'positive' : off < 0.2 ? 'caution' : 'negative'
}
const offTone = (x: number) => (Math.abs(x) > 10 ? (x < 0 ? 'negative' : 'caution') : 'positive')
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0)

/** PRACTICE ONLY: made-up sales for the first five days, so the day views and explaining can be tried before the month starts. */
const PRACTICE_DAYS = 5
const practiceSold = (s: Sub, d: number) => Math.round(s.days![d - 1] * (1 + wobble(s.seed * 7 + d * 13) * 0.5))

function readState(): State {
  const q = new URLSearchParams(window.location.search)
  return Object.fromEntries(KEYS.map(k => [k, q.get(k) ?? ''])) as State
}

export function ReviewMonthPage({ ctx }: { ctx: Ctx }) {
  const m = ctx.month
  const [st, setSt] = useState<State>(readState)
  const set = (next: State) => {
    const merged = { ...st, ...next }
    const q = new URLSearchParams(window.location.search)
    for (const k of KEYS) { if (merged[k]) q.set(k, merged[k]!); else q.delete(k) }
    history.replaceState(null, '', `?${q}`)
    setSt(merged)
  }
  const mine = useMemo(() => SUBS.filter(s => inArea(ctx.viewer, s)), [ctx.viewer])
  // Region above Store, where a person's reach spans both (Kerala, Tamil Nadu).
  const myRegions = useMemo(() => [...new Set(mine.map(s => s.region))].sort(), [mine])
  const region = myRegions.length === 1 ? myRegions[0] : myRegions.includes(st.region ?? '') ? st.region! : ''
  const inRegion = region ? mine.filter(s => s.region === region) : mine
  const myStores = useMemo(() => [...new Set(inRegion.map(s => s.store))].sort(), [inRegion])
  const allStores = useMemo(() => [...new Set(mine.map(s => s.store))].sort(), [mine])
  const store = myStores.length === 1 ? myStores[0] : myStores.includes(st.store ?? '') ? st.store! : ''
  const inStore = store ? inRegion.filter(s => s.store === store) : inRegion
  const sections = [...new Set(inStore.map(s => s.section))].sort()
  const section = store && sections.includes(st.section ?? '') ? st.section! : ''
  // Each level offers only what the levels above it still allow.
  let pool = section ? inStore.filter(s => s.section === section) : inStore
  const picks: { level: Level; value: string; options: string[] }[] = []
  for (const l of LEVELS) {
    const options = [...new Set(pool.map(s => String(s[l.key] ?? '')))].filter(Boolean).sort()
    // A level with one choice in this person's reach is fixed, as the Dive locks a scoped reader's store.
    const value = options.length === 1 ? options[0] : options.includes(st[l.param as keyof State] ?? '') ? st[l.param as keyof State]! : ''
    picks.push({ level: l.level, value, options })
    if (value) pool = pool.filter(s => s[l.key] === value)
  }
  const scoped = pool
  const deepest = [...picks].reverse().find(p => p.value)
  const next = LEVELS.find((_, i) => !picks[i].value)
  const byRegions = st.rows === 'regions' && !region && myRegions.length > 1
  const byStores = st.rows === 'stores' && !store && myStores.length > 1
  const tab = (st.tab || 'month') as 'month' | 'days' | 'how'

  // What people's Applied numbers make each line, store by store (combine.ts: totals spread, percents kept).
  const scopeStores = [...new Set(scoped.map(s => s.store))]
  const applied = useMemo(() => {
    const out = new Map<string, number>()
    for (const sto of scopeStores) for (const [name, weeks] of combine(ctx.data.numbers, sto, m).adj) out.set(`${sto}|${name}`, weeks.reduce((a, b) => a + b, 0))
    return out
  }, [ctx.data.numbers, m, scopeStores.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const now = (s: Sub) => applied.get(`${s.store}|${s.name}`) ?? s.engine

  const scope = { store: store || 'All', level: deepest?.level ?? (section ? 'Section' : 'Store'), name: deepest?.value ?? (section || store || 'All') }
  const scopeLabel = [region && myRegions.length > 1 && !store ? region : '', store || (myStores.length > 1 ? `All my stores (${myStores.length})` : ''), section && `Section: ${section}`, ...picks.filter(p => p.value).map(p => p.value)].filter(Boolean).join(' › ')
  const clearFrom = (i: number): State => Object.fromEntries(LEVELS.slice(i).map(l => [l.param, '']))

  if (!mine.length) return <Page title="Workspace"><Notice tone="caution">Nothing in {m.label}'s Run is in your area ({areaText(ctx.viewer)}). If that is wrong, your section or merchandise assignment needs setting up in Featherbase.</Notice></Page>

  const fc = sum(scoped, s => s.engine), nowTotal = sum(scoped, now), aop = sum(scoped, s => s.aop ?? 0)
  const red = scoped.filter(s => aopTone(s.engine, s.aop ?? 0) === 'negative' && s.engine + (s.aop ?? 0) >= 2e5).length
  const orange = scoped.filter(s => aopTone(s.engine, s.aop ?? 0) === 'caution').length

  return (
    <Page title="Workspace">
      <p className="-mt-2 text-sm text-ink-muted">{m.label} · engine Run {m.run} · ₹ after GST, as the AOP is · you see {areaText(ctx.viewer)}</p>
      {/* Where you are, and the filters: the Dive's Division › Sub-division › Category › Subcategory, with Store and Section */}
      <Card>
        <div className="flex flex-col gap-3 p-3">
          <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="crumbs">
            <button type="button" className="font-semibold text-action hover:underline" onClick={() => set({ ...clearFrom(0), section: '', region: '', store: allStores.length > 1 ? '' : store, line: '' })}>
              {allStores.length > 1 ? `All my stores (${allStores.length})` : store}</button>
            {region && myRegions.length > 1 && <><span className="text-ink-muted">›</span><button type="button" className="font-semibold text-action hover:underline" onClick={() => set({ ...clearFrom(0), section: '', store: '', line: '' })}>{region}</button></>}
            {store && myStores.length > 1 && <><span className="text-ink-muted">›</span><button type="button" className="font-semibold text-action hover:underline" onClick={() => set({ ...clearFrom(0), section: '', line: '' })}>{store}</button></>}
            {section && <><span className="text-ink-muted">›</span><span>Section: {section}</span></>}
            {picks.map((p, i) => p.value && <span key={p.level} className="flex items-center gap-1.5"><span className="text-ink-muted">›</span>
              <button type="button" className="font-semibold text-action hover:underline" onClick={() => set({ ...clearFrom(i + 1), line: '' })}>{p.value}</button></span>)}
          </nav>
          <div className="flex flex-wrap items-end gap-2">
            {myRegions.length > 1 && <Pick label="Region" value={region} all="Both regions" options={myRegions} onChange={v => set({ region: v, store: '', section: '', ...clearFrom(0), line: '', rows: '' })} />}
            <Pick label="Store" value={store} locked={myStores.length === 1} all={`All my stores (${myStores.length})`} options={myStores} onChange={v => set({ store: v, section: '', ...clearFrom(0), line: '' })} />
            {store && sections.length > 1 && <Pick label="Section" value={section} all="All my sections" options={sections} onChange={v => set({ section: v, ...clearFrom(0), line: '' })} />}
            {picks.map((p, i) => (i === 0 || picks[i - 1].value || p.value) && (
              <Pick key={p.level} label={p.level === 'Subdivision' ? 'Sub-division' : p.level} value={p.value} all={LEVELS[i].all} options={p.options} locked={p.options.length === 1}
                onChange={v => set({ ...clearFrom(i), [LEVELS[i].param]: v, line: '' })} />))}
            {(picks.some(p => p.value) || section) && <Button variant="quiet" onClick={() => set({ ...clearFrom(0), section: '', line: '' })}>Clear</Button>}
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-card bg-surface p-4 shadow-card" data-testid="headline">
        <div>
          <div className="text-[13px] text-ink-muted">{scopeLabel} · {m.label}, before it starts</div>
          <div className={`text-2xl font-extrabold tabular-nums ${aopTone(nowTotal, aop) === 'positive' ? 'text-positive' : 'text-caution'}`}>
            {fmtINR(nowTotal)} forecast, {aop ? `${fmtINR(Math.abs(nowTotal - aop))} (${Math.abs(pct(nowTotal, aop)).toFixed(0)}%) ${nowTotal < aop ? 'below' : 'above'} the AOP of ${fmtINR(aop)}` : 'no AOP'}</div>
          <div className="text-[13px] text-ink-muted">Engine {fmtINR(fc)}{Math.abs(nowTotal - fc) > 1 ? ` · people's applied numbers move it ${nowTotal > fc ? '+' : '−'}${fmtINR(Math.abs(nowTotal - fc))}` : ' · no number applied yet'} · {scoped.length} lines, {red} red, {orange} orange</div>
        </div>
        <Segmented label="View" value={tab} onChange={v => set({ tab: v === 'month' ? '' : v })}
          options={[{ value: 'month', label: 'Month' }, { value: 'days', label: 'Days' }, { value: 'how', label: 'How it was built' }]} />
      </div>

      {tab === 'month' && <MonthView ctx={ctx} scoped={scoped} next={next?.level} rowsBy={byRegions ? 'regions' : byStores ? 'stores' : 'merch'} canRegions={!region && myRegions.length > 1}
        canStores={!store && myStores.length > 1} store={store} now={now} onRows={v => set({ rows: v })} line={st.line ?? ''} onLine={v => set({ line: v })}
        onDrill={(value, by) => by === 'regions' ? set({ region: value, rows: 'stores', line: '' }) : by === 'stores' ? set({ store: value, rows: '', line: '' })
          : next && set({ [LEVELS.find(l => l.level === next.level)!.param]: value, line: '' })} />}
      {tab === 'days' && <DaysView ctx={ctx} scoped={scoped} scope={scope} scopeLabel={scopeLabel} view={(st.dview || 'all') as 'all' | 'one'} day={Number(st.day) || 1}
        practice={st.practice === '1'} next={next?.level} onSet={set} />}
      {tab === 'how' && <HowBuilt scoped={scoped} scopeLabel={scopeLabel} onDays={() => set({ tab: 'days' })} />}
    </Page>
  )
}

function Pick({ label, value, options, all, locked, onChange }: { label: string; value: string; options: string[]; all: string; locked?: boolean; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-muted">
      {label}
      <select className="min-h-9 min-w-40 max-w-60 rounded-control border border-border-control bg-surface px-2 text-sm font-normal text-ink disabled:opacity-70" value={value} disabled={locked}
        onChange={e => onChange(e.target.value)} aria-label={label}>
        {!locked && <option value="">{all}</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

// ---- Month: one figure per row for the whole month, against the AOP; a line's number changed beside it ----
function MonthView({ ctx, scoped, next, rowsBy, canRegions, canStores, store, now, onRows, onDrill, line, onLine }: {
  ctx: Ctx; scoped: Sub[]; next?: Level; rowsBy: 'merch' | 'stores' | 'regions'; canRegions: boolean; canStores: boolean; store: string; now: (s: Sub) => number
  onRows: (v: string) => void; onDrill: (value: string, by: 'merch' | 'stores' | 'regions') => void; line: string; onLine: (v: string) => void }) {
  const byStores = rowsBy !== 'merch'
  const key = rowsBy === 'regions' ? (s: Sub) => s.region : byStores ? (s: Sub) => s.store : next ? (s: Sub) => String(s[LEVELS.find(l => l.level === next)!.key] ?? '') : (s: Sub) => s.name
  const groups = [...new Set(scoped.map(key))].map(name => {
    const xs = scoped.filter(s => key(s) === name)
    return { name, xs, fc: sum(xs, s => s.engine), now: sum(xs, now), aop: sum(xs, s => s.aop ?? 0) }
  }).sort((a, b) => (a.now - a.aop) - (b.now - b.aop))
  const lines = !byStores && (next === 'Subcategory' || !next)
  const sel = line && store ? scoped.find(s => s.store === store && s.name === line) : undefined
  return (
    <div className={`grid items-start gap-4 ${sel ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
          <div className="text-sm font-semibold">{rowsBy === 'regions' ? 'By region' : byStores ? 'By store' : `By ${(next ?? 'Subcategory').toLowerCase().replace('subdivision', 'sub-division')}`} · biggest shortfall against the AOP first</div>
          {canStores && <Segmented label="Rows" value={rowsBy} onChange={v => onRows(v === 'merch' ? '' : v)}
            options={[{ value: 'merch', label: 'Merchandise' }, ...(canRegions ? [{ value: 'regions' as const, label: 'Regions' }] : []), { value: 'stores', label: 'Stores' }]} />}
        </div>
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="month-table">
            <thead><tr className="text-[12px] text-ink-muted">
              <th className="px-2.5 py-2 text-start font-semibold">{rowsBy === 'regions' ? 'Region' : byStores ? 'Store' : next ? next.replace('Subdivision', 'Sub-division') : 'Subcategory'}</th>
              {lines && store && <th className="px-2.5 py-2 text-start font-semibold">Section</th>}
              <th className="px-2.5 py-2 text-end font-semibold">Forecast</th>
              <th className="px-2.5 py-2 text-end font-semibold">Applied</th>
              <th className="px-2.5 py-2 text-end font-semibold">AOP</th>
              <th className="px-2.5 py-2 text-end font-semibold">vs AOP</th>
              <th />
            </tr></thead>
            <tbody>
              {groups.map(g => {
                const one = lines && g.xs.length === 1 ? g.xs[0] : undefined
                const canDrill = byStores || (!!next && next !== 'Subcategory')
                return (
                  <tr key={g.name} className={`border-t border-border ${one && one.name === line ? 'bg-action-tint' : ''}`}>
                    <td className="px-2.5 py-1.5">
                      {canDrill ? <button type="button" className="font-medium text-action hover:underline" onClick={() => onDrill(g.name, rowsBy)}>{g.name} ›</button>
                        : <span className="font-medium">{g.name}</span>}
                      {lines && !store && <span className="ml-1 text-[12px] text-ink-muted">· {g.xs.length} store{g.xs.length > 1 ? 's' : ''}</span>}
                    </td>
                    {lines && store && <td className="px-2.5 text-[12px] text-ink-muted">{one?.section}</td>}
                    <td className="px-2.5 text-end tabular-nums whitespace-nowrap">{fmtINR(g.fc)}</td>
                    <td className={`px-2.5 text-end tabular-nums whitespace-nowrap ${Math.abs(g.now - g.fc) > 1 ? 'font-semibold text-action' : 'text-ink-muted'}`}>{Math.abs(g.now - g.fc) > 1 ? fmtINR(g.now) : '—'}</td>
                    <td className="px-2.5 text-end tabular-nums whitespace-nowrap text-ink-muted">{fmtINR(g.aop)}</td>
                    <td className="px-2.5 text-end"><StatusPill tone={aopTone(g.now, g.aop)}>{g.aop ? signed(pct(g.now, g.aop)) : 'no AOP'}</StatusPill></td>
                    <td className="px-2.5 text-end">{one && store && <Button variant="secondary" className="min-h-8 px-2.5 text-[12px]" onClick={() => onLine(one.name)}>{inArea(ctx.viewer, one) ? 'Change' : 'Open'}</Button>}</td>
                  </tr>)
              })}
            </tbody>
          </table>
          {lines && !store && <p className="px-2.5 pt-2 text-[12px] text-ink-muted">Pick a store to change a line's number: a number is for one store's line.</p>}
        </div>
      </Card>
      {sel && <LinePanel key={`${sel.store}|${sel.name}`} ctx={ctx} s={sel} now={now(sel)} onClose={() => onLine('')} />}
    </div>
  )
}

function LinePanel({ ctx, s, now, onClose }: { ctx: Ctx; s: Sub; now: number; onClose: () => void }) {
  const m = ctx.month
  const [mode, setMode] = useState<'total' | 'pc'>('pc')
  const [lakh, setLakh] = useState((now / 1e5).toFixed(2)), [pc, setPc] = useState(0)
  const [causes, setCauses] = useState<string[]>([]), [note, setNote] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const figure = mode === 'total' ? Math.round((Number(lakh) || 0) * 1e5) : Math.round(s.engine * (1 + pc / 100))
  const numbers = ctx.data.numbers.filter(n => n.month === m.key && n.store === s.store && n.scope_level === 'Subcategory' && n.scope_name === s.name)
    .sort((a, b) => b.entered_on.localeCompare(a.entered_on))
  const mineHere = inArea(ctx.viewer, s)
  const up = ctx.viewer.reportsTo ? ctx.viewer.reportsTo : null
  const boss = up ? (PEOPLE.find(p => p.id === up)?.name ?? null) : null
  const send = async (as: 'approval' | 'reference') => {
    setBusy(true); setError('')
    try {
      const status = as === 'reference' ? 'Reference' : boss ? 'Waiting' : 'Applied'
      const reason = [...causes, note.trim()].filter(Boolean).join('\n')
      const saved = await ctx.save('forecasting.number', {
        month: m.key, run: m.run, store: s.store, section: s.section, scope_level: 'Subcategory', scope_name: s.name, weeks: '',
        kind: mode === 'total' ? 'Set a total' : 'Change by a percent', value: figure, percent: mode === 'pc' ? pc : null, weights_json: null,
        entered_by: ctx.viewer.name, entered_by_role: ctx.viewer.role, entered_on: nowIST(), reason, status, waiting_on: status === 'Waiting' ? boss : null, changed_by: ctx.viewer.name })
      await ctx.save('forecasting.decision', logRow(ctx, saved as unknown as NumberRow, status === 'Reference' ? 'Kept as reference' : status === 'Applied' ? 'Approved and applied' : 'Sent for approval',
        status === 'Waiting' ? `To ${boss}` : status === 'Applied' ? 'Applies without approval.' : 'Held as a view.'))
      if (status === 'Applied') for (const o of numbers.filter(o => o.status === 'Applied')) await ctx.save('forecasting.number', { ...o, status: 'Reference', changed_by: ctx.viewer.name })
      await ctx.reload(); setNote(''); setCauses([])
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const chips = [-20, -10, -5, 5, 10, 20]
  return (
    <div className="sticky top-4 flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" data-testid="line-panel">
      <div className="flex items-start justify-between gap-2">
        <div><div className="text-[12px] text-ink-muted">{s.store} · {s.section}</div><div className="text-lg font-bold">{s.name}, {m.label}</div></div>
        <Button variant="quiet" onClick={onClose} aria-label="Close">✕</Button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Fig label="Forecast" value={fmtINR(s.engine)} /><Fig label="Applied" value={fmtINR(now)} /><Fig label="AOP" value={fmtINR(s.aop ?? 0)} />
      </div>
      {numbers.length > 0 && <div className="flex flex-col gap-1.5" data-testid="line-numbers">
        <div className="text-[12px] font-semibold text-ink-muted">Numbers on this line</div>
        {numbers.map(n => <div key={n.row_id} className="flex items-center justify-between gap-2 rounded-control bg-subtle px-2.5 py-1.5 text-[13px]">
          <span><b>{n.entered_by}</b> · {n.kind === 'Change by a percent' ? `${(n.percent ?? 0) > 0 ? '+' : ''}${n.percent}%` : fmtINR(n.value)}{n.waiting_on ? ` · waiting on ${n.waiting_on}` : ''}</span>
          <StatusPill tone={STATUS_TONE[n.status]}>{n.status}</StatusPill></div>)}
      </div>}
      {!mineHere ? <Notice>This line is outside your area ({areaText(ctx.viewer)}); you can see it but not change it.</Notice> : <>
        <Segmented label="How" value={mode} onChange={setMode} options={[{ value: 'pc', label: 'Move it by a percent' }, { value: 'total', label: "Set the month's total" }]} />
        {mode === 'total' ? <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-muted">The month's total, in lakh
          <span className="flex items-center rounded-control bg-subtle px-3 text-xl font-bold text-ink"><span className="text-sm text-ink-muted">₹</span>
            <input data-testid="lakh" inputMode="decimal" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-end outline-none" value={lakh} onChange={e => setLakh(e.target.value)} />
            <span className="text-sm text-ink-muted">lakh</span></span>
          <span className="font-normal">= ₹{figure.toLocaleString('en-IN')}. Type 90 for ₹90 lakh.</span></label>
          : <div className="flex flex-col gap-2"><div className="flex flex-wrap gap-1.5">{chips.map(c => <Chip key={c} on={pc === c} onClick={() => setPc(c)}>{c > 0 ? '+' : '−'}{Math.abs(c)}%</Chip>)}</div>
            <span className="flex items-center rounded-control bg-subtle px-3 text-xl font-bold"><input data-testid="percent" inputMode="decimal" className="min-w-0 flex-1 bg-transparent py-2 text-end outline-none"
              value={String(pc)} onChange={e => setPc(Number(e.target.value.replace(/[^0-9.-]/g, '')) || 0)} /><span className="ml-1 text-sm text-ink-muted">%</span></span></div>}
        <div className="rounded-control bg-subtle p-2.5 text-sm"><b>{fmtINR(s.engine)} → {fmtINR(figure)}</b> <span className="text-ink-muted">({signed(pct(figure, s.engine))} on the forecast)</span>
          <div className="text-[12px] text-ink-muted">Against the AOP of {fmtINR(s.aop ?? 0)}: {figure >= (s.aop ?? 0) ? 'above by' : 'short by'} {fmtINR(Math.abs(figure - (s.aop ?? 0)))} ({signed(pct(figure, s.aop ?? 0))})</div></div>
        <div className="text-[12px] font-semibold text-ink-muted">Why (any that apply)</div>
        <div className="flex flex-wrap gap-1.5">{CAUSES.map(c => <Chip key={c.name} on={causes.includes(c.name)} onClick={() => setCauses(x => x.includes(c.name) ? x.filter(y => y !== c.name) : [...x, c.name])}>{c.name}</Chip>)}</div>
        <textarea data-testid="note" className="min-h-16 rounded-control bg-subtle p-2 text-sm" placeholder="What you know that the model does not: a stock arrival, an event, a display change" value={note} onChange={e => setNote(e.target.value)} />
        {error && <Notice tone="negative">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={busy} disabled={!causes.length && !note.trim()} onClick={() => void send('approval')}>{boss ? `Send to ${boss}` : 'Apply'}</Button>
          <Button variant="secondary" disabled={busy || (!causes.length && !note.trim())} onClick={() => void send('reference')}>Keep as my view</Button>
        </div>
        <p className="text-[12px] text-ink-muted">The forecast and the AOP stay as they are; your number sits beside them{boss ? ` until ${boss} approves it` : ''}.</p>
      </>}
    </div>
  )
}
const Fig = ({ label, value }: { label: string; value: string }) => <div className="rounded-control bg-subtle p-2"><div className="text-[11px] text-ink-muted">{label}</div><div className="font-bold tabular-nums">{value}</div></div>
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) => (
  <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-action bg-action text-on-action' : 'border-border bg-surface text-ink'}`}>{children}</button>)

// ---- Days: 01 to 31, the day beside the month to date; one day line by line; each gap explained ----
interface Scope { store: string; level: string; name: string }
function DaysView({ ctx, scoped, scope, scopeLabel, view, day, practice, next, onSet }: {
  ctx: Ctx; scoped: Sub[]; scope: Scope; scopeLabel: string; view: 'all' | 'one'; day: number; practice: boolean; next?: Level; onSet: (s: State) => void }) {
  const m = ctx.month
  const loaded = practice ? PRACTICE_DAYS : m.loadedTo
  const fcOn = (xs: Sub[], d: number) => sum(xs, s => s.days?.[d - 1] ?? 0)
  const soldOn = (xs: Sub[], d: number) => (d <= loaded ? sum(xs, s => practiceSold(s, d)) : null)
  const wd = (d: number) => WD[new Date(Date.UTC(m.year, m.index, d)).getUTCDay()]
  const dd = (d: number) => `${String(d).padStart(2, '0')}-${m.mon}-${m.year}`
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Days" value={view} onChange={v => onSet({ dview: v === 'all' ? '' : v })} options={[{ value: 'all', label: 'All days' }, { value: 'one', label: `One day · ${String(day).padStart(2, '0')} ${wd(day)}` }]} />
        <label className="flex items-center gap-1.5 text-[12px] text-ink-muted"><input type="checkbox" checked={practice} onChange={e => onSet({ practice: e.target.checked ? '1' : '' })} data-testid="practice" />
          Practice with made-up sales for 01–05 {m.mon}</label>
      </div>
      {!loaded && <span className="text-[12px] text-ink-muted">{m.label} has not started: sold figures appear as days load.</span>}
    </div>)
  const practiceNote = practice && <Notice tone="caution">Practice: the sold figures for 01–05 {m.mon} are made up, so the day views and explaining can be tried before the month starts. Explanations saved now are real rows; remove them after trying.</Notice>
  if (view === 'all') {
    let mf = 0, ma = 0
    return (<div className="flex flex-col gap-3">{header}{practiceNote}
      <Card><div className="overflow-x-auto p-2"><table className="w-full min-w-[760px] border-collapse text-sm" data-testid="days-table">
        <thead>
          <tr className="text-[11px] text-ink-muted"><th /><th colSpan={3} className="px-2 pt-1 text-center font-semibold">The day</th><th colSpan={3} className="bg-action-tint px-2 pt-1 text-center font-semibold text-action">Month to date</th><th /></tr>
          <tr className="text-[12px] text-ink-muted"><th className="px-2 py-1.5 text-start font-semibold">Day</th>{['Forecast', 'Sold', 'vs'].map(h => <th key={h} className="px-2 py-1.5 text-end font-semibold">{h}</th>)}
            {['Forecast', 'Sold', 'vs'].map(h => <th key={`m${h}`} className="bg-action-tint px-2 py-1.5 text-end font-semibold text-action">{h}</th>)}<th className="px-2 py-1.5 text-start font-semibold">Explanation</th></tr>
        </thead>
        <tbody>{Array.from({ length: m.days }, (_, i) => i + 1).map(d => {
          const f = fcOn(scoped, d), a = soldOn(scoped, d)
          mf += f; if (a != null) ma += a
          const off = a == null ? 0 : pct(a, f), moff = a == null ? 0 : pct(ma, mf), hot = a != null && Math.abs(off) > 10
          const weekend = wd(d) === 'Sat' || wd(d) === 'Sun'
          return (<ExplainRows key={d} ctx={ctx} scope={scope} day={d} off={off} title={`Why was ${scopeLabel} ${signed(off)} on ${dd(d)}?`} cols={8} hot={hot} sold={a != null} practice={practice}>
            <td className={`cursor-pointer px-2 py-1.5 whitespace-nowrap ${hot ? (off < 0 ? 'shadow-[inset_3px_0_0_var(--color-negative)]' : 'shadow-[inset_3px_0_0_var(--color-caution)]') : ''}`} onClick={() => onSet({ dview: 'one', day: String(d) })}>
              <b className={weekend ? 'text-opportunity' : ''}>{String(d).padStart(2, '0')}</b> <span className="text-ink-muted">{wd(d)}</span></td>
            <td className={`px-2 text-end tabular-nums ${a == null ? 'text-ink-muted' : ''}`}>{fmtINR(f)}</td>
            <td className="px-2 text-end tabular-nums">{a == null ? '—' : fmtINR(a)}</td>
            <td className="px-2 text-end">{a != null && <StatusPill tone={offTone(off)}>{signed(off)}</StatusPill>}</td>
            <td className={`bg-action-tint/60 px-2 text-end tabular-nums ${a == null ? 'text-ink-muted' : ''}`}>{fmtINR(mf)}</td>
            <td className="bg-action-tint/60 px-2 text-end tabular-nums">{a == null ? '—' : fmtINR(ma)}</td>
            <td className="bg-action-tint/60 px-2 text-end">{a != null && <StatusPill tone={offTone(moff)}>{signed(moff)}</StatusPill>}</td>
          </ExplainRows>)
        })}</tbody></table>
        <p className="px-2 pt-2 text-[12px] text-ink-muted">A day more than 10% off has a coloured edge and asks for an explanation. Click a day to open it line by line.</p></div></Card></div>)
  }
  // One day: the day and the month to date, then the rows one level down, gaps first.
  const key = next ? (s: Sub) => String(s[LEVELS.find(l => l.level === next)!.key] ?? '') : (s: Sub) => s.name
  const f = fcOn(scoped, day), a = soldOn(scoped, day)
  const mf = sum(Array.from({ length: day }, (_, i) => i + 1), d => fcOn(scoped, d))
  const ma = a == null ? null : sum(Array.from({ length: day }, (_, i) => i + 1), d => soldOn(scoped, d) ?? 0)
  const month = sum(scoped, s => s.engine)
  const rows = [...new Set(scoped.map(key))].map(name => {
    const xs = scoped.filter(s => key(s) === name)
    const rf = fcOn(xs, day), ra = soldOn(xs, day), rmf = sum(Array.from({ length: day }, (_, i) => i + 1), d => fcOn(xs, d))
    const rma = ra == null ? null : sum(Array.from({ length: day }, (_, i) => i + 1), d => soldOn(xs, d) ?? 0)
    return { name, rf, ra, rmf, rma, off: ra == null ? 0 : pct(ra, rf), moff: rma == null ? 0 : pct(rma, rmf) }
  }).sort((x, y) => Math.abs(y.off) - Math.abs(x.off))
  const level = next ?? 'Subcategory'
  return (<div className="flex flex-col gap-3">{header}{practiceNote}
    <div className="grid gap-3 md:grid-cols-2" data-testid="day-cards">
      <div className="rounded-card border-l-4 border-action bg-surface p-4 shadow-card">
        <div className="text-[11px] font-bold tracking-wide text-ink-muted uppercase">The day · {dd(day)}, {wd(day)}</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3"><span className="text-2xl font-extrabold tabular-nums">{a == null ? '—' : fmtINR(a)}</span>
          {a != null && <StatusPill tone={offTone(pct(a, f))}>{signed(pct(a, f))}</StatusPill>}<span className="text-sm text-ink-muted">forecast {fmtINR(f)}</span></div>
      </div>
      <div className="rounded-card bg-action-tint p-4 text-action">
        <div className="text-[11px] font-bold tracking-wide uppercase">Month to date · 01–{String(day).padStart(2, '0')} {m.mon}</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3"><span className="text-2xl font-extrabold tabular-nums">{ma == null ? '—' : fmtINR(ma)}</span>
          {ma != null && <StatusPill tone={offTone(pct(ma, mf))}>{signed(pct(ma, mf))}</StatusPill>}<span className="text-sm">forecast {fmtINR(mf)}</span></div>
        <div className="mt-2 h-1.5 rounded-full bg-action/20"><div className="h-1.5 rounded-full bg-action" style={{ width: `${Math.min(100, ((ma ?? 0) / (month || 1)) * 100)}%` }} /></div>
        <div className="mt-1 text-[12px]">{Math.round(((ma ?? 0) / (month || 1)) * 100)}% of the month's {fmtINR(month)} sold so far</div>
      </div>
    </div>
    <Card><div className="flex items-center justify-between gap-2 px-3 pt-3"><div className="text-sm font-semibold">By {level.toLowerCase()} on {dd(day)} · biggest gap first</div>
      <div className="flex gap-1.5"><Button variant="secondary" className="min-h-8 px-2.5" disabled={day <= 1} onClick={() => onSet({ day: String(day - 1) })}>‹ {day > 1 ? String(day - 1).padStart(2, '0') : ''}</Button>
        <Button variant="secondary" className="min-h-8 px-2.5" disabled={day >= m.days} onClick={() => onSet({ day: String(day + 1) })}>{day < m.days ? String(day + 1).padStart(2, '0') : ''} ›</Button></div></div>
      <div className="overflow-x-auto p-2"><table className="w-full min-w-[760px] border-collapse text-sm" data-testid="one-day-table">
        <thead>
          <tr className="text-[11px] text-ink-muted"><th /><th colSpan={3} className="px-2 pt-1 text-center font-semibold">The day</th><th colSpan={3} className="bg-action-tint px-2 pt-1 text-center font-semibold text-action">Month to date</th><th /></tr>
          <tr className="text-[12px] text-ink-muted"><th className="px-2 py-1.5 text-start font-semibold">{level}</th>{['Forecast', 'Sold', 'vs'].map(h => <th key={h} className="px-2 py-1.5 text-end font-semibold">{h}</th>)}
            {['Forecast', 'Sold', 'vs'].map(h => <th key={`m${h}`} className="bg-action-tint px-2 py-1.5 text-end font-semibold text-action">{h}</th>)}<th className="px-2 py-1.5 text-start font-semibold">Explanation</th></tr>
        </thead>
        <tbody>{rows.slice(0, 60).map(r => {
          const hot = r.ra != null && (Math.abs(r.off) > 10 || Math.abs(r.moff) > 10)
          const sc = { store: scope.store, level, name: r.name }
          return (<ExplainRows key={r.name} ctx={ctx} scope={sc} day={day} off={Math.abs(r.off) >= Math.abs(r.moff) ? r.off : r.moff} title={`Why was ${r.name} ${signed(r.off)} on ${dd(day)}?`} cols={8} hot={hot} sold={r.ra != null} practice={practice}>
            <td className={`px-2 py-1.5 ${hot ? (r.off < 0 ? 'shadow-[inset_3px_0_0_var(--color-negative)]' : 'shadow-[inset_3px_0_0_var(--color-caution)]') : ''}`}>{r.name}</td>
            <td className="px-2 text-end tabular-nums">{fmtINR(r.rf)}</td><td className="px-2 text-end tabular-nums">{r.ra == null ? '—' : fmtINR(r.ra)}</td>
            <td className="px-2 text-end">{r.ra != null && <StatusPill tone={offTone(r.off)}>{signed(r.off)}</StatusPill>}</td>
            <td className="bg-action-tint/60 px-2 text-end tabular-nums">{fmtINR(r.rmf)}</td><td className="bg-action-tint/60 px-2 text-end tabular-nums">{r.rma == null ? '—' : fmtINR(r.rma)}</td>
            <td className="bg-action-tint/60 px-2 text-end">{r.rma != null && <StatusPill tone={offTone(r.moff)}>{signed(r.moff)}</StatusPill>}</td>
          </ExplainRows>)
        })}</tbody></table>
        {rows.length > 60 && <p className="px-2 pt-2 text-[12px] text-ink-muted">The 60 biggest gaps of {rows.length}; narrow the filters above for the rest.</p>}</div></Card></div>)
}

/** A row and, under it, its explanation: the causes picked (several, each with detail), a note, and Edit. */
function ExplainRows({ ctx, scope, day, off, title, cols, hot, sold, practice, children }: {
  ctx: Ctx; scope: Scope; day: number; off: number; title: string; cols: number; hot: boolean; sold: boolean; practice: boolean; children: ReactNode }) {
  const m = ctx.month
  const saved = ctx.data.explanations.filter(x => x.month === m.key && x.store === scope.store && x.scope_level === scope.level && x.scope_name === scope.name && Number(x.day) === day)
    .sort((a, b) => b.explained_on.localeCompare(a.explained_on))[0]
  const [editing, setEditing] = useState(false)
  const [tags, setTags] = useState<string[]>([]), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const open = () => { setTags(saved ? saved.causes.split('\n').filter(Boolean) : []); setNote(saved?.note ?? ''); setError(''); setEditing(true) }
  const toggle = (t: string) => {
    const c = causeOf(t)!
    setTags(x => t === c.name ? (x.some(y => causeOf(y) === c) ? x.filter(y => causeOf(y) !== c) : [...x, t])
      : x.includes(t) ? x.filter(y => y !== t) : [...x.filter(y => y !== c.name), t])
  }
  const save = async () => {
    setBusy(true); setError('')
    try {
      await ctx.save('forecasting.explanation', { ...(saved ? { row_id: saved.row_id } : {}), month: m.key, store: scope.store, scope_level: scope.level, scope_name: scope.name, day,
        causes: tags.join('\n'), note: note.trim() || null, explained_by: ctx.viewer.name, explained_by_role: ctx.viewer.role, explained_on: nowIST() })
      await ctx.reload(); setEditing(false)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const mine = !saved || saved.explained_by === ctx.viewer.name
  return (<>
    <tr className="border-t border-border">{children}
      <td className="px-2 py-1">{editing ? null : saved ? (
        <span className="flex flex-wrap items-center gap-1" data-testid="explained">
          {saved.causes.split('\n').filter(Boolean).map(t => <span key={t} className="rounded bg-subtle px-1.5 py-0.5 text-[11px] font-semibold" title={t}>{t.includes(' › ') ? t.split(' › ')[1] : t}</span>)}
          <span className="text-[11px] text-ink-muted">· {saved.explained_by}</span>
          {mine && <button type="button" className="text-[12px] font-semibold text-action hover:underline" onClick={open}>Edit</button>}
        </span>) : sold && hot ? <Button variant="secondary" className="min-h-7 px-2 text-[12px]" onClick={open}>Explain</Button>
        : sold ? <span className="text-[12px] text-ink-muted">—</span> : null}</td>
    </tr>
    {editing && <tr><td colSpan={cols} className="px-2 pb-2">
      <div className="flex flex-col gap-2 rounded-card bg-subtle p-3" data-testid="explain-editor">
        <div className="text-[13px] font-semibold">{title}{practice ? ' (practice figures)' : ''}</div>
        {CAUSES.map(c => { const on = tags.some(t => causeOf(t) === c); return (
          <div key={c.name} className="rounded-control bg-surface p-2">
            <Chip on={on} onClick={() => toggle(c.name)}>{c.name}</Chip>
            {on && <><div className="mt-1.5 flex flex-wrap gap-1.5">{c.subs.map(x => <Chip key={x} on={tags.includes(`${c.name} › ${x}`)} onClick={() => toggle(`${c.name} › ${x}`)}>{x}</Chip>)}</div>
              <div className="mt-1 text-[11px] text-ink-muted">Evidence: {c.evidence}</div></>}
          </div>) })}
        <textarea className="min-h-14 rounded-control bg-surface p-2 text-sm" placeholder="What happened, and whether it carries into the coming days" value={note} onChange={e => setNote(e.target.value)} />
        {error && <Notice tone="negative">{error}</Notice>}
        <div className="flex gap-2"><Button variant="primary" loading={busy} disabled={!tags.length} onClick={() => void save()}>Save</Button>
          <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div>
      </div></td></tr>}
  </>)
}

// ---- How it was built: what each kind of evidence adds, for whatever is in view ----
function HowBuilt({ scoped, scopeLabel, onDays }: { scoped: Sub[]; scopeLabel: string; onDays: () => void }) {
  const fc = sum(scoped, s => s.engine), aop = sum(scoped, s => s.aop ?? 0)
  const adds = (codes: string[]) => sum(scoped, s => sum(codes, c => { const p = s.parts[c as keyof Sub['parts']]; return p ? p[0] * p[1] : 0 }))
  const groups = [
    { name: "Last year's December", what: "Same date and same Christmas position last year, × this year's growth. Weekday-corrected: a Wednesday is compared with a Wednesday.", codes: ['B1', 'B2'], tone: 'bg-action' },
    { name: 'The seasonal step', what: 'The last 28 days × the usual November-to-December jump from past years.', codes: ['B6'], tone: 'bg-opportunity' },
    { name: 'The last few weeks', what: 'The last 28 days, the last four same weekdays, and the same date last month.', codes: ['B3', 'B4', 'B5'], tone: 'bg-positive' },
  ].map(g => ({ ...g, value: adds(g.codes) }))
  const other = fc - sum(groups, g => g.value)
  return (
    <Card><div className="flex max-w-3xl flex-col gap-3 p-4" data-testid="how-built">
      <div className="text-lg font-bold">How the engine reached {fmtINR(fc)} for {scopeLabel}</div>
      <div className="text-sm text-ink-muted">AOP {fmtINR(aop)} · <StatusPill tone={aopTone(fc, aop)}>{aop ? signed(pct(fc, aop)) : 'no AOP'}</StatusPill> · {scoped.length} lines</div>
      <div className="flex h-7 overflow-hidden rounded-control">{groups.filter(g => g.value / (fc || 1) > 0.005).map(g => (
        <div key={g.name} className={`${g.tone} flex items-center justify-center text-[12px] font-bold text-white`} style={{ width: `${(g.value / (fc || 1)) * 100}%` }}>{Math.round((g.value / (fc || 1)) * 100)}%</div>))}</div>
      <div className="flex flex-col gap-2.5">{groups.map(g => (
        <div key={g.name} className="grid grid-cols-[12px_1fr_auto] items-start gap-2.5"><span className={`mt-1 size-3 rounded-sm ${g.tone}`} />
          <span><b>{g.name}</b><br /><span className="text-[13px] text-ink-muted">{g.what}</span></span><b className="tabular-nums">{fmtINR(g.value)}</b></div>))}
        {Math.abs(other) >= 1 && <div className="grid grid-cols-[12px_1fr_auto] gap-2.5"><span /><span className="text-[13px] text-ink-muted">December-only fix, rounding and other steps</span><span className="tabular-nums">{other > 0 ? '+' : '−'}{fmtINR(Math.abs(other))}</span></div>}
      </div>
      <p className="text-[13px] text-ink-muted">The bases are named for what they read, never by their codes ({BASES.map(b => b.code).join(', ')}). Last year's actual, November's run rate and the share within the category come once the warehouse is wired.</p>
      <div><Button variant="secondary" onClick={onDays}>Open its days ›</Button></div>
    </div></Card>
  )
}

