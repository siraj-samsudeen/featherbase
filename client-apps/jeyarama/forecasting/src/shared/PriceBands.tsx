// By Price Band (#1419, approved 28-Nov-2026), under an opened subcategory, and the section's "Short of stock" card
// above the review table. Shared, so every review page that opens a subcategory shows the same bands.
import { Fragment, useState } from 'react'
import { ChevronRight, Notice, cx } from '@featherbase/shop-floor'
import { count, day, inr, type Line } from './model'
import { GAP_POINTS, coverOf, daysLeft, gapOf, gapTone, isShort, notSelling, shortBands, type Band } from './bands'
import type { Header } from './review'

/** "6 days" (red when the band runs out before the month ends), "Not selling", or — with no forecast. */
function Lasts({ b, month, left }: { b: Band; month: Header['month']; left: number }) {
  const c = coverOf(b, month.days)
  if (c == null) return notSelling(b) ? <span className="fr-dim">Not selling</span> : <>—</>
  return <span className={cx(isShort(b, month.days, left) && 'fr-short')}>{count(Math.round(c))} {Math.round(c) === 1 ? 'day' : 'days'}</span>
}

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`)

/** Share of stock − share of sales, signed, in points: red when stock is well short of its sales share, purple when well over. */
function Gap({ b }: { b: Band }) {
  const g = gapOf(b), tone = gapTone(g)
  if (g == null) return <td>—</td>
  const r = Math.round(g)
  return <td className={cx(tone === 'short' && 'fr-short', tone === 'over' && 'fr-over')}>{r > 0 ? '+' : r < 0 ? '−' : ''}{Math.abs(r)} pts</td>
}

function TopItems({ b }: { b: Band }) {
  return (
    <div className="fr-band-items">
      <table className="fr-mini">
        <thead><tr><th>Top items, last 28 days</th><th>Pieces</th><th>Value</th><th>Stock now</th></tr></thead>
        <tbody>{b.items.length ? b.items.map(i => (
          <tr key={i.code}><td>{i.name} <span className="fr-dim">{i.code}</span></td><td>{count(i.qty)}</td><td>{inr(i.value)}</td>
            <td className={cx(i.stock === 0 && 'fr-short')}>{count(i.stock)}</td></tr>))
          : <tr><td colSpan={4} className="fr-dim">Nothing sold in this band in the last 28 days.</td></tr>}</tbody>
      </table>
      {b.n50 != null && <p className="fr-dim fr-pareto">{b.n50} of {b.sold} items sold make 50% of the band's sales; {b.n70 ?? b.n50} make 70%.</p>}
    </div>
  )
}

/** The bands of one subcategory. `open` and `onOpen` let a page open a band from outside (the short-of-stock card). */
export function PriceBands({ line, header, open: openFromPage, onOpen }: { line: Line; header: Header; open?: string | null; onOpen?: (band: string | null) => void }) {
  const [own, setOwn] = useState<string | null>(null)
  const open = onOpen ? openFromPage ?? null : own
  const toggle = (name: string) => { const next = open === name ? null : name; if (onOpen) onOpen(next); else setOwn(next) }
  if (!line.bands?.length || !header.stockAsOf) return null
  const asOf = day(header.stockAsOf), left = daysLeft(header.stockAsOf, header.month), m = header.month
  return (
    <section className="fr-bands" data-testid="price-bands">
      <h4>By Price Band <span className="fr-dim fr-sub">{m.name}'s forecast split like the last 28 days' sales; stock as of {asOf}</span></h4>
      <table className="fr-mini fr-band-table">
        <thead><tr><th>Price band</th><th>Forecast</th><th>Pieces</th><th title="The band's share of the subcategory's pieces sold in the last 28 days">Share of sales</th><th title="The band's share of the subcategory's stock, in pieces">Share of stock</th><th title="Share of stock minus share of sales, in points">Gap</th><th>Stock, pieces</th><th>Lasts, at {m.name}'s pace</th><th>Items sold</th></tr></thead>
        <tbody>{line.bands.map(b => {
          const isOpen = open === b.name
          return (
            <Fragment key={b.name}>
              <tr className="fr-band-row" data-band={b.name} onClick={e => { e.stopPropagation(); toggle(b.name) }}>
                <td><span className="fr-name"><span className="fr-twisty" aria-hidden><ChevronRight size={14} className={cx('transition-transform motion-reduce:transition-none', isOpen && 'rotate-90')} /></span>
                  <button type="button" className="fr-band-name" aria-expanded={isOpen} onClick={e => { e.stopPropagation(); toggle(b.name) }}>{b.name}</button></span></td>
                <td>{b.fc ? inr(b.fc) : '—'}</td><td>{b.fq ? count(Math.round(b.fq)) : '—'}</td><td>{pct(b.shareSales)}</td><td>{pct(b.shareStock)}</td><Gap b={b} />
                <td>{count(b.stock)}</td><td><Lasts b={b} month={m} left={left} /></td><td>{b.sold ? count(b.sold) : '—'}</td>
              </tr>
              {isOpen && <tr className="fr-band-open"><td colSpan={9}><TopItems b={b} /></td></tr>}
            </Fragment>)
        })}</tbody>
      </table>
      <p className="fr-dim fr-foot">Red: stock runs out before {m.days}-{m.name.slice(0, 3)} ({left} days from {asOf}) at {m.name}'s forecast pace. Share of sales and share of stock are in pieces, over the bands that sell; “Never sold (90 d)” and bands without a published price are left out so they don't distort the shares. Stock should follow sales: a gap of more than {GAP_POINTS} points is red when stock is short of its sales share and purple when it holds too much. Click a band for its top five items.</p>
    </section>
  )
}

/** Above the review table: the section's bands whose stock runs out before the month ends, the five biggest
 *  shortfalls; each opens its subcategory with that band open. Nothing when no band is short. */
export function ShortOfStock({ lines, header, onOpen }: { lines: Line[]; header: Header; onOpen: (line: string, band: string) => void }) {
  if (!header.stockAsOf) return null
  const short = shortBands(lines, header.month.days, daysLeft(header.stockAsOf, header.month))
  if (!short.length) return null
  return (
    <Notice tone="caution" className="mb-3">
      <div data-testid="short-of-stock">
        <b>Short of stock for {header.month.name}</b>{' '}
        <span className="fr-dim">{short.length} subcategory price {short.length === 1 ? 'band runs' : 'bands run'} out before {header.month.days}-{header.month.name.slice(0, 3)} at {header.month.name}'s pace</span>
        <ul className="fr-short-list">{short.slice(0, 5).map(s => (
          <li key={`${s.line.name}|${s.band.name}`}>
            <button type="button" className="fr-link" onClick={() => onOpen(s.line.name, s.band.name)}>{s.line.name} · {s.band.name}</button>{' '}
            <span className="fr-dim">{count(s.band.stock)} in stock for {count(Math.round(s.band.fq))} forecast</span>
          </li>))}</ul>
      </div>
    </Notice>
  )
}
