// MADE-UP DATA. The managers' review pages (Store Manager, category head, RB) on one invented December Run: eight
// stores in two regions, each laid out in floors and Team Leader sections, about forty-five subcategories under
// Fashion and Home, and a few proposals waiting with Store Managers. Built in the browser from fixed seeds (no large
// JSON in the bundle) through the same rows and linesFrom path as the Team Leader's Run. No real store, person or
// figure: every name and number is invented, shaped like a real chain's.
import { addSeed, type Rows, type Seed } from './madeUpRows'
import { linesFrom, type CopiedRows, type Line } from './model'
import type { Chain, ChainPerson, SectionInfo } from './chainData'
import { monthAfter, type ChangeSpec, type ProposalItem } from './review'

export const RUN = 'made_up_2026_12_official'
export const CUT_OFF = '2026-11-26'
export const HORIZON = '2026-12-01'
/** RB folds a store's subcategories under this into one "Smaller subcategories" row per category. */
export const SMALL_UNDER = 50_000

export interface Store { code: string; name: string; region: string; size: number }
export const STORES: Store[] = [
  { code: 'LKS', name: 'Lakeside', region: 'Kerala', size: 1.35 },
  { code: 'HLV', name: 'Hillview', region: 'Kerala', size: 1.1 },
  { code: 'RVB', name: 'Riverbend', region: 'Kerala', size: 0.85 },
  { code: 'PLG', name: 'Palm Grove', region: 'Kerala', size: 0.7 },
  { code: 'BKW', name: 'Backwater', region: 'Kerala', size: 0.55 },
  { code: 'MRN', name: 'Marina', region: 'Tamil Nadu', size: 1.25 },
  { code: 'TMP', name: 'Temple Road', region: 'Tamil Nadu', size: 0.9 },
  { code: 'CTN', name: 'Cotton Market', region: 'Tamil Nadu', size: 0.65 },
]

/** A section: its floor (building order) and the categories it holds. */
interface SectionSeed { name: string; floor: string; order: number; categories: string[] }
const SECTIONS: SectionSeed[] = [
  { name: 'Sarees', floor: 'Ground Floor', order: 0, categories: ['Women Saree'] },
  { name: 'Women Ethnic', floor: 'Ground Floor', order: 0, categories: ['Women Kurti'] },
  { name: 'Women Western', floor: 'Ground Floor', order: 0, categories: ['Women Western'] },
  { name: 'Girls Bottoms', floor: 'First Floor', order: 1, categories: ['Girls Bottom'] },
  { name: 'Girls Tops and Frocks', floor: 'First Floor', order: 1, categories: ['Girls Top', 'Girls Frock'] },
  { name: 'Girls Ethnic', floor: 'First Floor', order: 1, categories: ['Girls Ethnic'] },
  { name: 'Boys', floor: 'First Floor', order: 1, categories: ['Boys Top', 'Boys Bottom'] },
  { name: 'Men Tops', floor: 'Second Floor', order: 2, categories: ['Men Top'] },
  { name: 'Men Bottoms and Ethnic', floor: 'Second Floor', order: 2, categories: ['Men Bottom', 'Men Ethnic'] },
  { name: 'Kitchen', floor: 'Third Floor', order: 3, categories: ['Cookware', 'Storage'] },
  { name: 'Home Decor', floor: 'Third Floor', order: 3, categories: ['Furnishing'] },
]
const TEAM_LEADERS = ['Asha', 'Ravi', 'Meena', 'Anil', 'Divya', 'Suresh', 'Latha', 'Joseph', 'Nisha', 'Prakash', 'Rekha', 'Vinod']

/** The merchandise: division › subdivision › category › [subcategory, its size in ₹ of last 28 days at a 1.0 store, its ASP]. */
const MERCH: [string, string, string, [string, number, number][]][] = [
  ['Fashion', 'Women', 'Women Saree', [['Silk Saree', 820000, 2400], ['Cotton Saree', 410000, 780], ['Fancy Saree', 290000, 1150]]],
  ['Fashion', 'Women', 'Women Kurti', [['Long Kurti', 360000, 690], ['Short Kurti', 240000, 520], ['Kurti Set', 52000, 980]]],
  ['Fashion', 'Women', 'Women Western', [['Women Jean', 210000, 890], ['Women Top', 180000, 450], ['Women Jumpsuit', 21000, 1100]]],
  ['Fashion', 'Girls', 'Girls Bottom', [['Girls Jean', 540000, 520], ['Girls Jeggings', 61000, 270], ['Girls Pant', 18000, 240], ['Girls Short', 245000, 150], ['Girls Skirt', 140000, 420], ['Girls Palazzo', 125000, 175], ['Girls Capri', 26000, 160], ['Girls Leggings', 73000, 140]]],
  ['Fashion', 'Girls', 'Girls Top', [['Girls T Shirt', 260000, 150], ['Girls Fashion Top', 290000, 190], ['Girls Tunic', 120000, 440]]],
  ['Fashion', 'Girls', 'Girls Frock', [['Party Frock', 230000, 760], ['Cotton Frock', 150000, 320], ['Girls Midi', 14000, 600]]],
  ['Fashion', 'Girls', 'Girls Ethnic', [['Churidar Set', 170000, 650], ['Pattu Pavada', 210000, 900], ['Lehenga', 33000, 1400]]],
  ['Fashion', 'Boys', 'Boys Top', [['Boys T Shirt', 190000, 160], ['Boys Shirt', 150000, 280]]],
  ['Fashion', 'Boys', 'Boys Bottom', [['Boys Jean', 160000, 430], ['Boys Short', 90000, 150], ['Boys Track Pant', 24000, 210]]],
  ['Fashion', 'Men', 'Men Top', [['Formal Shirt', 380000, 690], ['Casual Shirt', 330000, 620], ['Men T Shirt', 270000, 290]]],
  ['Fashion', 'Men', 'Men Bottom', [['Men Jean', 310000, 990], ['Formal Trouser', 230000, 860]]],
  ['Fashion', 'Men', 'Men Ethnic', [['Dhoti', 190000, 420], ['Lungi', 120000, 210], ['Kurta Set', 31000, 1200]]],
  ['Home', 'Kitchen', 'Cookware', [['Pressure Cooker', 140000, 1900], ['Tawa', 41000, 520]]],
  ['Home', 'Kitchen', 'Storage', [['Steel Container', 92000, 380], ['Plastic Box', 38000, 140]]],
  ['Home', 'Decor', 'Furnishing', [['Bedsheet', 150000, 640], ['Curtain', 72000, 520], ['Towel', 61000, 180]]],
]

/** A steady number in [0, 1) from a string, so the made-up figures never change between loads. */
export function hash(s: string): number {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (h % 1000) / 1000
}

export type { SectionInfo } from './chainData'

/** A made-up subcategory code (MU-0001 …), one per subcategory name, in the merchandise's order. */
const CODE = new Map(MERCH.flatMap(([, , , subs]) => subs.map(([name]) => name)).map((name, i) => [name, `MU-${String(i + 1).padStart(4, '0')}`]))

let cache: (Chain & { rows: CopiedRows }) | null = null

/** The made-up chain: its copied rows, every store's lines, the sections with their Team Leaders, the people, and the
 *  proposals. */
export function madeUpChain(): Chain & { rows: CopiedRows } {
  if (cache) return cache
  const rows: Rows = { lines: [], sales: [], plans: [], others: [] }
  const sections: SectionInfo[] = []
  let i = 0
  for (const st of STORES) {
    SECTIONS.forEach((sec, si) => sections.push({ store: st.code, section: sec.name, floor: sec.floor, floorOrder: sec.order,
      teamLeader: TEAM_LEADERS[(si + STORES.indexOf(st) * 5) % TEAM_LEADERS.length] }))
    for (const [division, subdivision, category, subs] of MERCH) {
      const sec = SECTIONS.find(s => s.categories.includes(category))!
      // the category's seeds first: its rebalancing (the seeds' last number) nets to zero across them
      const seeds: [Seed, number][] = []
      for (const [name, size, asp] of subs) {
        const h = (k: string) => hash(`${st.code}|${name}|${k}`)
        // a store does not stock every small subcategory
        if (size < 30000 && h('stock') < 0.3) continue
        const l28 = Math.round(size * st.size * (0.6 + h('size') * 0.8))
        // one pair at every store moved in opposite directions (items re-coded between them), so groups show (TL-20)
        const growth = name === 'Girls Jean' ? 2.4 + Math.round(h('g2') * 40) / 100 : name === 'Girls Jeggings' ? 0.32 + Math.round(h('g2') * 10) / 100 : Math.round((h('g') < 0.06 ? 2.2 + h('g2') : h('g') < 0.12 ? 0.3 + h('g2') * 0.15 : 0.7 + h('g2') * 0.6) * 100) / 100
        const ly28 = Math.round(l28 / growth * (0.9 + h('ly28') * 0.2))
        const step = Math.round((1.1 + h('step') * 0.3) * 100) / 100
        const ly = Math.round(ly28 / 28 * 31 * (1.05 + h('ly') * 0.45))
        const w6 = 0.45 + h('w6') * 0.3, w1 = (1 - w6) * (0.3 + h('w1') * 0.4)
        const rest = (1 - w6 - w1) / 4
        const weights = [Math.round(w1 * 100) / 100, Math.round(rest * 100) / 100, Math.round(rest * 100) / 100, Math.round(rest * 100) / 100, Math.round(rest * 100) / 100, Math.round(w6 * 100) / 100]
        const rebal = h('adj') < 0.35 ? Math.round((h('adj2') - 0.5) * 4000) : 0
        // price and rounding: a few rupees of whole-rupee rounding
        const price = Math.round(h('price') * 6) - 3
        seeds.push([[name, category, l28, asp, ly28, ly, Math.round(asp * (0.9 + h('asp') * 0.15)), growth, step, weights, rebal], price])
      }
      if (seeds.length > 1) { const last = seeds[seeds.length - 1][0]; last[10] = -seeds.slice(0, -1).reduce((t, [x]) => t + x[10], 0) }
      else if (seeds.length === 1) seeds[0][0][10] = 0
      for (const [seed, price] of seeds) addSeed(rows, seed, { run: RUN, store_code: st.code, store_name: st.name, division_name: division, subdivision_name: subdivision,
        section_name: sec.name, region_name: st.region, floor_name: sec.floor, floor_order: sec.order, material_group_code: CODE.get(seed[0]) }, i++, price)
    }
  }
  const copied = rows as unknown as CopiedRows
  // the copies carry no place: each line takes its store's name and its section's floor, as the real loader does from the org chart
  const at = new Map(rows.lines.map(r => [String(r.row_id), r]))
  const lines = linesFrom(copied).map(l => {
    const r = at.get(l.rowId)!
    return { ...l, storeName: String(r.store_name), section: String(r.section_name), floor: String(r.floor_name ?? ''), floorOrder: Number(r.floor_order ?? 99), region: String(r.region_name ?? l.region) }
  })
  const kerala = STORES.filter(s => s.region === 'Kerala').map(s => s.code)
  const people: ChainPerson[] = [
    { name: 'Selvi', role: 'Store Manager', place: 'Lakeside', places: [{ store: 'LKS', codes: null }] },
    // a category head's merchandise: these subcategory codes at these stores (as a Merchandise Assignment gives them)
    { name: 'Bina', role: 'Category Head', place: 'Women, Girls', places: kerala.map(store => ({ store, codes: MERCH.filter(([, sub]) => sub === 'Women' || sub === 'Girls').flatMap(([, , , subs]) => subs.map(([n]) => CODE.get(n)!)) })) },
    { name: 'Kumar', role: 'Chief Executive', place: 'Head Office', places: STORES.map(s => ({ store: s.code, codes: null })) },
  ]
  cache = { real: false, rows: copied, lines, sections, people, proposals: proposalsFor(lines, sections), cutOff: CUT_OFF, horizon: HORIZON }
  return cache
}

const REASON_SETS = [['stock_arriving'], ['stock_short'], ['display_space', 'customers_asking'], ['price_changed'], ['last_month_one_off'], ['range_dropped']]
const NOTES = ['New stock of 400 pcs arrives 05-Dec.', 'Supplier is short till mid-December.', 'Moving to the front display from 01-Dec.',
  'Prices drop 10% from 01-Dec.', 'November had a one-day sale that will not repeat.', 'Half the range is not being reordered.']

/** A few changes Team Leaders proposed, waiting with their Store Managers: six at Lakeside, fewer at the others. */
function proposalsFor(lines: Line[], sections: SectionInfo[]): ProposalItem[] {
  const out: ProposalItem[] = []
  for (const st of STORES) {
    const want = st.code === 'LKS' ? 6 : Math.floor(hash(`${st.code}|p`) * 5)
    const mine = lines.filter(l => l.store === st.code && l.fc > 100000).sort((a, b) => hash(a.rowId) - hash(b.rowId)).slice(0, want)
    mine.forEach((l, k) => {
      const up = hash(`${l.rowId}|up`) < 0.55, pct = (8 + Math.round(hash(`${l.rowId}|pct`) * 22)) / 100
      const tl = sections.find(s => s.store === l.store && s.section === l.section)!.teamLeader
      const kind = k % 3 === 2 ? 'day' : k % 3 === 1 ? 'percent' : 'month'
      const signed = Math.round((up ? pct : -pct) * 100)
      const change: ChangeSpec = kind === 'day'
        ? { scope: 'day', method: 'percent', percent: signed * 2, days: ['2026-12-24', '2026-12-25', '2026-12-26'], batch: `B-${st.code}-${k + 1}` }
        : kind === 'percent' ? { scope: 'month', method: 'percent', percent: signed }
          : { scope: 'month', method: 'set_value', value: Math.round(l.fc * (1 + signed / 100) / 1000) * 1000 }
      const proposed = monthAfter(l.fc, 31, change)
      out.push({
        id: `CHG-${st.code}-${k + 1}`, line: l.rowId, by: tl, role: 'Team Leader', section: l.section,
        sentOn: `2026-11-${String(26 - (k % 3)).padStart(2, '0')}`, forecast: l.fc, proposed,
        reasons: kind === 'day' ? ['event_or_festival'] : REASON_SETS[k % REASON_SETS.length],
        note: kind === 'day' ? 'Christmas crowd: last year these three days sold double.' : NOTES[k % NOTES.length], state: 'waiting', change,
      })
    })
  }
  return out
}
