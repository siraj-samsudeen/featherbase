// The Charts page's two drawings, hand-built in SVG as the rest of Featherbase draws its charts (no
// chart library): a month's daily lines (raw base, final, actual) with festival, holiday and partly
// loaded days shaded, and ranked bars of the gap to final. Colours are set in style.css (.fc-chart),
// one set for light and one for dark, checked for colour-blind separation.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { fmtINR } from '@featherbase/shop-floor'
import type { DayRow } from './sales'
import { WEEKDAY, dateOf, weekdayOf, type Month } from './months'

/** actual ÷ forecast − 1: a plus means the forecast was too low. */
export const bias = (actual: number, forecast: number) => (forecast ? actual / forecast - 1 : 0)
/** +9.6%, −3.4%, 0.0% */
export const pct1 = (x: number) => { const p = Math.round(x * 1000) / 10; return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%` }
/** +₹4.21 L, −₹38,000 */
export const signedINR = (x: number) => `${Math.round(x) > 0 ? '+' : Math.round(x) < 0 ? '−' : ''}${fmtINR(Math.abs(x))}`

/** The width an element has, followed as the window changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(Math.floor(el.getBoundingClientRect().width))
    const watch = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return [ref, width] as const
}

/** Clean ticks from 0: steps of 1, 2, 2.5 or 5 × a power of ten. */
function ticksFor(max: number, count: number) {
  if (max <= 0) return [0, 1]
  const raw = max / count, power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(f => f * power).find(s => s >= raw)!
  return Array.from({ length: Math.ceil(max / step - 1e-9) + 1 }, (_, i) => i * step)
}
/** An axis amount on the lakh/crore ladder, no trailing zeros: ₹50,000, ₹2 L, ₹2.5 L, ₹1.2 Cr. */
function axisINR(v: number) {
  const trim = (x: number) => String(Math.round(x * 100) / 100)
  return v < 1e5 ? fmtINR(v) : v < 1e7 ? `₹${trim(v / 1e5)} L` : `₹${trim(v / 1e7)} Cr`
}
const line = (points: [number, number][]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')

export const SERIES = [
  { key: 'base', label: 'Raw base (before the flat uplift)', color: 'var(--chart-base)' },
  { key: 'final', label: 'Final (with the uplift)', color: 'var(--chart-final)' },
  { key: 'actual', label: 'Actual', color: 'var(--chart-actual)' },
] as const

/** The legend: line keys for the three lines, swatches for the shaded days. */
export function Legend({ actualLabel, partial }: { actualLabel: string; partial: boolean }) {
  const key = (color: string, dot = false) => (
    <svg aria-hidden="true" width="22" height="10" className="shrink-0"><line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth={dot ? 2.5 : 2} strokeLinecap="round" />{dot && <circle cx="11" cy="5" r="3.5" fill={color} />}</svg>)
  const band = (fill: string, hatch = false) => <span aria-hidden="true" className={`inline-block size-3 shrink-0 rounded-[3px] ${hatch ? 'fc-hatch' : ''}`} style={hatch ? undefined : { background: fill }} />
  return (
    <ul className="fc-chart flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted" aria-label="Legend">
      <li className="flex items-center gap-1.5">{key(SERIES[0].color)}{SERIES[0].label}</li>
      <li className="flex items-center gap-1.5">{key(SERIES[1].color)}{SERIES[1].label}</li>
      <li className="flex items-center gap-1.5">{key(SERIES[2].color, true)}{actualLabel}</li>
      <li className="flex items-center gap-1.5">{band('var(--chart-festival)')}Festival day</li>
      <li className="flex items-center gap-1.5">{band('var(--chart-holiday)')}Holiday</li>
      {partial && <li className="flex items-center gap-1.5">{band('', true)}Partly loaded day</li>}
    </ul>
  )
}

/**
 * A month's days: raw base and final across the whole month, actual on each day loaded in full, the
 * festival, holiday and partly loaded days shaded. A crosshair and a readout follow the pointer, and
 * the arrow keys once the chart has focus.
 */
export function DailyChart({ month, rows, height, compact = false, label, testId }: {
  month: Month; rows: DayRow[]; height: number; compact?: boolean; label: string; testId?: string
}) {
  const [box, width] = useWidth()
  const [at, setAt] = useState<number | null>(null)
  const hatch = `hatch${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const left = compact ? 52 : 64, right = compact ? 10 : 18
  const plotW = Math.max(10, width - left - right), step = plotW / month.days
  const x = (day: number) => left + (day - 0.5) * step
  // The shaded days are named above the plot, never across the lines: a second row where two would touch.
  const named = compact ? [] : rows.flatMap(r => [...r.events.map(e => e.name), ...(r.state === 'partial' ? ['Partly loaded'] : [])].map(name => ({ day: r.day, name })))
  const ends: number[] = []
  const labels = named.map(l => {
    const half = l.name.length * 3.1 + 4
    let row = ends.findIndex(end => x(l.day) - half > end)
    if (row < 0) { row = ends.length; ends.push(0) }
    ends[row] = x(l.day) + half
    return { ...l, row }
  })
  const m = { left, right, top: 10 + ends.length * 15, bottom: 26 }
  const plotH = height - m.top - m.bottom
  const max = Math.max(1, ...rows.flatMap(r => [r.base, r.final, r.actual ?? 0]))
  const ticks = ticksFor(max * 1.04, compact ? 3 : 4)
  const top = ticks[ticks.length - 1]
  const y = (v: number) => m.top + plotH - (v / top) * plotH
  const sold = rows.filter(r => r.actual != null)
  // The actual line breaks where a day is not loaded in full: it is never drawn as a drop.
  const segments: DayRow[][] = []
  rows.forEach((r, i) => { if (r.actual == null) return; if (i && rows[i - 1].actual != null && segments.length) segments[segments.length - 1].push(r); else segments.push([r]) })
  const last = sold[sold.length - 1]
  const hover = at != null ? rows[at - 1] : null
  const move = (event: PointerEvent<SVGRectElement>) => {
    const rect = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
    setAt(Math.min(month.days, Math.max(1, Math.floor((event.clientX - rect.left - m.left) / step) + 1)))
  }
  const keys = (event: KeyboardEvent<SVGSVGElement>) => {
    const next = event.key === 'ArrowLeft' ? (at ?? 2) - 1 : event.key === 'ArrowRight' ? (at ?? 0) + 1 : event.key === 'Home' ? 1 : event.key === 'End' ? month.days : null
    if (next == null) return
    event.preventDefault()
    setAt(Math.min(month.days, Math.max(1, next)))
  }
  const font = compact ? 10 : 11
  return (
    <div ref={box} className="fc-chart relative w-full" style={{ height }} data-testid={testId}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={keys}
          onFocus={() => setAt(last?.day ?? 1)} onBlur={() => setAt(null)} className="block overflow-visible focus-visible:outline-2 focus-visible:outline-focus">
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--chart-partial-wash)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-partial)" strokeWidth="2" />
            </pattern>
          </defs>
          {rows.map(r => r.events.map(e => (
            <rect key={`${r.day}${e.kind}`} x={x(r.day) - step / 2} y={m.top} width={step} height={plotH} fill={e.kind === 'festival' ? 'var(--chart-festival)' : 'var(--chart-holiday)'} data-band={e.kind} />)))}
          {rows.filter(r => r.state === 'partial').map(r => <rect key={`p${r.day}`} x={x(r.day) - step / 2} y={m.top} width={step} height={plotH} fill={`url(#${hatch})`} data-band="partial" data-day={r.day} />)}
          {ticks.map(t => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} stroke={t ? 'var(--chart-grid)' : 'var(--chart-axis)'} strokeWidth="1" />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={font} fill="var(--color-ink-muted)" className="tabular-nums">{axisINR(t)}</text>
            </g>))}
          {[1, 8, 15, 22, 29].filter(d => d <= month.days).map(d => (
            <g key={d}>
              <line x1={x(d)} x2={x(d)} y1={m.top + plotH} y2={m.top + plotH + 4} stroke="var(--chart-axis)" />
              <text x={x(d)} y={m.top + plotH + 16} textAnchor="middle" fontSize={font} fill="var(--color-ink-muted)">{dateOf(month, d)}</text>
            </g>))}
          {labels.map(l => (
            <text key={`${l.day}${l.name}`} x={x(l.day)} y={m.top - 5 - (ends.length - 1 - l.row) * 15} textAnchor="middle" fontSize={11} fill="var(--color-ink-muted)" data-label={l.name}>{l.name}</text>))}
          <path d={line(rows.map(r => [x(r.day), y(r.base)]))} fill="none" stroke={SERIES[0].color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" data-series="base" data-values={rows.map(r => r.base).join(',')} />
          <path d={line(rows.map(r => [x(r.day), y(r.final)]))} fill="none" stroke={SERIES[1].color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" data-series="final" data-values={rows.map(r => r.final).join(',')} />
          {segments.map(seg => <path key={seg[0].day} d={line(seg.map(r => [x(r.day), y(r.actual!)]))} fill="none" stroke={SERIES[2].color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" data-series="actual" />)}
          {sold.map(r => <circle key={r.day} cx={x(r.day)} cy={y(r.actual!)} r={compact ? 3 : 4} fill={SERIES[2].color} stroke="var(--color-surface)" strokeWidth="2" data-day={r.day} data-actual={r.actual!} />)}
          {last && !compact && (
            <text x={x(last.day) + 8} y={y(last.actual!) - 8} fontSize={12} fontWeight={600} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth="3" paintOrder="stroke">Actual</text>)}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.day)} x2={x(hover.day)} y1={m.top} y2={m.top + plotH} stroke="var(--color-ink-muted)" strokeWidth="1" />
              {[['base', hover.base], ['final', hover.final], ['actual', hover.actual]].map(([k, v]) => v == null ? null
                : <circle key={k as string} cx={x(hover.day)} cy={y(v as number)} r="4" fill={SERIES.find(s => s.key === k)!.color} stroke="var(--color-surface)" strokeWidth="2" />)}
            </g>)}
          <rect x={m.left} y={m.top} width={plotW} height={plotH} fill="transparent" onPointerMove={move} onPointerLeave={() => setAt(null)} />
        </svg>
      )}
      {hover && width > 0 && <Readout month={month} r={hover} top={m.top + 6} left={x(hover.day) + 14 + 230 > width ? x(hover.day) - 14 - 230 : x(hover.day) + 14} />}
    </div>
  )
}

/** The readout beside the crosshair: every line's value on that day, the value first. */
function Readout({ month, r, left, top }: { month: Month; r: DayRow; left: number; top: number }) {
  const row = (color: string, value: string, name: string) => (
    <div className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: color }} />
      <b className="tabular-nums">{value}</b><span className="text-ink-muted">{name}</span></div>)
  return (
    <div role="status" className="pointer-events-none absolute z-10 flex w-[230px] flex-col gap-1 rounded-card border border-border bg-surface p-2.5 text-[13px] shadow-raised" style={{ left, top }} data-testid="readout">
      <div className="font-semibold">{WEEKDAY[weekdayOf(month, r.day)]}, {r.date}</div>
      {r.events.map(e => <div key={e.kind} className="text-ink-muted">{e.name} ({e.kind})</div>)}
      {r.actual != null ? row(SERIES[2].color, fmtINR(r.actual), 'actual')
        : <div className="text-ink-muted">{r.state === 'partial' ? `Partly loaded: ${fmtINR(r.soFar)} in so far (${r.partialStores.join(', ')} still loading)` : 'Not loaded yet'}</div>}
      {row(SERIES[1].color, fmtINR(r.final), 'final')}
      {row(SERIES[0].color, fmtINR(r.base), 'raw base')}
      {r.actual != null && <div className="text-ink-muted">Actual {pct1(bias(r.actual, r.final))} on final</div>}
    </div>
  )
}

/** Ranked bars of the gap to final (actual − final), largest first, from one zero line. */
export function GapBars({ items, caption }: { items: { name: string; actual: number; final: number }[]; caption: string }) {
  const ranked = [...items].sort((a, b) => b.actual - b.final - (a.actual - a.final))
  const gaps = ranked.map(r => r.actual - r.final)
  const lo = Math.min(0, ...gaps), hi = Math.max(0, ...gaps), span = hi - lo || 1
  const zero = (-lo / span) * 100
  return (
    <div className="fc-chart flex flex-col gap-1" role="table" aria-label={caption}>
      {ranked.map((r, i) => {
        const gap = gaps[i], w = (Math.abs(gap) / span) * 100
        return (
          <div key={r.name} role="row" className="grid grid-cols-[11rem_minmax(0,1fr)_12rem] items-center gap-3 rounded-control px-1 py-0.5 text-sm hover:bg-subtle" data-testid="gap-row" data-actual={r.actual} data-final={r.final}
            title={`${r.name}: sold ${fmtINR(r.actual)} against a final of ${fmtINR(r.final)}, ${signedINR(gap)} (${pct1(bias(r.actual, r.final))})`}>
            <span role="cell" className="truncate">{r.name}</span>
            <span role="cell" className="relative h-6" aria-hidden="true">
              <span className="absolute inset-y-0 w-px bg-[var(--chart-axis)]" style={{ left: `${zero}%` }} />
              <span className={`absolute top-1 h-4 bg-[var(--chart-gap)] ${gap >= 0 ? 'rounded-r-[4px]' : 'rounded-l-[4px]'}`}
                style={{ left: `${gap >= 0 ? zero : zero - w}%`, width: `max(${w}%, ${gap ? 2 : 0}px)` }} />
            </span>
            <span role="cell" className="text-end tabular-nums"><b>{signedINR(gap)}</b> <span className="text-ink-muted">{pct1(bias(r.actual, r.final))}</span></span>
          </div>
        )
      })}
    </div>
  )
}
