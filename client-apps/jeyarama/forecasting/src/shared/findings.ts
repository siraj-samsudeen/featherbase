// Needs Your Attention (#1419, approved 28-Nov-2026; prototype data-warehouse d15e1fd07, needs_attention()): the
// section's short list of what to act on before the month runs out. Siraj: "what is my risk area… likely to run
// short… dead stock taking up space". Two lists, never mixed: sales you may lose (red) and stock not earning (purple),
// each ranked by its own ₹; master-data gaps (grey) last. Every ₹ is at selling price (never cost), measured to the
// month's last day from the stock date. Pure: the screen, the story and the tests all go through it.
import { count, inr, type Line } from './model'
import { NO_BAND, sells } from './bands'

/** The thresholds, named so they can be argued with (the prototype's constants). */
export const ATTENTION_SETTINGS = {
  /** A band's stock share this many points from its sales share does not follow sales. */
  wellApartPoints: 5,
  /** A selling band whose stock lasts longer than this, at the month's pace, has too much stock. */
  overstockDays: 60,
  /** No sale for this long is dead stock. */
  deadDays: 90,
  /** A subcategory's top sellers: its best this-many items by the last 28 days' sales. */
  topSellers: 5,
  /** The last 7 days' share this many points above the 28-day share: demand moving to the band. */
  mixShiftPoints: 5,
  /** Pieces: a smaller transfer is not worth a trip. */
  minTransferPcs: 3,
  /** Pieces in 28 days: another store must sell at least this many to be offered stock. */
  minSellingTherePcs: 5,
  /** The best few transfers per band or stock group, so the list stays readable. */
  transfersPerGroup: 3,
} as const

type Num = number | string | boolean | null | undefined
const n = (v: Num) => (v == null || v === '' || typeof v === 'boolean' ? Number(v ?? 0) : Number(v))
const yes = (v: Num) => v === true || v === 'true' || v === 1 || v === '1'

/** One item at one store: the copy of the warehouse's fb_item_health (data-warehouse #4980). Its 7, 14 and 28 days
 *  end on the store's last complete day. The region's other stores hold their own rows of the same items. */
export interface ItemHealthRow {
  store_code: string; store_short_code: string; subcategory_code: string; price_band: string; item_code: string; item_name: string | null
  stock_qty: Num; warehouse_stock_qty: Num; days_since_stock_movement: Num; is_dead_stock: Num
  sales_qty_7d: Num; sales_qty_14d: Num; sales_qty_28d: Num; sales_value_before_tax_28d: Num; selling_price_90d_incl_tax: Num
  other_stores_selling: Num; other_stores_sales_qty_14d: Num
}
export const ITEM_HEALTH_FIELDS = ['store_code', 'store_short_code', 'subcategory_code', 'price_band', 'item_code', 'item_name', 'stock_qty', 'warehouse_stock_qty',
  'days_since_stock_movement', 'is_dead_stock', 'sales_qty_7d', 'sales_qty_14d', 'sales_qty_28d', 'sales_value_before_tax_28d', 'selling_price_90d_incl_tax',
  'other_stores_selling', 'other_stores_sales_qty_14d']
/** What the live org chart says about who to ask, and the region's store names (orgChart.ts). */
export interface People { subcategories: Record<string, { buyer: string | null; categoryHead: string | null }>; stores: Record<string, string>
  /** A named person's Employee row, for their link. */
  people?: Record<string, string> }

/** The same item at another store of the region, from that store's own item health row. */
interface OtherStoreRow { item_code: string; short: string; name: string; stock: number; sold: number }
export type Colour = 'red' | 'purple' | 'grey'
export interface Finding {
  kind: 'short' | 'over' | 'follow' | 'mix' | 'topout' | 'xin' | 'xout' | 'hidden' | 'dead' | 'slow' | 'noband'
  colour: Colour
  /** ₹ at selling price: sales that may be lost, or stock that is not earning. */
  rupees: number
  /** The subcategory, and the band it opens on (none for a finding about the whole subcategory). */
  line: string; band: string | null
  title: string; evidence: string; action: string
  /** The side pane's numbers (the table's columns too), by name: need, stock, lasts, short, wh, shareSales… */
  n: Record<string, number | string | null>
  /** The pane's items: the best sellers (sales), the biggest by stock at selling price (stock), or the items selling
   *  only elsewhere (elsewhere); and, for a group, the stores that can spare or will run short of its items. */
  items: PaneItem[]; itemsShow: 'sales' | 'stock' | 'elsewhere'; options: PaneOption[]
  /** Who to ask: the buyer, or the category head for dead and slow stock. */
  who: { name: string; role: string; id?: string }[]
}
export interface PaneItem { item: string; code: string; qty: number | null; value: number | null; stock: number; stores?: number }
export interface PaneOption { item: string; store: string; storeCode?: string; theirStock: number; theirSold: number; pcs: number }

/** Bands that are not price bands: an item sold but not on the board, or with no band published. */
const NOT_A_BAND = [NO_BAND, 'No price band published']

/** The month the findings measure to: its name, its days, and the days left from the stock count. */
export interface AttentionMonth { name: string; days: number; left: number }

export function needsAttention(lines: Line[], items: ItemHealthRow[], people: People, month: AttentionMonth, store: string): Finding[] {
  const S = ATTENTION_SETTINGS, M = month.name, end = `${month.days}-${M.slice(0, 3)}`, left = month.left
  const r0 = (x: number) => Math.round(x), pcs = (x: number) => count(r0(x))
  const out: Finding[] = []
  // the same items at the region's other stores (the feed's own rows for them): who can spare, who will run out
  const oth = new Map<string, OtherStoreRow[]>()
  for (const r of items.filter(x => x.store_code !== store)) oth.set(r.item_code, [...(oth.get(r.item_code) ?? []),
    { item_code: r.item_code, short: r.store_short_code, name: people.stores[r.store_short_code] ?? r.store_short_code, stock: n(r.stock_qty), sold: n(r.sales_qty_28d) }])
  /** Stores holding more of the item than they need to the month's end at their own pace, most spare first. */
  const spareAt = (i: ItemHealthRow) => (oth.get(i.item_code) ?? []).map(r => [r.stock - r.sold / 28 * left, r] as const)
    .filter(([s]) => s >= S.minTransferPcs).sort((a, b) => b[0] - a[0])
  /** Stores that sell the item and will run out of it before the month's end at their own pace, most short first. */
  const shortAt = (i: ItemHealthRow) => (oth.get(i.item_code) ?? []).filter(r => r.sold >= S.minSellingTherePcs)
    .map(r => [r.sold / 28 * left - r.stock, r] as const).filter(([x]) => x >= S.minTransferPcs).sort((a, b) => b[0] - a[0])
  const storeName = (r: OtherStoreRow) => `${r.short} ${r.name}`
  const name = (i: ItemHealthRow) => i.item_name ?? i.item_code
  /** Stock here in floor words; a negative system figure counts as none and is called out as a count to check. */
  const here = (i: ItemHealthRow) => (n(i.stock_qty) >= 0 ? `${pcs(n(i.stock_qty))} pcs here` : `none here (the system shows ${r0(n(i.stock_qty))}: check the count)`)
  for (const l of lines) {
    const sub = l.name, bands = l.bands ?? []
    const who = people.subcategories[l.code ?? ''] ?? { buyer: null, categoryHead: null }
    const buyer = `${who.buyer || 'your buyer'} (buyer)`, head = `${who.categoryHead || 'your category head'} (category head)`
    const its = items.filter(i => i.store_code === store && i.subcategory_code === l.code)
    const subPrice = l.l28q ? l.l28 / l.l28q : 0
    const price = (i: ItemHealthRow) => (n(i.sales_qty_28d) > 0 ? n(i.sales_value_before_tax_28d) / n(i.sales_qty_28d) : n(i.selling_price_90d_incl_tax) || subPrice)
    const selling = bands.filter(sells)
    const totQ28 = selling.reduce((t, b) => t + b.q28, 0), totStock = selling.reduce((t, b) => t + b.stock, 0)
    const q7 = new Map<string, number>()
    for (const i of its) q7.set(i.price_band, (q7.get(i.price_band) ?? 0) + n(i.sales_qty_7d))
    const totQ7 = selling.reduce((t, b) => t + (q7.get(b.name) ?? 0), 0)
    const flagged = new Set<string>()
    const add = (kind: Finding['kind'], colour: Colour, rupees: number, title: string, evidence: string, action: string, band: string | null = null,
      nums: Finding['n'] = {}, pane: Partial<Pick<Finding, 'items' | 'itemsShow' | 'options'>> = {}, ask: 'buyer' | 'head' = 'buyer') =>
      out.push({ kind, colour, rupees: r0(rupees), line: sub, band, title, evidence, action, n: nums, items: pane.items ?? [], itemsShow: pane.itemsShow ?? 'sales',
        options: pane.options ?? [], who: [ask === 'head' ? { name: who.categoryHead || 'Your category head', role: 'Category head', id: who.categoryHead ? people.people?.[who.categoryHead] : undefined }
          : { name: who.buyer || 'Your buyer', role: 'Buyer', id: who.buyer ? people.people?.[who.buyer] : undefined }] })
    /** The pane's top items: a group's best sellers of the last 28 days, with their stock here. */
    const topOf = (group: ItemHealthRow[]): PaneItem[] => [...group].sort((a, b) => n(b.sales_value_before_tax_28d) - n(a.sales_value_before_tax_28d) || n(b.stock_qty) - n(a.stock_qty))
      .slice(0, S.topSellers).map(i => ({ item: name(i), code: i.item_code, qty: r0(n(i.sales_qty_28d)), value: r0(n(i.sales_value_before_tax_28d)), stock: r0(n(i.stock_qty)) }))
    /** The pane's transfer options for a group: per item, the region's store that can spare it (in) or will run out of it (out). */
    const optionsOf = (group: ItemHealthRow[], side: 'in' | 'out'): PaneOption[] => [...group]
      .sort((a, b) => (side === 'in' ? n(b.sales_value_before_tax_28d) - n(a.sales_value_before_tax_28d) : n(b.stock_qty) - n(a.stock_qty))).slice(0, 8)
      .flatMap(i => { const c = (side === 'in' ? spareAt(i) : shortAt(i))[0]; return c ? [{ item: name(i), store: storeName(c[1]), storeCode: c[1].short, theirStock: r0(c[1].stock), theirSold: r0(c[1].sold), pcs: r0(c[0]) }] : [] })
      .slice(0, 5)
    /** Transfers in: each (item, pieces still needed here) against the region's stores that can spare it. Returns the
     *  best one's words for the parent finding's action. */
    const bringIn = (cands: [ItemHealthRow, number][], why: string, band: string) => {
      const found = cands.flatMap(([i, need]) => {
        const sp = spareAt(i)[0]
        if (need < S.minTransferPcs || !sp) return []
        const take = Math.min(sp[0], need)
        return [{ rupees: take * price(i), i, r: sp[1], take }]
      }).sort((a, b) => b.rupees - a.rupees)
      for (const { rupees, i, r, take } of found.slice(0, S.transfersPerGroup))
        add('xin', 'red', rupees, `Bring in ${name(i)} from ${r.short}`,
          `${sub} · ${band}: ${why}; ${here(i)}. ${storeName(r)} holds ${pcs(r.stock)} pcs and sold ${pcs(r.sold)} in 28 days there`,
          `Ask ${storeName(r)} for ${pcs(take)} pcs; tell ${buyer}`, band,
          { item: name(i), store: storeName(r), storeCode: r.short, hereStock: r0(n(i.stock_qty)), hereSold: r0(n(i.sales_qty_28d)), theirStock: r0(r.stock), theirSold: r0(r.sold), move: r0(take) },
          { items: topOf([i]) })
      const best = found[0]
      return best ? `; ${storeName(best.r)} holds ${pcs(best.r.stock)} pcs of ${name(best.i)} and sold only ${pcs(best.r.sold)} in 28 days there, so ask for a transfer` : ''
    }
    /** Transfers out: each (item, pieces it can spare here) against the region's stores that will run out of it. */
    const sendOut = (cands: [ItemHealthRow, number][], why: string, band: string | null) => {
      const found = cands.flatMap(([i, spare]) => {
        const sh = shortAt(i)[0]
        if (spare < S.minTransferPcs || !sh) return []
        const offer = Math.min(spare, sh[0])
        return [{ rupees: offer * price(i), i, r: sh[1], offer }]
      }).sort((a, b) => b.rupees - a.rupees)
      for (const { rupees, i, r, offer } of found.slice(0, S.transfersPerGroup))
        add('xout', 'purple', rupees, `Send ${pcs(offer)} pcs of ${name(i)} to ${r.short}`,
          `${sub} · ${band ?? 'all bands'}: ${why}; ${pcs(n(i.stock_qty))} pcs here, ${pcs(n(i.sales_qty_28d))} sold in 28 days. ${storeName(r)} sold ${pcs(r.sold)} in 28 days and holds only ${pcs(r.stock)}`,
          `Offer them to ${storeName(r)}; tell ${buyer}`, band,
          { item: name(i), store: storeName(r), storeCode: r.short, hereStock: r0(n(i.stock_qty)), hereSold: r0(n(i.sales_qty_28d)), theirStock: r0(r.stock), theirSold: r0(r.sold), move: r0(offer) },
          { items: topOf([i]) })
      const best = found[0]
      return best ? `; offer ${pcs(best.offer)} pcs of ${name(best.i)} to ${storeName(best.r)}, which sold ${pcs(best.r.sold)} in 28 days and holds only ${pcs(best.r.stock)}` : ''
    }

    for (const b of selling) {
      const pace = b.fq ? b.fq / month.days : 0, need = pace * left
      const bandPrice = b.q28 ? b.v28 / b.q28 : subPrice
      const shareS = totQ28 ? b.q28 / totQ28 * 100 : 0, shareT = totStock ? b.stock / totStock * 100 : 0
      const share7 = totQ7 ? (q7.get(b.name) ?? 0) / totQ7 * 100 : 0
      const shares = `Sales ${r0(shareS)}% · Stock ${r0(shareT)}% of the subcategory`
      const shift = totQ7 && share7 - shareS > S.mixShiftPoints ? `; last 7 days took ${r0(share7)}% of its sales against ${r0(shareS)}% over 28` : ''
      const bandItems = its.filter(i => i.price_band === b.name)
      const wh = bandItems.reduce((t, i) => t + n(i.warehouse_stock_qty), 0)
      const lasts = pace ? b.stock / pace : 0
      if (pace && b.stock < need) {
        const short = need - b.stock
        // the warehouse covers what it can, never more than it holds; the buyer is asked only for the rest
        const pull = Math.min(short, wh), rest = short - pull
        let act = pull >= 1 ? `Pull ${pcs(pull)} pcs from the warehouse (it holds ${pcs(wh)})${rest >= 1 ? `; ask ${buyer} for the other ${pcs(rest)}` : ''}`
          : `Ask ${buyer} for about ${pcs(short)} pcs`
        // what the warehouse can't cover, shared over the band's selling items like their 28 days' sales: a transfer never
        // asks for more than that remainder, or than the other store can spare
        const gaps = bandItems.filter(i => n(i.sales_qty_28d) > 0).map(i => [i, Math.max(0, n(i.sales_qty_28d) / b.q28 * need - Math.max(0, n(i.stock_qty)))] as [ItemHealthRow, number])
        const gapSum = gaps.reduce((t, [, g]) => t + g, 0) || 1
        if (rest >= S.minTransferPcs) act += bringIn(gaps.map(([i, g]) => [i, g / gapSum * rest]), `this band runs short before ${end}`, b.name)
        add('short', 'red', short * bandPrice, `${sub} · ${b.name} will run short`,
          `${pcs(b.stock)} pcs last ${r0(lasts)} days at ${M}'s pace; about ${pcs(need)} pcs needed to ${end}. ${shares}${shift}`, act, b.name,
          { need: r0(need), stock: r0(b.stock), lasts: r0(lasts), short: r0(short), wh: r0(wh), shareSales: shareS, shareStock: shareT },
          { items: topOf(bandItems), options: optionsOf(bandItems.filter(i => n(i.sales_qty_28d) > 0), 'in') })
        flagged.add(b.name)
      } else if (pace && lasts > S.overstockDays) {
        const extra = b.stock - need
        // real stock at the region's other stores: offer the surplus where it will run out
        const move = sendOut(bandItems.map(i => [i, n(i.stock_qty) - (b.q28 ? n(i.sales_qty_28d) / b.q28 * need : 0)]), `this band has more stock than ${M} needs`, b.name)
        add('over', 'purple', extra * bandPrice, `${sub} · ${b.name} has too much stock`,
          `${pcs(b.stock)} pcs last ${r0(lasts)} days at ${M}'s pace; about ${pcs(extra)} pcs more than ${M} needs. ${shares}`, `Ask ${buyer} to slow re-orders${move}`, b.name,
          { stock: r0(b.stock), need: r0(need), lasts: r0(lasts), extra: r0(extra), shareSales: shareS, shareStock: shareT },
          { items: topOf(bandItems), options: optionsOf(bandItems, 'out') })
        flagged.add(b.name)
      } else if (totStock && Math.abs(shareT - shareS) > S.wellApartPoints) {
        const gap = shareT - shareS, off = Math.abs(gap) / 100 * totStock
        const fn = { shareSales: shareS, shareStock: shareT, gap, pcsOff: r0(off), stock: r0(b.stock), sold: r0(b.q28), lasts: pace ? r0(lasts) : null }
        if (gap < 0) add('follow', 'red', off * bandPrice, `${sub} · ${b.name}: stock doesn't follow sales`,
          `${shares}: about ${pcs(off)} pcs less than its sales share${shift}`, `Ask ${buyer} to tilt the next order to this band`, b.name, fn,
          { items: topOf(bandItems), options: optionsOf(bandItems.filter(i => n(i.sales_qty_28d) > 0), 'in') })
        else add('follow', 'purple', off * bandPrice, `${sub} · ${b.name}: stock doesn't follow sales`,
          `${shares}: about ${pcs(off)} pcs more than its sales share`, `Ask ${buyer} to slow this band's re-orders`, b.name, fn,
          { items: topOf(bandItems), options: optionsOf(bandItems, 'out') })
        flagged.add(b.name)
      } else if (shift && pace && lasts < left * 1.25) {
        const extra = (share7 - shareS) / 100 * l.fq * left / month.days
        add('mix', 'red', extra * bandPrice, `${sub} · ${b.name}: demand is moving here`,
          `${shift.slice(2, 3).toUpperCase()}${shift.slice(3)}; stock lasts ${r0(lasts)} days`, `Ask ${buyer} for more in this band`, b.name,
          { need: null, stock: r0(b.stock), lasts: r0(lasts), short: r0(extra), shareSales: shareS, shareStock: shareT, share7 },
          { items: topOf(bandItems), options: optionsOf(bandItems.filter(i => n(i.sales_qty_28d) > 0), 'in') })
      }
    }

    // top sellers at zero (or about to be) in a band that is not already flagged as a whole: a size or colour gap
    const tops = its.filter(i => n(i.sales_qty_28d) >= 3).sort((x, y) => n(y.sales_value_before_tax_28d) - n(x.sales_value_before_tax_28d)).slice(0, S.topSellers)
    for (const i of tops) {
      const rate = n(i.sales_qty_28d) / 28
      if (flagged.has(i.price_band) || n(i.stock_qty) > rate * 2) continue
      const lost = Math.max(0, rate * left - n(i.stock_qty)) * price(i)
      const shortI = Math.max(0, rate * left - n(i.stock_qty)), pullI = Math.min(shortI, n(i.warehouse_stock_qty))
      const act = (pullI >= 1 ? `Pull ${pcs(pullI)} pcs from the warehouse today (it holds ${pcs(n(i.warehouse_stock_qty))})` : `Ask ${buyer} to replenish it first`)
        + bringIn([[i, rate * left - n(i.stock_qty)]], 'a top seller nearly out', i.price_band)
      add('topout', 'red', lost, `Top seller out: ${name(i)}`,
        `${sub} · ${i.price_band}: sold ${pcs(n(i.sales_qty_28d))} pcs in 28 days; ${pcs(n(i.stock_qty))} left`, act, i.price_band,
        { item: name(i), sold: r0(n(i.sales_qty_28d)), stock: r0(n(i.stock_qty)), short: r0(shortI), wh: r0(n(i.warehouse_stock_qty)) },
        { items: topOf([i]), options: optionsOf([i], 'in') })
    }

    // stocked here, not selling here, selling elsewhere: is it on the shelf?
    const hidden = its.filter(i => n(i.stock_qty) >= 3 && n(i.sales_qty_14d) === 0 && n(i.other_stores_selling) >= 2
      && n(i.other_stores_sales_qty_14d) > 0 && !NOT_A_BAND.includes(i.price_band))
    if (hidden.length) {
      const exp = hidden.reduce((t, i) => t + Math.min(n(i.stock_qty), n(i.other_stores_sales_qty_14d) / n(i.other_stores_selling) / 14 * left) * price(i), 0)
      const top = hidden.reduce((a, b) => (n(b.other_stores_sales_qty_14d) > n(a.other_stores_sales_qty_14d) ? b : a))
      add('hidden', 'red', exp, `${sub}: ${hidden.length} ${hidden.length === 1 ? 'item' : 'items'} in stock but not selling here`,
        `None sold here in 14 days, yet they sold at other stores; e.g. ${top.item_name ?? top.item_code}: ${pcs(n(top.stock_qty))} pcs here, `
        + `${pcs(n(top.other_stores_sales_qty_14d))} sold at ${n(top.other_stores_selling)} other stores`,
        'Check they are on the shelf, in the right sizes and priced right', top.price_band,
        { items: hidden.length, stock: r0(hidden.reduce((t, i) => t + n(i.stock_qty), 0)), elsewhere14: r0(hidden.reduce((t, i) => t + n(i.other_stores_sales_qty_14d), 0)),
          stores: Math.max(...hidden.map(i => n(i.other_stores_selling))) },
        { itemsShow: 'elsewhere', items: [...hidden].sort((a, b) => n(b.other_stores_sales_qty_14d) - n(a.other_stores_sales_qty_14d)).slice(0, S.topSellers)
          .map(i => ({ item: name(i), code: i.item_code, qty: r0(n(i.other_stores_sales_qty_14d)), value: null, stock: r0(n(i.stock_qty)), stores: n(i.other_stores_selling) })) })
    }

    // dead and slow stock, at selling price
    const idle = its.filter(i => n(i.stock_qty) > 0 && n(i.sales_qty_28d) === 0)
    const dead = idle.filter(i => i.price_band.startsWith('Never sold') || yes(i.is_dead_stock) || n(i.days_since_stock_movement) >= S.deadDays)
    const slow = idle.filter(i => !dead.includes(i))
    // stock held, never less than none: an item booked below zero would shrink the total and push a share past 100%
    const allStock = its.reduce((t, i) => t + Math.max(0, n(i.stock_qty)), 0) || 1
    for (const [group, kind, title, days] of [[dead, 'dead', 'dead stock', `${S.deadDays} days`], [slow, 'slow', 'not selling', '28 days']] as const) {
      if (!group.length) continue
      const held = group.reduce((t, i) => t + n(i.stock_qty), 0)
      const move = sendOut(group.map(i => [i, n(i.stock_qty)]), `no sale here in ${days}`, null)
      add(kind, 'purple', group.reduce((t, i) => t + n(i.stock_qty) * price(i), 0), `${sub}: ${pcs(held)} pcs ${title}`,
        `${group.length} items with no sale in ${days}, ${r0(held / allStock * 100)}% of the subcategory's stock here`,
        `Move them off the best display; ask ${head} about a promotion or a return${move}`,
        kind === 'dead' && group.some(i => i.price_band.startsWith('Never sold')) ? 'Never sold (90 d)' : null,
        { noSale: days, items: group.length, stock: r0(held), shareStock: held / allStock * 100 },
        { itemsShow: 'stock', items: [...group].sort((a, b) => n(b.stock_qty) * price(b) - n(a.stock_qty) * price(a)).slice(0, S.topSellers)
          .map(i => ({ item: name(i), code: i.item_code, qty: null, value: r0(n(i.stock_qty) * price(i)), stock: r0(n(i.stock_qty)) })), options: optionsOf(group, 'out') }, 'head')
    }

    const noband = its.filter(i => NOT_A_BAND.includes(i.price_band))
    if (noband.length) {
      const sold = noband.reduce((t, i) => t + n(i.sales_value_before_tax_28d), 0), held = noband.reduce((t, i) => t + n(i.stock_qty), 0)
      add('noband', 'grey', sold, `${sub}: ${noband.length} ${noband.length === 1 ? 'item has' : 'items have'} no price band`,
        `They sold ${inr(sold)} in the last 28 days and hold ${pcs(held)} pcs, but no price band is published for them, so the band view leaves them out`,
        'Ask the forecast team to publish their price bands', noband[0].price_band,
        { items: noband.length, sold: r0(noband.reduce((t, i) => t + n(i.sales_qty_28d), 0)), soldValue: r0(sold), stock: r0(held) }, { items: topOf(noband) })
    }
  }
  const order: Record<Colour, number> = { red: 0, purple: 1, grey: 2 }
  return out.sort((a, b) => order[a.colour] - order[b.colour] || b.rupees - a.rupees)
}
