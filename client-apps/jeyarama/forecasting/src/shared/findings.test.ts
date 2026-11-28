import { describe, expect, it } from 'vitest'
import fixture from '../../fixtures/team-leader-december.json'
import { linesFrom, type CopiedRows, type Line } from './model'
import type { Band } from './bands'
import { ATTENTION_SETTINGS, needsAttention, type ItemHealthRow, type People } from './findings'

const lines = linesFrom({ lines: fixture.forecast_line_month, sales: fixture.sales_reference, plans: fixture.annual_plan_line, others: fixture.other_model_day,
  bands: { mix: fixture.price_band_mix, stock: fixture.stock_band, items: fixture.price_band_top_item } } as unknown as CopiedRows, '9001')
const DEC = { name: 'December', days: 31, left: 34 }
const people: People = { subcategories: { X1: { buyer: 'Kavya', categoryHead: 'Ravi' } }, stores: { MOT: 'Store MOT', HLT: 'Store HLT', NOR: 'Store NOR' } }

// one subcategory, X, with its bands; 31 forecast pieces a band is one a day
const band = (name: string, over: Partial<Band>): Band => ({ name, order: 1, fc: 0, fq: 31, share: 0, stock: 0, q28: 28, v28: 2800, shareSales: null, shareStock: null, sold: 1, n50: 1, n70: 1, items: [], ...over })
const line = (bands: Band[], over: Partial<Line> = {}): Line => ({ ...lines[0], name: 'X', code: 'X1', l28: 5600, l28q: 56, fq: 62, bands, ...over })
const item = (code: string, over: Partial<ItemHealthRow>): ItemHealthRow => ({ store_code: 'S', store_short_code: 'LKS', subcategory_code: 'X1', price_band: 'a', item_code: code, item_name: `Item ${code}`,
  stock_qty: 0, warehouse_stock_qty: 0, days_since_stock_movement: 1, is_dead_stock: false, sales_qty_7d: 0, sales_qty_14d: 0, sales_qty_28d: 0, sales_value_before_tax_28d: 0, selling_price_90d_incl_tax: 100,
  other_stores_selling: 0, other_stores_sales_qty_14d: 0, ...over })
// the same item at another store: that store's own item health row
const at = (code: string, short: string, stock: number, sold: number): ItemHealthRow => item(code, { store_code: `P-${short}`, store_short_code: short, stock_qty: stock, sales_qty_28d: sold })
const find = (l: Line, items: ItemHealthRow[] = [], others: ItemHealthRow[] = []) => needsAttention([l], [...items, ...others], people, DEC, 'S')

describe('Needs Your Attention (#1419, approved 28-Nov-2026)', () => {
  it('names its thresholds, as the prototype does', () => {
    expect(ATTENTION_SETTINGS).toEqual({ wellApartPoints: 5, overstockDays: 60, deadDays: 90, topSellers: 5, mixShiftPoints: 5,
      minTransferPcs: 3, minSellingTherePcs: 5, transfersPerGroup: 3 })
  })

  it("says a band will run short when its stock won't last to the month's end, priced at the band's selling price", () => {
    // one a day for 34 days needs 34; 10 in stock leaves 24 short, at ₹100 a piece
    const [f] = find(line([band('a', { stock: 10 }), band('b', { stock: 10 })]), [item('1', { warehouse_stock_qty: 8 })])
    expect(f).toMatchObject({ kind: 'short', colour: 'red', rupees: 2400, band: 'a', title: 'X · a will run short',
      action: 'Pull 8 pcs from the warehouse (it holds 8); ask Kavya (buyer) for the other 16' })
    expect(f.evidence).toContain('10 pcs last 10 days at December\'s pace; about 34 pcs needed to 31-Dec')
  })

  it('asks the buyer when the warehouse holds none, and never pulls more than the band is short', () => {
    expect(find(line([band('a', { stock: 10 })]))[0].action).toBe('Ask Kavya (buyer) for about 24 pcs')
    expect(find(line([band('a', { stock: 10 })]), [item('1', { warehouse_stock_qty: 100 })])[0].action).toBe('Pull 24 pcs from the warehouse (it holds 100)')
  })

  it("brings in only what the warehouse can't cover", () => {
    // 24 short; the warehouse holds 20, so a transfer is asked for the other 4, though MOT could spare 50
    const f = find(line([band('a', { stock: 10, q28: 28 })]), [item('1', { stock_qty: 10, sales_qty_28d: 28, sales_value_before_tax_28d: 2800, warehouse_stock_qty: 20 })], [at('1', 'MOT', 50, 0)])
    expect(f.find(x => x.kind === 'xin')).toMatchObject({ action: 'Ask MOT Store MOT for 4 pcs; tell Kavya (buyer)' })
    expect(f.find(x => x.kind === 'short')!.action).toMatch(/^Pull 20 pcs from the warehouse \(it holds 20\); ask Kavya \(buyer\) for the other 4; MOT Store MOT holds 50 pcs/)
  })

  it('says a band has too much stock past 60 days, and offers the surplus to a store that will run out of it', () => {
    // the band needs 34; item 1 is all of its sales, so it can spare 70 − 34 = 36. HLT sells 28 in 28 days (34 to the
    // month's end) and holds 4: it is 30 short, so it is offered 30
    const f = find(line([band('a', { stock: 70, q28: 28 })]), [item('1', { stock_qty: 70, sales_qty_28d: 28 })], [at('1', 'HLT', 4, 28), at('1', 'NOR', 1, 2)])
    expect(f.find(x => x.kind === 'over')).toMatchObject({ colour: 'purple', rupees: 3600,
      action: 'Ask Kavya (buyer) to slow re-orders; offer 30 pcs of Item 1 to HLT Store HLT, which sold 28 in 28 days and holds only 4' })
    expect(f.find(x => x.kind === 'xout')).toMatchObject({ colour: 'purple', title: 'Send 30 pcs of Item 1 to HLT', action: 'Offer them to HLT Store HLT; tell Kavya (buyer)' })
  })

  it('brings stock in for a band that runs short from a store that holds more than it needs', () => {
    // the band needs 34 and holds 10; item 1 is all its sales, so needs 34 − 10 = 24. MOT sold 0 and holds 50: it can spare 50
    const f = find(line([band('a', { stock: 10, q28: 28 })]), [item('1', { stock_qty: 10, sales_qty_28d: 28, sales_value_before_tax_28d: 2800 })], [at('1', 'MOT', 50, 0)])
    expect(f.find(x => x.kind === 'xin')).toMatchObject({ colour: 'red', rupees: 2400, title: 'Bring in Item 1 from MOT', action: 'Ask MOT Store MOT for 24 pcs; tell Kavya (buyer)' })
    expect(f.find(x => x.kind === 'short')!.action).toContain('; MOT Store MOT holds 50 pcs of Item 1 and sold only 0 in 28 days there, so ask for a transfer')
  })

  it('offers no transfer under 3 pieces, and to no store that sold under 5 in 28 days', () => {
    expect(find(line([band('a', { stock: 70, q28: 28 })]), [item('1', { stock_qty: 70, sales_qty_28d: 28 })], [at('1', 'HLT', 0, 4)]).some(x => x.kind === 'xout')).toBe(false)
    expect(find(line([band('a', { stock: 10, q28: 28 })]), [item('1', { stock_qty: 10, sales_qty_28d: 28 })], [at('1', 'MOT', 2, 0)]).some(x => x.kind === 'xin')).toBe(false)
  })

  it("says stock doesn't follow sales when the shares are more than 5 points apart, red short and purple over", () => {
    const f = find(line([band('a', { stock: 40, q28: 28 }), band('b', { stock: 60, q28: 28 })]))
    expect(f.map(x => `${x.colour} ${x.kind} ${x.band}`)).toEqual(['red follow a', 'purple follow b'])
    expect(f[0].evidence).toBe('Sales 50% · Stock 40% of the subcategory: about 10 pcs less than its sales share')
  })

  it('says demand is moving to a band whose last 7 days run more than 5 points above its 28-day share', () => {
    const f = find(line([band('a', { stock: 40 }), band('b', { stock: 40 })]), [item('1', { price_band: 'a', sales_qty_7d: 6 }), item('2', { price_band: 'b', sales_qty_7d: 4 })])
    expect(f[0]).toMatchObject({ kind: 'mix', colour: 'red', title: 'X · a: demand is moving here' })
    expect(f[0].evidence).toBe('Last 7 days took 60% of its sales against 50% over 28; stock lasts 40 days')
  })

  it('says a top seller is out when its stock covers under two days, unless its band is already flagged', () => {
    const top = item('1', { price_band: 'b', sales_qty_28d: 28, sales_value_before_tax_28d: 2800, stock_qty: 1, warehouse_stock_qty: 3 })
    const f = find(line([band('a', { stock: 40 }), band('b', { stock: 40 })]), [top])
    expect(f.find(x => x.kind === 'topout')).toMatchObject({ title: 'Top seller out: Item 1', rupees: 3300, action: 'Pull 3 pcs from the warehouse today (it holds 3)' })
    expect(find(line([band('a', { stock: 40 }), band('b', { stock: 5 })]), [top]).some(x => x.kind === 'topout')).toBe(false)
  })

  it('says items in stock here sell at other stores when none sold here in 14 days and two or more stores sell them', () => {
    const f = find(line([]), [item('1', { stock_qty: 5, other_stores_selling: 2, other_stores_sales_qty_14d: 14 })])
    expect(f[0]).toMatchObject({ kind: 'hidden', colour: 'red', title: 'X: 1 item in stock but not selling here', action: 'Check they are on the shelf, in the right sizes and priced right' })
  })

  it('counts dead stock (no sale in 90 days, or Never sold) apart from slow stock, at selling price, and asks the category head', () => {
    const f = find(line([]), [item('1', { price_band: 'Never sold (90 d)', stock_qty: 10 }), item('2', { stock_qty: 5, days_since_stock_movement: 95 }), item('3', { stock_qty: 5, days_since_stock_movement: 40 })])
    expect(f.map(x => `${x.kind} ${x.rupees} ${x.band}`)).toEqual(['dead 1500 Never sold (90 d)', 'slow 500 null'])
    expect(f[0].action).toBe('Move them off the best display; ask Ravi (category head) about a promotion or a return')
  })

  it("never puts dead stock above 100% of the subcategory's stock when an item is booked below zero", () => {
    const f = find(line([]), [item('1', { stock_qty: 10, days_since_stock_movement: 95 }), item('2', { stock_qty: -3, sales_qty_28d: 2 })])
    expect(f.find(x => x.kind === 'dead')!.n.shareStock).toBe(100)
  })

  it('folds items with no price band into data to fix, and ranks red, then purple, then grey, each by its own ₹', () => {
    const f = find(line([band('a', { stock: 10 })]), [item('1', { price_band: 'No band', sales_value_before_tax_28d: 900, stock_qty: 2 }), item('2', { stock_qty: 5, days_since_stock_movement: 40 })])
    expect(f.map(x => x.colour)).toEqual(['red', 'purple', 'grey'])
    expect(f[2]).toMatchObject({ kind: 'noband', rupees: 900, title: 'X: 1 item has no price band' })
  })

  it('names "your buyer" when Merchandise Assignment has no one for the subcategory', () => {
    expect(needsAttention([line([band('a', { stock: 10 })])], [], { subcategories: {}, stores: {} }, DEC, 'S')[0].action).toBe('Ask your buyer (buyer) for about 24 pcs')
  })
})
