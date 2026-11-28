// Needs Your Attention (#1419; Siraj 28-Nov-2026, prototype data-warehouse bab55dd97): its own page, one tab per kind
// of action so each has its place. The header answer is the two totals (sales you may lose, stock not earning), never
// added together, and transfers are not counted again: they are one way to act on the same rupees. Colour carries
// meaning only: red = sales you may lose, purple = stock not earning, grey = data to fix. Shared, so other review
// pages can show their own findings the same way.
import { useState } from 'react'
import { cx } from '@featherbase/shop-floor'
import { day, inr } from './model'
import { ATTENTION_SETTINGS as T, type Finding } from './findings'
import type { Header } from './review'

type TabKey = 'short' | 'follow' | 'topout' | 'transfers' | 'hidden' | 'dead' | 'over' | 'data'
interface Tab { key: TabKey; label: string; kinds: Finding['kind'][]; about: (m: Header['month']) => string }

const endOf = (m: Header['month']) => `${m.days}-${m.name.slice(0, 3)}`
export const ATTENTION_TABS: Tab[] = [
  { key: 'short', label: 'Will Run Short', kinds: ['short', 'mix'], about: m => `Bands that run out before ${endOf(m)} at ${m.name}'s forecast pace, or where demand is moving to a band with thin stock. ₹ = the pieces you will be short × the band's selling price.` },
  { key: 'follow', label: "Stock Doesn't Follow Sales", kinds: ['follow'], about: () => `A band's share of the subcategory's stock is more than ${T.wellApartPoints} points away from its share of sales. Red: too little stock where it sells; purple: too much where it doesn't.` },
  { key: 'topout', label: 'Best Sellers Out', kinds: ['topout'], about: () => `Your subcategory's top ${T.topSellers} sellers that are out of stock, or about to be, in a band that otherwise has stock: usually a size or colour gap.` },
  { key: 'transfers', label: 'Transfers', kinds: ['xin', 'xout'], about: m => `Moving stock between stores in the region, using every store's stock today. Bring In: another store holds more than it needs to ${endOf(m)} of an item you will run short of. Send Out: you hold more than you need of an item another store will run out of.` },
  { key: 'hidden', label: 'Not Selling Here', kinds: ['hidden'], about: () => 'In stock here, none sold here in 14 days, yet the same items sold at two or more other stores: check they are on the shelf, in the right sizes and priced right.' },
  { key: 'dead', label: 'Dead Stock', kinds: ['dead', 'slow'], about: () => `Stock with no sale in ${T.deadDays} days, and separately stock that sold nothing in the last 28 days. ₹ at selling price.` },
  { key: 'over', label: 'Overstocked', kinds: ['over'], about: m => `Selling bands with more than ${T.overstockDays} days of stock at ${m.name}'s pace: money tied up beyond what ${m.name} needs.` },
  { key: 'data', label: 'Data to Fix', kinds: ['noband'], about: () => 'Items the band view leaves out because no price band is published for them.' },
]
const SHOWN = 10
const total = (fs: Finding[]) => fs.reduce((t, f) => t + f.rupees, 0)
export const tabFindings = (findings: Finding[], key: TabKey) => {
  const t = ATTENTION_TABS.find(x => x.key === key)!
  return findings.filter(f => t.kinds.includes(f.kind)).sort((a, b) => b.rupees - a.rupees)
}
/** The header answer: transfers act on the same rupees as the findings they come from, so they are not added again. */
export const atRisk = (findings: Finding[]) => total(findings.filter(f => f.colour === 'red' && f.kind !== 'xin'))
export const notEarning = (findings: Finding[]) => total(findings.filter(f => f.colour === 'purple' && f.kind !== 'xout'))

function Card({ f, href, onOpen }: { f: Finding; href: string; onOpen: (f: Finding) => void }) {
  return (
    <li className={cx('fr-att', `fr-att-${f.colour}`)} data-kind={f.kind}>
      <div className="fr-att-top">
        <a className="fr-link fr-att-title" href={href} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onOpen(f) }}>{f.title}</a>
        <span className="fr-att-amt">{inr(f.rupees)}</span>
      </div>
      <div className="fr-att-ev">{f.evidence}</div>
      <div className="fr-att-act"><b>Action</b> {f.action}</div>
    </li>
  )
}

function Cards({ findings, href, onOpen }: { findings: Finding[]; href: (f: Finding) => string; onOpen: (f: Finding) => void }) {
  const [all, setAll] = useState(false)
  if (!findings.length) return null
  return <>
    <ol className="fr-att-list">{(all ? findings : findings.slice(0, SHOWN)).map((f, i) => <Card key={i} f={f} href={href(f)} onOpen={onOpen} />)}</ol>
    {findings.length > SHOWN && <p className="mt-2"><button type="button" className="fr-link" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${findings.length}`}</button></p>}
  </>
}

/** The answer line, the tab row and the open tab. `tab` and `onTab` keep the open tab in the page's address. */
export function NeedsAttention({ findings, header, othersAsOf, tab: chosen, onTab, href, onOpen }: {
  findings: Finding[]; header: Header; othersAsOf: string | null
  tab: string | null; onTab: (tab: string) => void
  /** Where a finding opens on its own: the review with its subcategory and band open. */
  href: (f: Finding) => string
  onOpen: (f: Finding) => void
}) {
  const m = header.month, asOf = header.stockAsOf ? day(header.stockAsOf) : '—'
  // the first tab with findings opens first
  const tab = chosen === 'help' || ATTENTION_TABS.some(t => t.key === chosen) ? chosen! : (ATTENTION_TABS.find(t => tabFindings(findings, t.key).length) ?? ATTENTION_TABS[0]).key
  const open = ATTENTION_TABS.find(t => t.key === tab)
  const fs = open ? tabFindings(findings, open.key) : []
  const group = (title: string, note: string, kind: Finding['kind']) => {
    const g = fs.filter(f => f.kind === kind)
    return g.length ? <><h3 className="fr-att-group">{title} <span className="fr-dim">{g.length} · {inr(total(g))} {note}</span></h3><Cards findings={g} href={href} onOpen={onOpen} /></> : null
  }
  return (
    <div className="fr" data-testid="needs-attention">
      <p className="fr-att-answer"><b className="fr-short">{inr(atRisk(findings))}</b> of {m.name}'s sales at risk · <b className="fr-over">{inr(notEarning(findings))}</b> of stock not earning</p>
      <div className="fr-tabs fr-att-tabs" role="tablist" aria-label="Kinds of action">
        {ATTENTION_TABS.map(t => {
          const tf = tabFindings(findings, t.key)
          return (
            <button key={t.key} type="button" role="tab" id={`fr-att-tab-${t.key}`} aria-selected={tab === t.key} className={cx(!tf.length && 'fr-att-empty')} onClick={() => onTab(t.key)}>
              {t.label}<span className="fr-tcount">{tf.length}{tf.length && t.key !== 'data' ? ` · ${inr(total(tf))}` : ''}</span>
            </button>)
        })}
        <button type="button" role="tab" id="fr-att-tab-help" aria-selected={tab === 'help'} onClick={() => onTab('help')}>Help</button>
      </div>
      <div className="fr-tabpanel" role="tabpanel" aria-labelledby={`fr-att-tab-${tab}`}>
        {open ? <>
          <p className="fr-att-about">{open.about(m)}</p>
          {!fs.length ? <p className="fr-att-none">Nothing here for {header.section} today.</p>
            : open.key === 'transfers' ? <>
              {group('Bring In', 'of sales you would otherwise lose', 'xin')}
              {group('Send Out', 'of your stock another store will sell', 'xout')}
            </> : <Cards key={open.key} findings={fs} href={href} onOpen={onOpen} />}
          <p className="fr-dim fr-att-note">₹ at selling price (never cost), to {endOf(m)} from the stock on {asOf} at {m.name}'s forecast pace.
            {open.key === 'transfers' && ` Other stores' stock as of ${othersAsOf ? day(othersAsOf) : '—'}; same region only; at least ${T.minTransferPcs} pcs, and a store must have sold at least ${T.minSellingTherePcs} in 28 days to be offered stock.`}
            {' '}Click a finding to open its subcategory and price band in the Team Leader review.</p>
        </> : (
          <ul className="fr-att-help">
            {ATTENTION_TABS.map(t => <li key={t.key}><b>{t.label}</b>: {t.about(m)}</li>)}
            <li><b>Who to ask</b>: the buyer and category head named on each finding come from Featherbase's Merchandise Assignment for the subcategory.</li>
            <li><b>The two totals at the top</b>: sales you may lose (red tabs) and stock not earning (purple tabs). They are never added together, and transfers are not counted again: they are one way to act on the same rupees.</li>
          </ul>)}
      </div>
    </div>
  )
}
