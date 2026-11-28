import { beforeEach, describe, expect, it, vi } from 'vitest'

// The landing page and the section switcher (#1419): a month holds ~19,000 lines across every store, so the store
// list comes from one grouped count and only the chosen store's lines are read.
const api = vi.hoisted(() => ({ countBy: vi.fn(), listWhere: vi.fn(), readOp: vi.fn(), getRow: vi.fn(), saveRow: vi.fn() }))
vi.mock('../api', () => api)
import { loadStore } from './live'

const run = (id: string) => ({ run_id: id, purpose: 'official', origin_date: '2026-11-27', horizon_from: '2026-12-01', horizon_to: '2026-12-31' })
const line = (store: string, sub: string, fc: number) => ({ run_id: 'tn_dec', store_code: `${store}-code`, store_short_code: store, subcategory_code: sub, subcategory_name: sub, forecast_value_before_tax: fc })
const org = { store: 'BIG', region: null, storeManagers: [], storeManagerIds: [], stores: {}, people: {},
  sections: [{ id: 'S1', name: 'Oils', floor: 'Ground', floorOrder: 1, teamLeaders: [] }], subcategories: { a: { section: 'S1' }, b: { section: 'S1' } } }

describe('loadStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.countBy.mockResolvedValue([{ label: 'BIG', value: 900 }, { label: 'SMALL', value: 40 }, { label: '', value: 2 }])
    api.readOp.mockResolvedValue(org)
    api.listWhere.mockImplementation(async (table: string) => (
      table === 'forecasting.forecast_run' ? [run('kl_dec'), run('tn_dec')]
        : table === 'forecasting.forecast_line_month' ? [line('BIG', 'a', 100), line('BIG', 'b', 50)]
          : []))
  })

  it("lists the month's stores from one grouped count and reads only the largest store's lines", async () => {
    const s = (await loadStore())!
    expect(api.countBy).toHaveBeenCalledWith('forecasting.forecast_line_month', 'store_short_code', [['run_id', 'in', ['kl_dec', 'tn_dec']]])
    expect(s.stores).toEqual(['BIG', 'SMALL'])
    expect(s.store).toBe('BIG')
    const lineReads = api.listWhere.mock.calls.filter(c => c[0] === 'forecasting.forecast_line_month')
    expect(lineReads).toHaveLength(1)
    expect(lineReads[0][2]).toEqual([['store_short_code', '=', 'BIG'], ['run_id', 'in', ['kl_dec', 'tn_dec']]])
    expect(s.sections).toMatchObject([{ section: 'Oils', subcategories: 2, fc: 150 }])
  })

  it('reads the store named when the month has it', async () => {
    await loadStore('SMALL')
    expect(api.listWhere.mock.calls.find(c => c[0] === 'forecasting.forecast_line_month')![2][0]).toEqual(['store_short_code', '=', 'SMALL'])
  })
})
