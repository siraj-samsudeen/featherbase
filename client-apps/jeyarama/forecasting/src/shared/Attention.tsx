// Needs Your Attention (#1419; Siraj 28-Nov-2026, prototype data-warehouse 8dcaa8da3): its own page, one tab per kind
// of action, each a sortable table (₹ first, falling); a row opens the drill pane on the right with everything about
// it: its numbers, what we see, what to do, who to ask, its items and the stores a transfer could go to or come from.
// With the pane open, the table keeps only its key columns. The header answer is the two totals, never added together,
// and transfers are not counted again: they are one way to act on the same rupees. Colour carries meaning only:
// red = sales you may lose, purple = stock not earning, grey = data to fix. Shared, so other review pages can show
// their own findings the same way: a store's page groups them by floor › section, a region's by store (`grouping`),
// or lists them as one with the section or store as a column.
import { Fragment, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, DrillPane, PaneSection, RecordLink, Segmented, SplitWithPane, TABLE_CLASSES, cellClasses, cx, headCellClasses, resolvePanePlace } from '@featherbase/shop-floor'
import { PersonLink, StoreLink } from './records'
import { count, day, inr } from './model'
import { ATTENTION_SETTINGS as T, type Finding } from './findings'
import type { Header } from './review'

type TabKey = 'short' | 'follow' | 'topout' | 'transfers' | 'hidden' | 'dead' | 'over' | 'data'
interface Tab { key: TabKey; label: string; kinds: Finding['kind'][]; about: (m: Header['month']) => string }

const endOf = (m: Header['month']) => `${m.days}-${m.name.slice(0, 3)}`
/** A column's heading, the month's last day filled in ("Needed to 31-Dec"). */
const headOf = (c: string, m: Header['month']) => COL[c].head.replace('{end}', endOf(m))
export const ATTENTION_TABS: Tab[] = [
  { key: 'short', label: 'Will Run Short', kinds: ['short', 'mix'], about: m => `Bands that run out before ${endOf(m)} at ${m.name}'s forecast pace, or where demand is moving to a band with thin stock. ₹ = the pieces you will be short × the band's selling price.` },
  { key: 'follow', label: "Stock Doesn't Follow Sales", kinds: ['follow'], about: () => `A band's share of the subcategory's stock is more than ${T.wellApartPoints} points away from its share of sales. Red: too little stock where it sells; purple: too much where it doesn't.` },
  { key: 'topout', label: 'Best Sellers Out', kinds: ['topout'], about: () => `Your subcategory's top ${T.topSellers} sellers that are out of stock, or about to be, in a band that otherwise has stock: usually a size or colour gap.` },
  { key: 'transfers', label: 'Transfers', kinds: ['xin', 'xout'], about: m => `Moving stock between stores in the region, using every store's stock today. Bring In: another store holds more than it needs to ${endOf(m)} of an item you will run short of (only what the warehouse can't cover). Send Out: you hold more than you need of an item another store will run out of.` },
  { key: 'hidden', label: 'Not Selling Here', kinds: ['hidden'], about: () => 'In stock here, none sold here in 14 days, yet the same items sold at two or more other stores: check they are on the shelf, in the right sizes and priced right.' },
  { key: 'dead', label: 'Dead Stock', kinds: ['dead', 'slow'], about: () => `Stock with no sale in ${T.deadDays} days, and separately stock that sold nothing in the last 28 days. ₹ at selling price.` },
  { key: 'over', label: 'Overstocked', kinds: ['over'], about: m => `Selling bands with more than ${T.overstockDays} days of stock at ${m.name}'s pace: money tied up beyond what ${m.name} needs.` },
  { key: 'data', label: 'Data to Fix', kinds: ['noband'], about: () => 'Items the band view leaves out because no price band is published for them.' },
]
const total = (fs: Finding[]) => fs.reduce((t, f) => t + f.rupees, 0)
export const tabFindings = (findings: Finding[], key: TabKey) => {
  const t = ATTENTION_TABS.find(x => x.key === key)!
  return findings.filter(f => t.kinds.includes(f.kind)).sort((a, b) => b.rupees - a.rupees)
}
/** The header answer: transfers act on the same rupees as the findings they come from, so they are not added again. */
export const atRisk = (findings: Finding[]) => total(findings.filter(f => f.colour === 'red' && f.kind !== 'xin'))
export const notEarning = (findings: Finding[]) => total(findings.filter(f => f.colour === 'purple' && f.kind !== 'xout'))

// ---- the columns: heading, value, how it reads (t text, n pieces, d days, p %, g points, r ₹ as a summary, x ₹ exact)
type Fmt = 't' | 'n' | 'd' | 'p' | 'g' | 'r' | 'x'
interface Col { head: string; value: (f: Finding) => number | string | null; fmt: Fmt }
const nv = (k: string) => (f: Finding) => f.n[k] ?? null
const COL: Record<string, Col> = {
  sub: { head: 'Subcategory', value: f => f.line, fmt: 't' }, band: { head: 'Price band', value: f => f.band ?? '—', fmt: 't' }, amt: { head: '₹', value: f => f.rupees, fmt: 'r' },
  need: { head: 'Needed to {end}', value: nv('need'), fmt: 'n' }, stock: { head: 'Stock', value: nv('stock'), fmt: 'n' }, lasts: { head: 'Lasts', value: nv('lasts'), fmt: 'd' },
  short: { head: 'Short by', value: nv('short'), fmt: 'n' }, wh: { head: 'Warehouse', value: nv('wh'), fmt: 'n' }, ss: { head: 'Share of sales', value: nv('shareSales'), fmt: 'p' },
  st: { head: 'Share of stock', value: nv('shareStock'), fmt: 'p' }, gap: { head: 'Gap', value: nv('gap'), fmt: 'g' }, sold: { head: 'Sold 28 days', value: nv('sold'), fmt: 'n' },
  pcsOff: { head: 'Pieces off', value: nv('pcsOff'), fmt: 'n' }, extra: { head: 'Extra pieces', value: nv('extra'), fmt: 'n' }, item: { head: 'Item', value: nv('item'), fmt: 't' },
  store: { head: 'Store', value: nv('store'), fmt: 't' }, theirStock: { head: 'Their stock', value: nv('theirStock'), fmt: 'n' }, theirSold: { head: 'Sold there, 28 d', value: nv('theirSold'), fmt: 'n' },
  hereStock: { head: 'Stock here', value: nv('hereStock'), fmt: 'n' }, hereSold: { head: 'Sold here, 28 d', value: nv('hereSold'), fmt: 'n' }, move: { head: 'Pieces to move', value: nv('move'), fmt: 'n' },
  items: { head: 'Items', value: nv('items'), fmt: 'n' }, elsewhere14: { head: 'Sold at other stores, 14 days', value: nv('elsewhere14'), fmt: 'n' }, stores: { head: 'Stores', value: nv('stores'), fmt: 'n' },
  section: { head: 'Section', value: f => f.place?.section ?? null, fmt: 't' }, atStore: { head: 'Store', value: f => (f.place ? `${f.place.store} ${f.place.storeName}` : null), fmt: 't' },
  noSale: { head: 'No sale in', value: nv('noSale'), fmt: 't' }, shareHere: { head: 'Share of stock here', value: nv('shareStock'), fmt: 'p' }, soldValue: { head: 'Sold 28 days ₹', value: nv('soldValue'), fmt: 'x' },
}
const COLS: Record<TabKey, string[]> = {
  short: ['sub', 'band', 'need', 'stock', 'lasts', 'short', 'wh', 'ss', 'st', 'amt'], follow: ['sub', 'band', 'ss', 'st', 'gap', 'stock', 'sold', 'pcsOff', 'amt'],
  topout: ['item', 'sub', 'band', 'sold', 'stock', 'short', 'wh', 'amt'], transfers: ['item', 'sub', 'band', 'store', 'theirStock', 'theirSold', 'hereStock', 'hereSold', 'move', 'amt'],
  hidden: ['sub', 'items', 'stock', 'elsewhere14', 'stores', 'amt'], dead: ['sub', 'noSale', 'items', 'stock', 'shareHere', 'amt'],
  over: ['sub', 'band', 'stock', 'need', 'lasts', 'extra', 'ss', 'st', 'amt'], data: ['sub', 'items', 'sold', 'soldValue', 'stock'],
}
/** With the pane open (it shows every number) the table keeps only its key columns, so nothing scrolls sideways. */
const KEY_COLS: Record<TabKey, string[]> = {
  short: ['sub', 'band', 'lasts', 'short', 'amt'], follow: ['sub', 'band', 'gap', 'amt'], topout: ['item', 'short', 'amt'], transfers: ['item', 'store', 'move', 'amt'],
  hidden: ['sub', 'items', 'amt'], dead: ['sub', 'noSale', 'stock', 'amt'], over: ['sub', 'band', 'lasts', 'extra', 'amt'], data: ['sub', 'items', 'soldValue'],
}
const numeric = (c: string) => COL[c].fmt !== 't'

/** How a page over many sections or stores shows its findings: grouped (floor › section, or store), or one list. */
export type Grouping = 'none' | 'section' | 'store'
interface TableGroup { key: string; head: ReactNode; fs: Finding[]; note: string }
const placeOf = (f: Finding, g: Grouping) => (g === 'section' ? `${f.place?.floorOrder ?? 99}|${f.place?.floor ?? ''}|${f.place?.section ?? ''}` : g === 'store' ? f.place?.store ?? '' : '')
/** A tab's rows in groups, as the table shows them and ↑ ↓ follow them: by place (floors in building order, then the
 *  bigger ₹ first; stores by ₹), and in Transfers, Bring In before Send Out in each. */
function groupsOf(tab: Tab, findings: Finding[], g: Grouping): TableGroup[] {
  const kinds: [string | null, (f: Finding) => boolean, string][] = tab.key === 'transfers'
    ? [['Bring In', f => f.kind === 'xin', 'of sales you would otherwise lose'], ['Send Out', f => f.kind === 'xout', 'of your stock another store will sell']]
    : [[null, () => true, '']]
  const places = g === 'none' ? [''] : [...new Set(findings.map(f => placeOf(f, g)))].sort((a, b) => {
    const fa = findings.find(f => placeOf(f, g) === a)!, fb = findings.find(f => placeOf(f, g) === b)!
    const byRupees = total(findings.filter(f => placeOf(f, g) === b)) - total(findings.filter(f => placeOf(f, g) === a))
    return g === 'section' ? (fa.place?.floorOrder ?? 99) - (fb.place?.floorOrder ?? 99) || byRupees : byRupees
  })
  return places.flatMap(pl => {
    const here = g === 'none' ? findings : findings.filter(f => placeOf(f, g) === pl), f0 = here[0]
    const where: ReactNode = g === 'section' && f0?.place ? <>{f0.place.floor && <span className="fr-dim">{f0.place.floor} › </span>}<RecordLink table="Section" rowId={`${f0.place.store}-${f0.place.section}`} name={f0.place.section}
      href={`?${new URLSearchParams({ view: 'section', store: f0.place.store, section: f0.place.section })}`} /></>
      : g === 'store' && f0?.place ? <StoreLink code={f0.place.store} name={`${f0.place.store} ${f0.place.storeName}`} /> : null
    return kinds.flatMap(([k, test, note]) => {
      const fs = here.filter(test).sort((a, b) => b.rupees - a.rupees)
      return fs.length ? [{ key: `${pl}|${k ?? ''}`, head: where && k ? <>{where} · {k}</> : where ?? k, fs, note }] : []
    })
  })
}
function show(c: string, f: Finding): string {
  const v = COL[c].value(f)
  if (v == null || v === '') return '—'
  if (typeof v === 'string') return v
  switch (COL[c].fmt) {
    case 'r': return inr(v)
    case 'x': return `₹${count(Math.round(v))}`
    case 'd': return `${count(Math.round(v))} days`
    case 'p': return `${Math.round(v)}%`
    case 'g': { const r = Math.round(v); return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} pts` }
    default: return count(Math.round(v))
  }
}
/** Colour carries meaning only: the ₹ in its finding's colour, and a gap's side. */
function tone(c: string, f: Finding) {
  const v = COL[c].value(f)
  if (typeof v !== 'number') return undefined
  if (c === 'gap') return v < 0 ? 'fr-short' : 'fr-over'
  if (c === 'amt') return f.colour === 'red' ? 'fr-short' : f.colour === 'purple' ? 'fr-over' : undefined
  return undefined
}

interface Sort { col: string; dir: 1 | -1 }
const sortBy = (fs: Finding[], s: Sort) => [...fs].sort((a, b) => {
  const x = COL[s.col].value(a), y = COL[s.col].value(b)
  if (typeof x === 'string' || typeof y === 'string') return s.dir * String(x ?? '').localeCompare(String(y ?? ''))
  return s.dir * ((x ?? -Infinity) - (y ?? -Infinity))
})

function Pane({ f, header, place, index, of, onClose, onMove, href, onOpen, openLabel }: {
  f: Finding; header: Header; place: ReturnType<typeof resolvePanePlace>; index: number; of: number
  onClose: () => void; onMove: (step: 1 | -1) => void; href: string; onOpen: () => void; openLabel: string
}) {
  const tab = ATTENTION_TABS.find(t => t.kinds.includes(f.kind))!
  const nums = COLS[tab.key].filter(c => !['sub', 'band', 'item', 'amt'].includes(c))
  const keys = (e: KeyboardEvent) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); onMove(e.key === 'ArrowDown' ? 1 : -1) } }
  const what = f.colour === 'red' ? `of ${header.month.name}'s sales at risk` : f.colour === 'purple' ? 'of stock not earning, at selling price' : 'of sales left out of the band view'
  return (
    <div className="fr fr-att-pane" onKeyDown={keys} data-testid="attention-pane">
      <DrillPane kind={`${index + 1} of ${of} · ↑ ↓ to move, Esc to close`} title={f.title} onClose={onClose} place={place}>
        <div><p className={cx('fr-att-pane-amt', f.colour === 'red' ? 'fr-short' : f.colour === 'purple' ? 'fr-over' : 'fr-dim')}>{inr(f.rupees)}</p><p className="fr-dim fr-att-small">{what}</p></div>
        {f.place && <p className="fr-att-small" data-testid="pane-place"><StoreLink code={f.place.store} name={`${f.place.store} ${f.place.storeName}`} />
          {f.place.floor && <span className="fr-dim"> · {f.place.floor}</span>} · <RecordLink table="Section" rowId={`${f.place.store}-${f.place.section}`} name={f.place.section}
            href={`?${new URLSearchParams({ view: 'section', store: f.place.store, section: f.place.section })}`} /></p>}
        <PaneSection title="Numbers"><dl className="fr-att-kv">{nums.map(c => <Fragment key={c}><dt>{headOf(c, header.month)}</dt><dd>{c === 'store' && f.n.storeCode ? <StoreLink code={String(f.n.storeCode)} name={show(c, f)} /> : show(c, f)}</dd></Fragment>)}</dl></PaneSection>
        <PaneSection title="What we see"><p className="fr-att-p">{f.evidence}</p></PaneSection>
        <PaneSection title="What to do"><p className="fr-att-p">{f.action}</p></PaneSection>
        <PaneSection title="Who to ask"><p className="fr-att-p">{f.who.map(w => <span key={w.role}><b><PersonLink id={w.id} name={w.name} /></b> <span className="fr-dim">· {w.role}</span></span>)}</p></PaneSection>
        {f.items.length > 0 && (
          <PaneSection title={f.itemsShow === 'stock' ? 'Biggest items by stock' : f.itemsShow === 'elsewhere' ? 'Items not selling here' : 'Top items, last 28 days'}>
            <table className="fr-mini fr-att-mini">
              <thead><tr><th>Item</th>{f.itemsShow === 'elsewhere' ? <><th>Sold elsewhere, 14 d</th><th>Stores</th></> : f.itemsShow === 'stock' ? <th>At selling price</th> : <><th>Pieces</th><th>Value</th></>}<th>Stock now</th></tr></thead>
              <tbody>{f.items.map(i => (
                <tr key={i.code}><td>{i.item}</td>
                  {f.itemsShow === 'elsewhere' ? <><td>{count(i.qty ?? 0)}</td><td>{i.stores ?? '—'}</td></> : f.itemsShow === 'stock' ? <td>₹{count(i.value ?? 0)}</td> : <><td>{count(i.qty ?? 0)}</td><td>₹{count(i.value ?? 0)}</td></>}
                  <td>{count(i.stock)}</td></tr>))}</tbody>
            </table>
          </PaneSection>)}
        {f.options.length > 0 && (
          <PaneSection title={f.colour === 'red' ? 'Stores that can spare these items' : 'Stores that will run out of these items'}>
            <table className="fr-mini fr-att-mini">
              <thead><tr><th>Item</th><th>Store</th><th>Their stock</th><th>Their sold 28 d</th><th>{f.colour === 'red' ? 'Can spare' : 'Will be short'}</th></tr></thead>
              <tbody>{f.options.map((o, k) => <tr key={k}><td>{o.item}</td><td><StoreLink code={o.storeCode} name={o.store} /></td><td>{count(o.theirStock)}</td><td>{count(o.theirSold)}</td><td>{count(o.pcs)}</td></tr>)}</tbody>
            </table>
          </PaneSection>)}
        <div><Button variant="primary" onClick={onOpen} data-href={href}>{openLabel}</Button></div>
      </DrillPane>
    </div>
  )
}

function TabTable({ tab, findings, open, onOpen, month, lineHref, onLine, grouping, placed }: { tab: Tab; findings: Finding[]; open: Finding | null; onOpen: (f: Finding) => void; month: Header['month']
  /** A subcategory is a record: its link opens the review with it (and its band) open. */
  lineHref: (f: Finding) => string; onLine: (f: Finding) => void
  /** How rows are grouped; and which place a one-list table names in a column ('section' or 'atStore'), if any. */
  grouping: Grouping; placed: 'section' | 'atStore' | null }) {
  const [sort, setSort] = useState<Sort>({ col: COLS[tab.key].includes('amt') ? 'amt' : 'soldValue', dir: -1 })
  const base = open ? KEY_COLS[tab.key] : COLS[tab.key]
  const cols = grouping === 'none' && placed ? [base[0], placed, ...base.slice(1)] : base
  const groups: [ReactNode, Finding[], string, string][] = groupsOf(tab, findings, grouping).map(g => [g.head, g.fs, g.note, g.key])
  const pick = (c: string) => setSort(s => ({ col: c, dir: s.col === c ? (-s.dir as 1 | -1) : numeric(c) ? -1 : 1 }))
  return (
    <div className="fr-att-wrap">
      <table className={cx(TABLE_CLASSES, 'fr-att-table')} data-testid="attention-table">
        <thead><tr>{cols.map((c, k) => (
          <th key={c} className={headCellClasses({ first: k === 0, last: k === cols.length - 1, className: cx('fr-att-th', numeric(c) && 'text-right') })}
            aria-sort={sort.col === c ? (sort.dir < 0 ? 'descending' : 'ascending') : undefined}>
            <button type="button" className="fr-att-sort" onClick={() => pick(c)}>{headOf(c, month)}{sort.col === c && <span aria-hidden> {sort.dir < 0 ? '↓' : '↑'}</span>}</button>
          </th>))}</tr></thead>
        <tbody>{groups.filter(([, fs]) => fs.length).map(([g, fs, note, gk]) => (
          <Fragment key={gk}>
            {g && <tr><td colSpan={cols.length} className="fr-att-grp">{g} <span className="fr-dim">{fs.length} · {inr(total(fs))} {note}</span></td></tr>}
            {sortBy(fs, sort).map((f, k) => (
              <tr key={`${f.kind}:${f.title}:${k}`} className={cx('group fr-att-row', `fr-att-${f.colour}`)} aria-selected={open === f} tabIndex={0}
                onClick={() => onOpen(f)} onKeyDown={e => { if (e.key === 'Enter') onOpen(f) }}>
                {cols.map((c, j) => <td key={c} className={cellClasses({ first: j === 0, last: j === cols.length - 1,
                  className: cx(numeric(c) && 'text-right tabular-nums', j === 0 && 'fr-att-name', tone(c, f)) })}>{c === 'sub'
                  ? <span onClick={e => e.stopPropagation()}><RecordLink table="forecasting.forecast_line_month" rowId={f.place?.rowId ?? f.line} name={f.line} href={lineHref(f)} onNavigate={() => onLine(f)} /></span>
                  : c === 'atStore' && f.place ? <span onClick={e => e.stopPropagation()}><StoreLink code={f.place.store} name={show(c, f)} /></span>
                  : c === 'section' && f.place ? <span onClick={e => e.stopPropagation()}><RecordLink table="Section" rowId={`${f.place.store}-${f.place.section}`} name={f.place.section}
                    href={`?${new URLSearchParams({ view: 'section', store: f.place.store, section: f.place.section })}`} /></span>
                  : c === 'store' && f.n.storeCode ? <span onClick={e => e.stopPropagation()}><StoreLink code={String(f.n.storeCode)} name={show(c, f)} /></span>
                  : show(c, f)}</td>)}
              </tr>))}
          </Fragment>))}</tbody>
      </table>
    </div>
  )
}

/** The answer line, the tab row and the open tab. `tab` and `onTab` keep the open tab in the page's address. */
export function NeedsAttention({ findings, header, othersAsOf, tab: chosen, onTab, href, onOpen, openLabel = 'Open in Team Leader Review', over, scopeName, progress }: {
  findings: Finding[]; header: Header; othersAsOf: string | null
  tab: string | null; onTab: (tab: string) => void
  /** Where a finding opens on its own: the review with its subcategory and band open. */
  href: (f: Finding) => string
  onOpen: (f: Finding) => void
  /** The pane's button, after the review it opens. */
  openLabel?: string
  /** A page over many sections ('section': a store's) or stores ('store': a region's) groups its rows by them. */
  over?: 'section' | 'store'
  /** What the page covers, in words ("ATK", "Kerala"); the section by default. */
  scopeName?: string
  /** After the answer line: how much of a region has arrived. */
  progress?: ReactNode
}) {
  const [grouping, setGrouping] = useState<Grouping>(over ?? 'none')
  const m = header.month, asOf = header.stockAsOf ? day(header.stockAsOf) : '—'
  // the first tab with findings opens first
  const tab = chosen === 'help' || ATTENTION_TABS.some(t => t.key === chosen) ? chosen! : (ATTENTION_TABS.find(t => tabFindings(findings, t.key).length) ?? ATTENTION_TABS[0]).key
  const openTab = ATTENTION_TABS.find(t => t.key === tab)
  const fs = openTab ? tabFindings(findings, openTab.key) : []
  const [open, setOpen] = useState<Finding | null>(null)
  useEffect(() => setOpen(null), [tab])
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  useEffect(() => { const on = () => setWidth(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  const place = resolvePanePlace('auto', width)
  // ↑ ↓ follow the table's own order: by place, and Bring In before Send Out, each by ₹
  const order = openTab ? groupsOf(openTab, fs, grouping).flatMap(g => g.fs) : fs
  const at = open ? order.indexOf(open) : -1
  const move = (step: 1 | -1) => { const next = order[at + step]; if (next) setOpen(next) }
  return (
    <div className="fr" data-testid="needs-attention">
      <div className="fr-att-answerbar">
        <p className="fr-att-answer"><b className="fr-short">{inr(atRisk(findings))}</b> of {m.name}'s sales at risk · <b className="fr-over">{inr(notEarning(findings))}</b> of stock not earning{progress && <span className="fr-dim fr-att-progress"> · {progress}</span>}</p>
        {over && <Segmented label="Rows" value={grouping} onChange={v => setGrouping(v)}
          options={[{ value: over, label: over === 'section' ? 'By section' : 'By store' }, { value: 'none', label: 'One list' }]} />}
      </div>
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
        {openTab ? (
          <SplitWithPane place={place} pane={open && at >= 0 ? <Pane key={at} f={open} header={header} place={place} index={at} of={order.length}
            onClose={() => setOpen(null)} onMove={move} href={href(open)} onOpen={() => onOpen(open)} openLabel={openLabel} /> : null}>
            <p className="fr-att-about">{openTab.about(m)}</p>
            {!fs.length ? <p className="fr-att-none">Nothing here for {scopeName ?? header.section} today.</p>
              : <TabTable key={openTab.key} tab={openTab} findings={fs} open={open} onOpen={setOpen} month={m} lineHref={href} onLine={onOpen}
                grouping={grouping} placed={over === 'section' ? 'section' : over === 'store' ? 'atStore' : null} />}
            <p className="fr-dim fr-att-note">₹ at selling price (never cost), to {endOf(m)} from the stock on {asOf} at {m.name}'s forecast pace.
              {openTab.key === 'transfers' && ` Other stores' stock as of ${othersAsOf ? day(othersAsOf) : '—'}; same region only; at least ${T.minTransferPcs} pcs, and a store must have sold at least ${T.minSellingTherePcs} in 28 days to be offered stock.`}
              {' '}Click a row for its details; sort by any heading.</p>
          </SplitWithPane>
        ) : (
          <ul className="fr-att-help">
            {ATTENTION_TABS.map(t => <li key={t.key}><b>{t.label}</b>: {t.about(m)}</li>)}
            <li><b>Who to ask</b>: the buyer and category head on each finding come from Featherbase's Merchandise Assignment for the subcategory.</li>
            <li><b>The warehouse and transfers</b>: Featherbase suggests pulling from the warehouse first, never more than you are short; a transfer is suggested only for what the warehouse can't cover, and never more than the other store can spare.</li>
            <li><b>The two totals at the top</b>: sales you may lose (red) and stock not earning (purple). They are never added together, and transfers are not counted again: they are one way to act on the same rupees.</li>
          </ul>)}
      </div>
    </div>
  )
}
