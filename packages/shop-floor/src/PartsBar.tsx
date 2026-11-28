import { cx } from './cx'

export interface Part { label: string; /** A colour token, `var(--color-part-recent)`. */ color: string; /** Its share of the whole, in %. */ share: number }

/** The parts in words, for the hover and a screen reader: "From recent selling: 59% · …". */
export const partsText = (parts: Part[]) => parts.map((p) => `${p.label}: ${Math.round(p.share)}%`).join(' · ')

/**
 * What a number is built from (Forecasting #1419, TL-15): a 100% stacked bar, or a donut, of its parts. Every bar
 * is full width: it shows the mix, never the size, so bars in a column compare shares, not totals. The hover (and
 * the accessible name) gives each part's share in words; the colours only repeat them. A negative part draws as
 * nothing. The donut's hole is cut out (a mask), so it shows whatever the row's own fill is, hovered or not.
 */
export function PartsBar({ parts, shape = 'bar', className }: { parts: Part[]; shape?: 'bar' | 'donut'; className?: string }) {
  const text = partsText(parts)
  const shown = parts.map((p) => ({ ...p, share: Math.max(0, p.share) }))
  if (shape === 'donut') {
    let at = 0
    const stops = shown.map((p) => { const s = `${p.color} ${at}% ${at + p.share}%`; at += p.share; return s }).join(', ')
    return (
      <span role="img" aria-label={text} title={text} data-parts="donut"
        className={cx('ml-auto block size-[26px] rounded-full [mask:radial-gradient(circle,transparent_6px,white_6.5px)]', className)}
        style={{ background: `conic-gradient(${stops})` }} />
    )
  }
  return (
    // the look kit's small share bar: rounded, its parts set apart by 2px, each part at least 2px
    <span role="img" aria-label={text} title={text} data-parts="bar" className={cx('ml-auto flex h-2 w-[78px] gap-[2px] overflow-hidden rounded-full', className)}>
      {shown.map((p) => <i key={p.label} className="block h-full min-w-[2px]" style={{ flex: `${p.share} 1 0`, background: p.color }} />)}
    </span>
  )
}
