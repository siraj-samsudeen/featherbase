import { beforeEach, describe, expect, it, vi } from 'vitest'

// The landing page and the section switcher (#1419): a month holds ~19,000 lines across every store, so only the
// chosen store's lines are read whole. Since #1454 every copy is read through the scoped read (listCopy), so the
// store list is the stores of the person's own places: their lines of the month, one column each.
const api = vi.hoisted(() => ({ listCopy: vi.fn(), listReview: vi.fn(), listWhere: vi.fn(), readOp: vi.fn(), getRow: vi.fn(), saveRow: vi.fn() }))
vi.mock('../api', () => api)
import { loadStore } from './live'

const run = (id: string) => ({ run_id: id, purpose: 'official', origin_date: '2026-11-27', horizon_from: '2026-12-01', horizon_to: '2026-12-31' })
const line = (store: string, sub: string, fc: number) => ({ run_id: 'tn_dec', store_code: `${store}-code`, store_short_code: store, subcategory_code: sub, subcategory_name: sub, forecast_value_before_tax: fc })
const org = { store: 'BIG', region: null, storeManagers: [], storeManagerIds: [], stores: {}, people: {},
  sections: [{ id: 'S1', name: 'Oils', floor: 'Ground', floorOrder: 1, teamLeaders: [] }], subcategories: { a: { section: 'S1' }, b: { section: 'S1' } } }
const rowsOf = (store: string, n: number) => Array.from({ length: n }, () => ({ store_short_code: store }))

describe('loadStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.readOp.mockResolvedValue(org)
    api.listWhere.mockImplementation(async (table: string) => (table === 'forecasting.forecast_run' ? [run('kl_dec'), run('tn_dec')] : []))
    api.listReview.mockResolvedValue([])
    api.listCopy.mockImplementation(async (table: string, fields: string[], filters: [string, string, unknown][]) => {
      if (table !== 'forecasting.forecast_line_month') return []
      // the store count reads one column; the chosen store's read names it
      if (fields.length === 1) return [...rowsOf('BIG', 9), ...rowsOf('SMALL', 4), { store_short_code: null }]
      const store = filters.find(f => f[0] === 'store_short_code')?.[2]
      return [line(String(store), 'a', 100), line(String(store), 'b', 50)]
    })
  })

  it("lists the person's stores from their lines of the month and reads only the largest store's lines whole", async () => {
    const s = (await loadStore())!
    expect(api.listCopy).toHaveBeenCalledWith('forecasting.forecast_line_month', ['store_short_code'], [['run_id', 'in', ['kl_dec', 'tn_dec']]])
    expect(s.stores).toEqual(['BIG', 'SMALL'])
    expect(s.store).toBe('BIG')
    const whole = api.listCopy.mock.calls.filter(c => c[0] === 'forecasting.forecast_line_month' && c[1].length > 1)
    expect(whole).toHaveLength(1)
    expect(whole[0][2]).toEqual([['store_short_code', '=', 'BIG'], ['run_id', 'in', ['kl_dec', 'tn_dec']]])
    expect(s.sections).toMatchObject([{ section: 'Oils', subcategories: 2, fc: 150 }])
    // nothing reads a copy around the scoped read
    expect(api.listWhere.mock.calls.filter(c => c[0] !== 'forecasting.forecast_run')).toEqual([])
  })

  it('reads the store named when the month has it', async () => {
    await loadStore('SMALL')
    expect(api.listCopy.mock.calls.find(c => c[0] === 'forecasting.forecast_line_month' && c[1].length > 1)![2][0]).toEqual(['store_short_code', '=', 'SMALL'])
  })
})
