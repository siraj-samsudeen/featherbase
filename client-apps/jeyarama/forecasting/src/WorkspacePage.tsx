// Workspace: one store's month as a grid (store › division › category › subcategory × weeks), beside the
// engine. Click a cell to see every number held for that scope and add your own. An Applied number
// changes the forecast the business runs on (after approval up the reporting line; the Chief
// Executive's at once); a Reference number is kept as a view. Every number is graded at month end.
// The month is the one picked beside "Viewing as": a closed month can be seen but not changed, and its cell panel
// shows each number against what sold; a month with no Run yet has no grid.
import { useMemo, useState } from 'react'
import {
  Button, Card, DrillPane, Field, Headline, Notice, PaneSection, PersonLabel, Segmented, StatusPill, TextInput,
  fmtINR, type StatusTone,
} from '@featherbase/shop-floor'
import {
  ALL_WEEKS, BASES, BASES_MONTH, STORES, SUBS, UPLIFT, fromWeights, inScope, parseWeeks, person, personByName,
  value, weightOf, type Code, type Person, type Scope, type Sub,
} from './madeUp'
import { actualFor, completeTo, daysFor, engineFor, finalWeeks, totalsTo } from './sales'
import { dateOf, monthOf, nowIST, weeksOf, type Month } from './months'
import { areaText, covers } from './areas'
import { NoRunYet, Page, type Ctx, type DecisionRow, type NumberRow } from './App'

const pct = (a: number, b: number) => (b ? Math.round((a / b - 1) * 100) : 0)
const signed = (p: number) => `${p >= 0 ? '+' : ''}${p}%`
export const STATUS_TONE: Record<string, StatusTone> = { Applied: 'positive', Waiting: 'caution', Reference: 'opportunity', 'Not approved': 'negative' }
/** 20-Nov-2026, or 20-Nov-2026 16:05 IST when the stamp has a time (every stamp is IST). */
export const when = (s: string) => {
  const [d, t] = s.split(' ')
  const [y, m, day] = d.split('-').map(Number)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return `${String(day).padStart(2, '0')}-${mon}-${y}${t ? ` ${t} IST` : ''}`
}
export const weeksText = (w: string | null | undefined, m: Month) => (!w ? 'the month' : parseWeeks(w).map(n => weeksOf(m)[n - 1]).join(', '))
export const scopeText = (n: Pick<NumberRow, 'month' | 'store' | 'scope_level' | 'scope_name' | 'weeks'>) =>
  `${n.scope_level === 'Store' ? n.store : `${n.store} · ${n.scope_name}`} · ${weeksText(n.weeks, monthOf(n.month))}`

export function Who({ name, className = 'w-full' }: { name: string; className?: string }) {
  const p = personByName(name)
  return <PersonLabel rowId={p?.code ?? name} name={name} label={p ? { code: p.code, role: p.role, place: p.place } : undefined} canOpen={false} className={className} />
}

const weeksKey = (weeks: number[]) => (weeks.length === 5 ? '' : weeks.join(','))
const sameScope = (n: NumberRow, sc: Scope) => n.store === sc.store && n.scope_level === sc.level && n.scope_name === sc.name && (n.weeks ?? '') === weeksKey(sc.weeks)
const RANK = { Store: 0, Division: 1, Category: 2, Subcategory: 3 }

/** Every subcategory-week after the Applied numbers: the most specific wins, each spread by the engine's shape. */
function adjusted(numbers: NumberRow[], store: string, m: Month) {
  const subs = SUBS.filter(s => s.store === store)
  const adj = new Map(subs.map(s => [s.name, ALL_WEEKS.map(w => finalWeeks(s, m, [w]))]))
  const held = new Set<string>()
  const applied = numbers.filter(n => n.month === m.key && n.store === store && n.status === 'Applied')
    .sort((a, b) => RANK[b.scope_level] * 10 - parseWeeks(b.weeks).length - (RANK[a.scope_level] * 10 - parseWeeks(a.weeks).length))
  for (const n of applied) {
    const cells = subs.filter(s => inScope(s, { store, level: n.scope_level, name: n.scope_name })).flatMap(s => parseWeeks(n.weeks).map(w => [s.name, w - 1] as const))
    const free = cells.filter(([s, w]) => !held.has(`${s}:${w}`))
    const heldSum = cells.filter(([s, w]) => held.has(`${s}:${w}`)).reduce((t, [s, w]) => t + adj.get(s)![w], 0)
    const freeSum = free.reduce((t, [s, w]) => t + adj.get(s)![w], 0)
    const f = freeSum > 0 ? Math.max(0, (n.value - heldSum) / freeSum) : 0
    free.forEach(([s, w]) => { adj.get(s)![w] *= f })
    cells.forEach(([s, w]) => held.add(`${s}:${w}`))
  }
  return adj
}

interface Row { level: Scope['level']; name: string; depth: number; parent?: string; subs: Sub[] }
function rowsFor(store: string, open: Set<string>): Row[] {
  const subs = SUBS.filter(s => s.store === store)
  const rows: Row[] = [{ level: 'Store', name: store, depth: 0, subs }]
  for (const d of [...new Set(subs.map(s => s.division))]) {
    const ds = subs.filter(s => s.division === d)
    rows.push({ level: 'Division', name: d, depth: 1, subs: ds })
    if (!open.has(d)) continue
    for (const c of [...new Set(ds.map(s => s.category))]) {
      const cs = ds.filter(s => s.category === c)
      rows.push({ level: 'Category', name: c, depth: 2, parent: d, subs: cs })
      if (open.has(c)) cs.forEach(s => rows.push({ level: 'Subcategory', name: s.name, depth: 3, parent: c, subs: [s] }))
    }
  }
  return rows
}

export function WorkspacePage({ ctx }: { ctx: Ctx }) {
  const m = ctx.month, closed = m.state === 'closed'
  const params = new URLSearchParams(window.location.search)
  const [store, setStore] = useState(STORES.includes(params.get('store') ?? '') ? params.get('store')! : 'Lakeside')
  /** The store is kept in the address (?store=), so a reload or a shared link opens the same store. */
  const chooseStore = (v: string) => {
    setStore(v); setSel(null)
    const q = new URLSearchParams(window.location.search)
    q.set('store', v)
    for (const k of ['level', 'name', 'weeks', 'pane']) q.delete(k)
    history.replaceState(null, '', `?${q}`)
  }
  const [open, setOpen] = useState(new Set(['Fashion', 'Women Ethnic Wear', 'Girls Bottom']))
  const [sel, setSel] = useState<Scope | null>(() => ({ store: params.get('store') ?? 'Lakeside', level: (params.get('level') as Scope['level']) ?? 'Category',
    name: params.get('name') ?? 'Women Ethnic Wear', weeks: params.get('weeks') ? parseWeeks(params.get('weeks')) : ALL_WEEKS }))
  const [chosenMode, setMode] = useState<'views' | 'why' | 'comments'>((params.get('pane') as 'views') ?? 'views')
  const hasWhy = sel?.level === 'Subcategory' && m.key === BASES_MONTH
  const mode = chosenMode === 'why' && !hasWhy ? 'views' : chosenMode
  const adj = useMemo(() => adjusted(ctx.data.numbers, store, m), [ctx.data.numbers, store, m])
  if (m.state === 'empty') return <Page title="Workspace"><NoRunYet month={m} what="The grid opens then, and numbers can be added to it." /></Page>
  const rows = rowsFor(store, open)
  const sum = (subs: Sub[], weeks: number[], engine = false) => subs.reduce((t, s) => t + weeks.reduce((u, w) => u + (engine ? finalWeeks(s, m, [w]) : adj.get(s.name)![w - 1]), 0), 0)
  const mine = (sc: Scope) => ctx.data.numbers.filter(n => n.month === m.key && sameScope(n, sc))
  const storeSubs = SUBS.filter(s => s.store === store)
  const total = sum(storeSubs, ALL_WEEKS), engine = sum(storeSubs, ALL_WEEKS, true)
  // What sold against the engine: the current month to its last day loaded in full, a closed month whole.
  const to = completeTo(daysFor(m, storeSubs))
  const soldTo = (subs: Sub[]) => totalsTo(daysFor(m, subs), to)
  const { actual: act, final: fc } = soldTo(storeSubs)

  const Cell = ({ r, weeks }: { r: Row; weeks: number[] }) => {
    const sc: Scope = { store, level: r.level, name: r.name, weeks }
    const now = sum(r.subs, weeks), was = sum(r.subs, weeks, true)
    const views = mine(sc)
    const on = sel && sel.store === store && sel.level === r.level && sel.name === r.name && weeksKey(sel.weeks) === weeksKey(weeks)
    const changed = Math.abs(now - was) > 0.5
    return (
      <td className={weeks.length === 5 ? 'bg-subtle/60' : ''}>
        <button type="button" onClick={() => { setSel(sc); setMode('views') }} aria-pressed={!!on}
          className={`flex min-h-11 w-full flex-col items-end justify-center px-2.5 py-1.5 whitespace-nowrap tabular-nums hover:bg-subtle ${on ? 'bg-action-tint ring-2 ring-action ring-inset' : ''}`}>
          {changed && <span className="text-[11px] text-ink-muted line-through">{fmtINR(was)}</span>}
          <span className={changed ? 'font-semibold text-action' : ''}>{fmtINR(now)}</span>
          {views.length > 0 && <span className="mt-0.5 flex gap-1">{views.map(v => <span key={v.row_id} title={`${v.entered_by}: ${v.status}`}
            className={`size-1.5 rounded-full ${v.status === 'Applied' ? 'bg-positive' : v.status === 'Waiting' ? 'bg-caution' : v.status === 'Reference' ? 'bg-opportunity' : 'bg-negative'}`} />)}</span>}
        </button>
      </td>
    )
  }

  return (
    <Page title="Workspace" actions={<Segmented label="Store" value={store} onChange={chooseStore} options={STORES.map(v => ({ value: v, label: v }))} />}>
      <p className="-mt-2 text-sm text-ink-muted">{m.label}{closed ? ' · closed' : ''} · engine Run of {m.origin} ({m.run}) · ₹ before tax · weeks shown here, days on Charts</p>
      {closed && <Notice><span data-testid="closed-month">{m.label} is closed. Its numbers and the grid can be seen, but nothing new can be added or approved. Open a cell to see each number against what sold.</span></Notice>}
      <Headline label={`${m.label} · ${store}`} tone={act >= fc ? 'positive' : 'caution'}
        conclusion={`${fmtINR(act)} sold ${closed ? `in ${m.name}` : `to ${dateOf(m, to)}`}, ${Math.abs(pct(act, fc))}% ${act >= fc ? 'ahead of' : 'behind'} the forecast`}
        detail={<>Applied for the month {fmtINR(total)} · engine {fmtINR(engine)}{Math.abs(total - engine) > 1 ? ` · people's numbers change it by ${total > engine ? '+' : '−'}${fmtINR(Math.abs(total - engine))}` : ' · no number applied yet'}</>}
        progress={{ value: Math.round((act / total) * 1000) / 10, marker: Math.round((fc / total) * 1000) / 10, label: closed ? 'Sold against the applied month figure' : 'Sold so far against the applied month figure' }} />
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-muted">
        <span>A struck-through figure is the engine's; the one below it is after the Applied numbers.</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-positive" />Applied</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-caution" />Waiting</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-opportunity" />Reference</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-negative" />Not approved</span>
      </div>
      {/* The cell panel sits beside the grid from 1280 px, so a 1440 px screen shows both (the grid needs about 772 px). */}
      <div className={`grid items-start gap-4 ${sel ? 'xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]' : ''}`}>
        <Card>
          <div className="overflow-x-auto p-2">
            <table className="w-full min-w-[720px] border-collapse text-sm" data-testid="grid">
              <thead><tr className="text-[12px] text-ink-muted">
                <th className="px-2.5 py-2 text-start font-semibold">{store}</th>
                {weeksOf(m).map(w => <th key={w} className="px-2.5 py-2 text-end font-semibold whitespace-nowrap">{w}</th>)}
                <th className="px-2.5 py-2 text-end font-semibold">{m.name}</th>
                <th className="px-2.5 py-2 text-end font-semibold whitespace-nowrap">{closed ? 'Month end' : 'Running'}</th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const { actual: a, final: f } = soldTo(r.subs)
                  const canOpen = r.level === 'Division' || r.level === 'Category'
                  return (
                    <tr key={`${r.level}-${r.name}`} className="border-t border-border">
                      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ paddingLeft: `${10 + r.depth * 18}px` }}>
                        {canOpen && <button type="button" aria-label={open.has(r.name) ? `Fold ${r.name}` : `Open ${r.name}`} className="mr-1 inline-block w-4 text-ink-muted"
                          onClick={() => { const o = new Set(open); o.has(r.name) ? o.delete(r.name) : o.add(r.name); setOpen(o) }}>{open.has(r.name) ? '▾' : '▸'}</button>}
                        <span className={r.depth <= 1 ? 'font-bold' : r.depth === 2 ? 'font-semibold' : ''}>{r.name}</span>
                      </td>
                      {ALL_WEEKS.map(w => <Cell key={w} r={r} weeks={[w]} />)}
                      <Cell r={r} weeks={ALL_WEEKS} />
                      <td className="px-2.5 text-end"><StatusPill tone={a >= f ? 'positive' : 'caution'}>{signed(pct(a, f))}</StatusPill></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
        {sel && sel.store === store && (
          <div className="sticky top-4 overflow-hidden rounded-card">
            <DrillPane place="right" kind={`${store} · ${weeksText(weeksKey(sel.weeks), m)}`} title={sel.level === 'Store' ? `${store}, whole store` : sel.name} onClose={() => setSel(null)}
              actions={<Segmented label="Pane" value={mode} onChange={setMode} options={[
                { value: 'views', label: `Views (${mine(sel).length + 1})` },
                ...(hasWhy ? [{ value: 'why' as const, label: 'Why' }] : []),
                { value: 'comments', label: 'Comments' }]} />}>
              {mode === 'views' && <Views key={`${m.key}${JSON.stringify(sel)}`} ctx={ctx} sc={sel} now={sum(SUBS.filter(s => inScope(s, sel)), sel.weeks)} numbers={mine(sel)} />}
              {mode === 'why' && hasWhy && <Why s={SUBS.find(s => s.store === store && s.name === sel.name)!} />}
              {mode === 'comments' && <Comments ctx={ctx} sc={sel} />}
            </DrillPane>
          </div>
        )}
      </div>
    </Page>
  )
}

function Why({ s }: { s: Sub }) {
  const blend = BASES.reduce((n, b) => n + weightOf(s, b.code) * (value(s, b.code) ?? 0), 0)
  return (
    <PaneSection title={`Why the engine says ${fmtINR(s.engine)} for November`}>
      <table className="w-full text-sm">
        <thead><tr className="text-[13px] text-ink-muted"><th className="py-1 text-start font-medium">Basis</th><th className="text-end font-medium">Weight</th><th className="text-end font-medium">Its value</th><th className="text-end font-medium">₹ it adds</th></tr></thead>
        <tbody>
          {BASES.map(b => { const w = weightOf(s, b.code); const v = value(s, b.code) ?? 0; return (
            <tr key={b.code} className={w ? '' : 'text-ink-muted'}>
              <td className="py-1.5"><span className="font-medium">{b.code}</span> <span className="text-[13px]">{b.name}</span></td>
              <td className="text-end tabular-nums">{Math.round(w * 100)}%</td>
              <td className="text-end tabular-nums whitespace-nowrap">{fmtINR(v)}</td>
              <td className="text-end tabular-nums whitespace-nowrap">{w ? fmtINR(w * v) : '—'}</td>
            </tr>) })}
          <tr className="border-t border-border"><td className="py-1.5">Blend of the bases</td><td /><td /><td className="text-end tabular-nums">{fmtINR(blend)}</td></tr>
          <tr><td className="py-1.5">{Math.round(UPLIFT * 100)}% uplift (a judgement call)</td><td /><td /><td className="text-end tabular-nums">+ {fmtINR(blend * UPLIFT)}</td></tr>
          <tr className="border-t border-border font-semibold"><td className="py-1.5">Engine's November figure</td><td /><td /><td className="text-end tabular-nums">{fmtINR(s.engine)}</td></tr>
        </tbody>
      </table>
      <p className="text-[13px] text-ink-muted">Each basis's own value is stored by the engine, so a weight change recomputes this subcategory alone; nothing re-runs.</p>
    </PaneSection>
  )
}

const nextUp = (p: Person) => (p.reportsTo ? person(p.reportsTo) : null)
/** Every time written by the page is IST (months.ts). */
const stamp = nowIST
/** One step in a number's history, naming the number's exact scope (the server checks the decider's area). */
export const logRow = (ctx: Ctx, n: NumberRow, decision: string, note: string) => ({ number: n.row_id, month: n.month, store: n.store, scope_level: n.scope_level,
  scope_name: n.scope_name, weeks: n.weeks ?? '', decision, decided_by: ctx.viewer.name, decided_by_role: ctx.viewer.role, decided_on: stamp(), note })

function Views({ ctx, sc, now, numbers }: { ctx: Ctx; sc: Scope; now: number; numbers: NumberRow[] }) {
  const m = ctx.month, closed = m.state === 'closed'
  const engine = engineFor(sc, m.key)
  // A closed month's numbers are each set against what sold, for the same scope and weeks.
  const sold = closed ? actualFor(sc, m.key) : null
  const sorted = [...numbers].sort((a, b) => a.entered_on.localeCompare(b.entered_on))
  const anyApplied = sorted.some(n => n.status === 'Applied')
  const [adding, setAdding] = useState(false)
  const mine = covers(ctx.viewer, sc)
  return (
    <>
      {!mine && <Notice><span data-testid="read-only">Read only for you: this cell is outside your area ({areaText(ctx.viewer)}). You can see every number here; adding, applying, approving, promoting and withdrawing are for the people whose area it is.</span></Notice>}
      <div className={`grid gap-2 rounded-card bg-subtle p-3 text-sm ${sold != null ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div><div className="text-[13px] text-ink-muted">Engine</div><div className="text-lg font-semibold tabular-nums">{fmtINR(engine)}</div></div>
        <div><div className="text-[13px] text-ink-muted">After Applied numbers</div><div className="text-lg font-semibold tabular-nums">{fmtINR(now)} <span className="text-sm font-normal text-ink-muted">{Math.abs(now - engine) > 1 ? signed(pct(now, engine)) : ''}</span></div></div>
        {sold != null && <div data-testid="sold"><div className="text-[13px] text-ink-muted">What sold</div><div className="text-lg font-semibold tabular-nums">{fmtINR(sold)}</div></div>}
      </div>
      <ol className="flex flex-col gap-3" data-testid="views-list">
        <li className="flex flex-col gap-1 rounded-card bg-subtle p-3">
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><span className="font-medium">Engine</span><StatusPill tone={anyApplied ? 'neutral' : 'positive'}>{anyApplied ? 'Model' : 'Applied'}</StatusPill></span>
            <span className="font-semibold tabular-nums">{fmtINR(engine)}</span>
          </span>
          {sold != null && <span className="text-[13px] text-ink-muted">{signed(pct(engine, sold))} on what sold</span>}
        </li>
        {sorted.map(n => <NumberCard key={n.row_id} ctx={ctx} n={n} engine={engine} sold={sold} siblings={sorted} />)}
      </ol>
      {now !== engine && !anyApplied && <Notice>This scope moved because an Applied number above or below it was spread here.</Notice>}
      {closed ? <p className="text-[13px] text-ink-muted" data-testid="closed-no-add">{m.label} is closed: no number can be added or approved.</p>
        : !mine ? null : adding ? <AddNumber ctx={ctx} sc={sc} engine={engine} onDone={() => setAdding(false)} />
          : <div><Button variant="primary" onClick={() => setAdding(true)} data-testid="add-number">Add your number</Button></div>}
    </>
  )
}

const howText = (n: NumberRow) => {
  if (n.kind === 'Change the weights' && n.weights_json) {
    const w = JSON.parse(n.weights_json) as Record<string, number>
    return `Changed the weights: ${Object.entries(w).filter(([, v]) => v).map(([k, v]) => `${k} ${v}%`).join(', ')}`
  }
  return n.kind
}

function NumberCard({ ctx, n, engine, sold, siblings }: { ctx: Ctx; n: NumberRow; engine: number; sold: number | null; siblings: NumberRow[] }) {
  const history = ctx.data.decisions.filter(d => d.number === n.row_id).sort((a, b) => a.decided_on.localeCompare(b.decided_on))
  // Acting on a number (approving, promoting) is for people whose area its scope is; anyone may look.
  const open = ctx.month.state === 'current' && covers(ctx.viewer, { store: n.store, level: n.scope_level, name: n.scope_name })
  const waitsForMe = open && n.status === 'Waiting' && n.waiting_on === ctx.viewer.name
  const [note, setNote] = useState('')
  const up = nextUp(ctx.viewer)
  const log = (row: NumberRow, decision: string, text: string) => ctx.save('forecasting.decision', logRow(ctx, row, decision, text))
  const settle = siblings.filter(o => o.row_id !== n.row_id && (o.status === 'Applied' || (o.status === 'Waiting' && o.waiting_on === ctx.viewer.name)))
  const decide = async (decision: string, change: Partial<NumberRow>, others: NumberRow[] = []) => {
    await ctx.save('forecasting.number', { ...n, ...change, changed_by: ctx.viewer.name }); await log(n, decision, note)
    for (const o of others) { await ctx.save('forecasting.number', { ...o, status: 'Reference', waiting_on: null, changed_by: ctx.viewer.name }); await log(o, 'Kept as reference', `${n.entered_by}'s number was applied instead.`) }
    await ctx.reload()
  }
  // Anyone senior can make a Reference number the applied one, inside their area, saying why; the applied one it
  // replaces becomes Reference. Only the Chief Executive replaces the Chief Executive's applied number.
  const canPromote = open && n.status === 'Reference' && (!up || ['Store Manager', 'Chief Executive', 'Operations Head'].includes(ctx.viewer.role))
  const ceoHolds = siblings.some(o => o.row_id !== n.row_id && o.status === 'Applied' && o.entered_by_role === 'Chief Executive') && ctx.viewer.role !== 'Chief Executive'
  const [why, setWhy] = useState('')
  return (
    <li className={`flex flex-col gap-2 rounded-card p-3 ${n.status === 'Applied' ? 'bg-positive-tint' : 'bg-subtle'}`} data-testid="number-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1"><Who name={n.entered_by} /></div>
        <span className="text-lg font-semibold tabular-nums">{fmtINR(n.value)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={STATUS_TONE[n.status]}>{n.status === 'Waiting' ? `Waiting for ${n.waiting_on}` : n.status}</StatusPill>
        <span className="text-[13px] text-ink-muted">{howText(n)} · {signed(pct(n.value, engine))} on the engine · {when(n.entered_on)}</span>
      </div>
      <p className="text-sm">{n.reason}</p>
      {sold != null && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="against-sold">
          <span>{signed(pct(n.value, sold))} on what sold ({fmtINR(sold)}); the engine {signed(pct(engine, sold))}</span>
          <StatusPill tone={Math.abs(n.value - sold) < Math.abs(engine - sold) ? 'positive' : 'negative'}>{Math.abs(n.value - sold) < Math.abs(engine - sold) ? 'Closer than the engine' : 'Further than the engine'}</StatusPill>
        </div>
      )}
      {history.length > 0 && (
        <ol className="flex flex-col gap-1 border-l-2 border-border pl-3 text-[13px]">
          {history.map(h => <li key={h.row_id}><span className="text-ink-muted">{when(h.decided_on)}</span> · <b>{h.decided_by}</b>: {h.decision}{h.note ? ` · ${h.note}` : ''}</li>)}
        </ol>
      )}
      {waitsForMe && (
        <div className="flex flex-col gap-2 rounded-control bg-surface p-2" data-testid="decide">
          <span className="text-sm font-medium">This waits for you</span>
          <TextInput placeholder="A note (needed to say no)" value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={ceoHolds} onClick={() => void decide('Approved and applied', { status: 'Applied', waiting_on: null }, settle)}>Approve and apply</Button>
            {up && <Button variant="secondary" onClick={() => void decide('Sent up', { waiting_on: up.name })}>Send up to {up.name}</Button>}
            <Button variant="secondary" disabled={!note.trim()} onClick={() => void decide('Not approved', { status: 'Not approved', waiting_on: null })}>Not approved</Button>
          </div>
          {ceoHolds ? <span className="text-[13px] text-ink-muted">The Chief Executive's number is applied here; only the Chief Executive can replace it. You can send this up or say no.</span>
            : settle.length > 0 && <span className="text-[13px] text-ink-muted">Approving this keeps {settle.map(o => `${o.entered_by}'s ${fmtINR(o.value)}`).join(' and ')} as reference.</span>}
        </div>
      )}
      {canPromote && (ceoHolds
        ? <p className="text-[13px] text-ink-muted" data-testid="ceo-holds">The Chief Executive's number is applied here; only the Chief Executive can replace it.</p>
        : <div className="flex flex-col gap-2 rounded-control bg-surface p-2" data-testid="promote">
          <TextInput placeholder="Why make this the applied number? (required)" value={why} onChange={e => setWhy(e.target.value)} data-testid="promote-why" />
          <div><Button variant="secondary" disabled={!why.trim()} onClick={() => { void (async () => {
            await ctx.save('forecasting.number', { ...n, status: 'Applied', waiting_on: null, changed_by: ctx.viewer.name }); await log(n, 'Made the applied number', why)
            for (const o of siblings.filter(o => o.row_id !== n.row_id && o.status === 'Applied')) { await ctx.save('forecasting.number', { ...o, status: 'Reference', changed_by: ctx.viewer.name }); await log(o, 'Kept as reference', `${n.entered_by}'s number was made the applied one instead.`) }
            await ctx.reload() })() }}>Make this the applied number</Button></div>
        </div>)}
    </li>
  )
}

type Kind = 'Set a total' | 'Change by a percent' | 'Closure or event' | 'Change the weights'
function AddNumber({ ctx, sc, engine, onDone }: { ctx: Ctx; sc: Scope; engine: number; onDone: () => void }) {
  const sub = sc.level === 'Subcategory' && sc.weeks.length === 5 ? SUBS.find(s => s.store === sc.store && s.name === sc.name) : undefined
  const [kind, setKind] = useState<Kind>('Set a total')
  const [mode, setMode] = useState<'apply' | 'reference'>('apply')
  const [figure, setFigure] = useState(''), [percent, setPercent] = useState(''), [reason, setReason] = useState('')
  const [w, setW] = useState<Partial<Record<Code, number>>>(() => sub ? Object.fromEntries(BASES.map(b => [b.code, Math.round(weightOf(sub, b.code) * 100)])) : {})
  const sumW = BASES.reduce((n, b) => n + (Number(w[b.code]) || 0), 0)
  const next = kind === 'Set a total' ? Number(figure.replace(/[^0-9.]/g, '')) || 0
    : kind === 'Change the weights' && sub ? Math.round(fromWeights(sub, w))
      : Math.round(engine * (1 + (Number(percent.replace(/[^0-9.-]/g, '')) || 0) / 100))
  const ready = reason.trim() && next >= 0 && (kind !== 'Set a total' || figure.trim()) && (kind !== 'Change the weights' || sumW === 100) && (kind === 'Set a total' || kind === 'Change the weights' || percent.trim())
  const up = nextUp(ctx.viewer)
  const kinds: Kind[] = ['Set a total', 'Change by a percent', 'Closure or event', ...(sub ? ['Change the weights' as Kind] : [])]
  const send = async () => {
    const direct = mode === 'reference' || !up
    const status = mode === 'reference' ? 'Reference' : direct ? 'Applied' : 'Waiting'
    const saved = await ctx.save('forecasting.number', {
      month: ctx.month.key, run: ctx.month.run, store: sc.store, section: sub?.section ?? '', scope_level: sc.level, scope_name: sc.name, weeks: weeksKey(sc.weeks),
      kind, value: next, weights_json: kind === 'Change the weights' ? JSON.stringify(w) : null,
      entered_by: ctx.viewer.name, entered_by_role: ctx.viewer.role, entered_on: stamp(), reason, status, waiting_on: status === 'Waiting' ? up!.name : null, changed_by: ctx.viewer.name })
    await ctx.save('forecasting.decision', logRow(ctx, saved as unknown as NumberRow,
      status === 'Reference' ? 'Kept as reference' : status === 'Applied' ? 'Approved and applied' : 'Sent for approval',
      status === 'Waiting' ? `To ${up!.name}` : status === 'Applied' ? "The Chief Executive's number applies without approval." : 'Held as a view.'))
    if (status === 'Applied') for (const o of ctx.data.numbers.filter(o => o.month === ctx.month.key && sameScope(o, sc) && o.status === 'Applied')) await ctx.save('forecasting.number', { ...o, status: 'Reference', changed_by: ctx.viewer.name })
    await ctx.reload(); onDone()
  }
  return (
    <div className="flex flex-col gap-3 rounded-card bg-subtle p-3" data-testid="add-form">
      <div className="grid grid-cols-2 gap-1.5">
        {kinds.map(k => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
          className={`rounded-control border px-2.5 py-1.5 text-start text-[13px] ${kind === k ? 'border-action font-semibold text-action' : 'border-transparent bg-surface'}`}>{k}</button>)}
      </div>
      {kind === 'Set a total' && <Field label={`Total for ${weeksText(weeksKey(sc.weeks), ctx.month)}, before tax (₹)`} hint="Spread across the cells below by the engine's own shape."><TextInput data-testid="figure" inputMode="numeric" value={figure} placeholder={String(Math.round(engine))} onChange={e => setFigure(e.target.value)} /></Field>}
      {kind === 'Change by a percent' && <Field label="Change on the engine (%)"><TextInput data-testid="percent" inputMode="numeric" value={percent} placeholder="+10 or −5" onChange={e => setPercent(e.target.value)} /></Field>}
      {kind === 'Closure or event' && <Field label="Effect (%)" hint="−100 for a closure; a smaller change for an event such as road work or a refit."><TextInput data-testid="percent" inputMode="numeric" value={percent} placeholder="−100" onChange={e => setPercent(e.target.value)} /></Field>}
      {kind === 'Change the weights' && sub && (
        <table className="w-full text-sm"><tbody>
          {BASES.map(b => (
            <tr key={b.code}>
              <td className="py-1"><span className="font-medium">{b.code}</span> <span className="text-[13px] text-ink-muted">{b.name}</span></td>
              <td className="text-end tabular-nums whitespace-nowrap">{fmtINR(value(sub, b.code) ?? 0)}</td>
              <td className="pl-2 text-end"><TextInput aria-label={`${b.code} weight`} data-testid={`w-${b.code}`} inputMode="numeric" className="w-16 text-end" value={String(w[b.code] ?? 0)} onChange={e => setW({ ...w, [b.code]: Number(e.target.value.replace(/\D/g, '')) })} /></td>
            </tr>))}
          <tr className="border-t border-border"><td className="py-1.5 font-medium">Total</td><td /><td className="text-end"><StatusPill tone={sumW === 100 ? 'positive' : 'negative'}>{sumW}%</StatusPill></td></tr>
        </tbody></table>
      )}
      <div className="grid grid-cols-3 gap-2 rounded-control bg-surface p-2 text-sm">
        <div><div className="text-[13px] text-ink-muted">Engine</div><div className="font-semibold tabular-nums">{fmtINR(engine)}</div></div>
        <div><div className="text-[13px] text-ink-muted">Yours</div><div className="font-semibold tabular-nums">{ready || next ? fmtINR(next) : '—'}</div></div>
        <div><div className="text-[13px] text-ink-muted">Change</div><div className="font-semibold tabular-nums">{signed(pct(next, engine))}</div></div>
      </div>
      <Segmented label="What it does" value={mode} onChange={setMode} options={[{ value: 'apply', label: 'Apply it' }, { value: 'reference', label: 'Reference only' }]} />
      <Field label="Why (required)"><textarea data-testid="reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="What do you know that the engine doesn't?" className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-control text-ink" /></Field>
      {mode === 'reference' ? <Notice>Kept beside the engine as your view. It changes nothing, and it is graded at month end like every number.</Notice>
        : up ? <div className="flex flex-col gap-1 text-sm"><span className="text-ink-muted">Goes for approval to</span><Who name={up.name} /></div>
          : <Notice>As Chief Executive, your number applies straight away.</Notice>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!ready} onClick={() => void send()}>{mode === 'reference' ? 'Save as reference' : up ? 'Send for approval' : 'Apply'}</Button>
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  )
}

function Comments({ ctx, sc }: { ctx: Ctx; sc: Scope }) {
  const notes: DecisionRow[] = ctx.data.decisions.filter(d => !d.number && d.month === ctx.month.key && d.store === sc.store && d.scope_name === (sc.level === 'Store' ? sc.store : sc.name))
  const [kind, setKind] = useState<'Comment' | 'This is wrong'>('Comment')
  const [text, setText] = useState('')
  const post = async () => {
    await ctx.save('forecasting.decision', { month: ctx.month.key, store: sc.store, scope_name: sc.level === 'Store' ? sc.store : sc.name, decision: kind, decided_by: ctx.viewer.name, decided_by_role: ctx.viewer.role, decided_on: stamp(), note: text })
    setText(''); await ctx.reload()
  }
  return (
    <>
      <ol className="flex flex-col gap-3">
        {notes.length === 0 && <li className="text-sm text-ink-muted">No comments yet.</li>}
        {[...notes].sort((a, b) => a.decided_on.localeCompare(b.decided_on)).map(n => (
          <li key={n.row_id} className="flex flex-col gap-1.5 rounded-card bg-subtle p-3">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><Who name={n.decided_by} /></div><span className="text-[13px] text-ink-muted">{when(n.decided_on)}</span></div>
            {n.decision === 'This is wrong' && <div><StatusPill tone="negative">This is wrong</StatusPill></div>}
            <p className="text-sm">{n.note}</p>
          </li>))}
      </ol>
      {ctx.month.state === 'closed' ? <p className="text-[13px] text-ink-muted">{ctx.month.label} is closed: its comments can be read, not added to.</p> : <div className="flex flex-col gap-2">
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'Comment', label: 'Comment' }, { value: 'This is wrong', label: 'This is wrong' }]} />
        <textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={kind === 'This is wrong' ? 'What is wrong, and what should it be?' : 'Write a comment'} className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-control text-ink" />
        <div><Button variant="primary" disabled={!text.trim()} onClick={() => void post()}>Post</Button></div>
      </div>}
    </>
  )
}
