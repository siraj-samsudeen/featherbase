// By Price Band (#1419, approved 28-Nov-2026): a subcategory's month forecast split the way its last 28 days' sales
// split by the warehouse's own price bands (value by value share, pieces by piece share), with today's stock in each
// band, how long it lasts at the month's forecast pace, and the band's best-selling items. Read from three copies of
// the warehouse's feeds: price_band_mix, stock_band and price_band_top_item.

type Num = number | string | null | undefined
const n = (v: Num) => (v == null || v === '' ? 0 : Number(v))

interface BandKey { store_code: string; subcategory_name: string; price_band: string; price_band_order: Num }
export interface BandMixRow extends BandKey {
  sales_value_before_tax: Num; sales_qty: Num; items_sold: Num; value_share: Num; qty_share: Num; items_to_50_pct: Num; items_to_70_pct: Num
}
export interface StockBandRow extends BandKey { stock_qty: Num; items_in_stock: Num; stock_as_of: string | null }
export interface TopItemRow extends BandKey { item_rank: Num; item_code: string; item_name: string | null; sales_qty: Num; sales_value_before_tax: Num; stock_qty: Num }
export interface BandRows { mix: BandMixRow[]; stock: StockBandRow[]; items: TopItemRow[] }

export const MIX_FIELDS = ['store_code', 'subcategory_name', 'price_band', 'price_band_order', 'sales_value_before_tax', 'sales_qty', 'items_sold', 'value_share', 'qty_share', 'items_to_50_pct', 'items_to_70_pct']
export const STOCK_FIELDS = ['store_code', 'subcategory_name', 'price_band', 'price_band_order', 'stock_qty', 'items_in_stock', 'stock_as_of']
export const ITEM_FIELDS = ['store_code', 'subcategory_name', 'price_band', 'price_band_order', 'item_rank', 'item_code', 'item_name', 'sales_qty', 'sales_value_before_tax', 'stock_qty']

export interface TopItem { code: string; name: string; qty: number; value: number; stock: number }
export interface Band {
  name: string; order: number
  /** The band's part of the month's forecast: value and pieces. */
  fc: number; fq: number
  /** Its share of the last 28 days' sales value, 0 to 1. */
  share: number
  stock: number; sold: number
  /** Pieces it sold in the 28 days. */
  q28: number
  /** Its share, in %, of the selling bands' pieces sold and of their stock; null for a band that does not sell. */
  shareSales: number | null; shareStock: number | null
  /** How many of its best sellers make 50% and 70% of its sales; null when it sold nothing. */
  n50: number | null; n70: number | null
  items: TopItem[]
}

/** The band the warehouse gives an item sold but not on its board: never counted as short. */
export const NO_BAND = 'No band'

/** A subcategory's bands at a store, cheapest first: the forecast (fc, fq) split by each band's share of the 28 days.
 *  A band with stock but no sales is still listed, with no forecast; a band in neither is not. */
export function bandsOf(rows: BandRows, store: string, sub: string, fc: number, fq: number): Band[] {
  const mine = <T extends BandKey>(r: T[]) => r.filter(x => x.store_code === store && x.subcategory_name === sub)
  const mix = mine(rows.mix), stock = mine(rows.stock), items = mine(rows.items)
  const names = [...new Set([...mix, ...stock].map(r => r.price_band))]
  const bands = names.map((name): Band => {
    const m = mix.find(r => r.price_band === name), s = stock.find(r => r.price_band === name)
    const share = n(m?.value_share), shareQ = n(m?.qty_share)
    return {
      name, order: n((m ?? s)!.price_band_order), fc: Math.round(fc * share), fq: Math.round(fq * shareQ * 10) / 10, share,
      stock: Math.round(n(s?.stock_qty)), q28: n(m?.sales_qty), shareSales: null, shareStock: null, sold: n(m?.items_sold),
      n50: m?.items_to_50_pct == null || m.items_to_50_pct === '' ? null : n(m.items_to_50_pct),
      n70: m?.items_to_70_pct == null || m.items_to_70_pct === '' ? null : n(m.items_to_70_pct),
      items: items.filter(i => i.price_band === name).sort((a, b) => n(a.item_rank) - n(b.item_rank))
        .map(i => ({ code: i.item_code, name: i.item_name || i.item_code, qty: n(i.sales_qty), value: n(i.sales_value_before_tax), stock: n(i.stock_qty) })),
    }
  }).sort((a, b) => a.order - b.order)
  return withShares(bands)
}

/** Bands that are not price bands: an item sold but not on the board, or with no band published. */
const NOT_A_BAND = [NO_BAND, 'No price band published']

/** A band that sells: it sold pieces in the 28 days and is a real price band (not Never sold, not a data gap).
 *  Only these get a share, so dead stock and unpriced items don't distort the shares. */
export const sells = (b: Band) => b.q28 > 0 && !NOT_A_BAND.includes(b.name) && !b.name.startsWith('Never sold')

/** Each selling band's share of the selling bands' pieces sold and of their stock, in %, to one decimal. */
function withShares(bands: Band[]): Band[] {
  const selling = bands.filter(sells)
  const sold = selling.reduce((t, b) => t + b.q28, 0), held = selling.reduce((t, b) => t + b.stock, 0)
  const one = (x: number) => Math.round(x * 10) / 10
  return bands.map(b => (sells(b) ? { ...b, shareSales: one(sold ? b.q28 / sold * 100 : 0), shareStock: one(held ? b.stock / held * 100 : 0) } : b))
}

/** Stock should follow sales: more than this many points apart is marked. */
export const GAP_POINTS = 5

/** Share of stock − share of sales, in points; null for a band that does not sell. */
export const gapOf = (b: Band) => (b.shareSales == null || b.shareStock == null ? null : b.shareStock - b.shareSales)

/** 'short' when stock is well below its sales share, 'over' when well above, else null. */
export const gapTone = (gap: number | null) => (gap == null ? null : gap < -GAP_POINTS ? 'short' : gap > GAP_POINTS ? 'over' : null)

/** The day the stock was counted, the newest across the rows (YYYY-MM-DD); null with no stock rows. */
export const stockAsOf = (rows: StockBandRow[]) => rows.reduce<string | null>((at, r) => (r.stock_as_of && (!at || r.stock_as_of > at) ? r.stock_as_of.slice(0, 10) : at), null)

/** Days from the stock count to the month's last day, inclusive of neither: 27-Nov to 31-Dec is 34. */
export function daysLeft(asOf: string, month: { year: number; name: string; days: number }) {
  const monthIndex = new Date(`1 ${month.name} ${month.year}`).getMonth()
  return Math.round((Date.UTC(month.year, monthIndex, month.days) - Date.parse(`${asOf}T00:00:00Z`)) / 864e5)
}

/** How many days the band's stock lasts at the month's forecast pace; null when it has no forecast pieces. */
export const coverOf = (b: Band, monthDays: number) => (b.fq > 0 ? b.stock / (b.fq / monthDays) : null)

/** It runs out before the month ends. */
export const isShort = (b: Band, monthDays: number, left: number) => { const c = coverOf(b, monthDays); return c != null && c < left }

/** It holds stock but sold nothing in the 28 days, so it has no forecast to last for. */
export const notSelling = (b: Band) => b.fq === 0 && b.stock > 0

/** The section's bands that run out before the month ends, the biggest shortfall (forecast pieces − stock) first. */
export function shortBands<L extends { name: string; bands?: Band[] }>(lines: L[], monthDays: number, left: number) {
  return lines.flatMap(l => (l.bands ?? []).filter(b => b.name !== NO_BAND && isShort(b, monthDays, left)).map(b => ({ line: l, band: b, gap: b.fq - b.stock })))
    .sort((a, b) => b.gap - a.gap)
}
