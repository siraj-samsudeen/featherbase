// Feather Dash's reads over a stand-in for what the platform hands a read
// handler (the reader's places, the cached dataset, settings, secrets,
// recordView), and a stand-in for MotherDuck's embed API (the network
// boundary). Made-up stores, people and figures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMBED_API_TIMEOUT_MS, MONTH_DATASET, STORE_NAMES_TIMEOUT_MS, reads, setEmbedFetch, SALES_DATASET } from './server'
import type { Place } from './provider.ts'
import type { SalesRow } from './report.ts'

const AT = '2026-10-15T00:19:00.000Z'
const place = (label: string, store: string, subcategory?: string[]): Place =>
  ({ label, filters: subcategory ? { store: [store], subcategory } : { store: [store] } })
const row = (store: string, code: string, name: string | null = 'Lakeside'): SalesRow => ({
  store_code: store, store_name: name, short_code: null, subcategory_code: code, subcategory: `Name ${code}`, target: 1000, actual: 800,
  days_with_actual: 14, days: 15, period_start: '2026-10-01', data_through: '2026-10-14', targets_available: true, target_days: 15 })

interface Options {
  places?: Place[]
  rows?: SalesRow[] | null
  payload?: Record<string, unknown>
  settings?: Record<string, string>
  /** The cache read throws (its source is not set up, say). */
  cacheThrows?: boolean
  /** What a live read of the dataset answers: the warehouse, as the platform limits it to the reader's places. */
  live?: SalesRow[]
  /** The month's metadata rows (`sales_month`); none when it isn't built. */
  month?: Record<string, unknown>[] | null
  monthStalls?: boolean
  monthThrows?: boolean
}
const DIVE = { dive_id: 'dive-made-up', dive_version: '7', embed_service_account: 'svc-made-up' }

function context({ places = [place('9901 / Section: Sarees', '9901', ['010101001'])], rows = [row('9901', '010101001')], payload = {}, settings = DIVE,
  cacheThrows = false, live = [], month = null, monthStalls = false, monthThrows = false }: Options = {}) {
  const views: unknown[] = []
  const asked: unknown[] = []
  return {
    views, asked,
    ctx: {
      user: 'psn_103', payload, settings, secrets: { MOTHERDUCK_TOKEN: 'token-made-up' },
      authorization: { places },
      reject(message: string): never { throw new Error(message) },
      datasets: {
        async active(name: string, filters?: Record<string, unknown>) {
          asked.push([name, filters])
          if (name === MONTH_DATASET) {
            if (monthStalls) return new Promise<null>(() => {})
            if (monthThrows) throw new Error('not set up')
            return month && { dataset: name, served: 'cached', at: AT, rows: month }
          }
          if (cacheThrows) throw new Error('not set up')
          if (rows === null) return null
          const store = filters?.store_code
          return { dataset: name, served: 'cached', at: AT, rows: store ? rows.filter(r => r.store_code === store) : rows }
        },
        async live(name: string, filters?: Record<string, unknown>) {
          asked.push(['live', name, filters])
          return { dataset: name, served: 'live', at: AT, rows: live.filter(r => r.store_code === filters?.store_code) }
        },
      },
      async recordView(details: unknown) { views.push(details) },
    },
  }
}

// The fixtures are October 2026's: the reads work out the month from the clock, so it is frozen
// on a day of that month (only Date is faked; promises and timers run as usual).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T06:00:00Z'))
})
afterEach(() => {
  setEmbedFetch(null)
  vi.useRealTimers()
})

describe('the me read', () => {
  it("answers the caller's user name", () => {
    expect(reads.me({ user: 'manager@example.com' })).toEqual({ user: 'manager@example.com' })
  })
})

describe("the stores read (the bar's store picker)", () => {
  const TWO = [place('9902', '9902'), place('9901 / Section: Sarees', '9901', ['010101001'])]
  const monthRow = (store: string, name: string) => ({ store_code: store, store_name: name, subcategory_code: '010101001',
    period_start: '2026-10-01', data_through: '2026-10-14', targets_available: true })

  it("offers each of the reader's stores from their places, named from the month's metadata", async () => {
    const { ctx } = context({ places: TWO, month: [monthRow('9901', 'Lakeside'), monthRow('9902', 'Hillview')] })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Lakeside' }, { value: '9902', label: 'Hillview' }])
  })

  it('never reads the cached figures, so a failing cache leaves the picker whole', async () => {
    const { ctx, asked } = context({ places: TWO, cacheThrows: true, month: [monthRow('9901', 'Lakeside'), monthRow('9902', 'Hillview')] })
    await reads.stores(ctx)
    expect(asked.map(a => (a as unknown[])[0])).toEqual([MONTH_DATASET])
  })

  it('offers every store promptly, never by its plant code, when the names stall (#4531)', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const { ctx } = context({ places: TWO, monthStalls: true })
    let options: unknown
    reads.stores(ctx).then(o => { options = o })
    await vi.advanceTimersByTimeAsync(STORE_NAMES_TIMEOUT_MS)
    expect(options).toEqual([{ value: '9901', label: 'Store 1' }, { value: '9902', label: 'Store 2' }])
  })

  it('offers every store by its place in the list, never its plant code, when the names fail (#4531)', async () => {
    const { ctx } = context({ places: TWO, monthThrows: true })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Store 1' }, { value: '9902', label: 'Store 2' }])
  })

  it("names a store from the month's metadata, so a reader with no cached figures sees the same label", async () => {
    const month = [{ store_code: '9901', store_name: 'Lakeside', subcategory_code: '010101001', period_start: '2026-10-01', data_through: '2026-10-14', targets_available: true }]
    const { ctx } = context({ rows: [], month })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Lakeside' }])
  })

  it('offers a lone store as "Your store", never its plant code, while nothing is cached (#4531)', async () => {
    const { ctx } = context({ rows: null })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Your store' }])
  })

  // #4531: two of a reader's stores with one name are told apart by their short codes, never their plant codes.
  const shortRow = (store: string, short: string | null): SalesRow => ({ ...row(store, '010101001', 'Lakeside'), short_code: short })
  it('tells two stores of one name apart by their short codes', async () => {
    const { ctx } = context({ places: TWO, month: [monthRow('9901', 'Lakeside'), monthRow('9902', 'Lakeside')],
      rows: [shortRow('9901', 'LKN'), shortRow('9902', 'LKS')] })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Lakeside · LKN' }, { value: '9902', label: 'Lakeside · LKS' }])
  })

  it('numbers two stores of one name when their short codes are not known', async () => {
    const { ctx } = context({ places: TWO, month: [monthRow('9901', 'Lakeside'), monthRow('9902', 'Lakeside')], rows: [] })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Lakeside (1)' }, { value: '9902', label: 'Lakeside (2)' }])
  })

  it('names a store with no name by its short code', async () => {
    const { ctx } = context({ places: TWO, month: [monthRow('9902', 'Hillview')], rows: [shortRow('9901', 'LKS')] })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'LKS' }, { value: '9902', label: 'Hillview' }])
  })

  it('keeps every store when the cached figures fail while telling stores apart', async () => {
    const { ctx } = context({ places: TWO, month: [monthRow('9901', 'Lakeside'), monthRow('9902', 'Lakeside')], cacheThrows: true })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Lakeside (1)' }, { value: '9902', label: 'Lakeside (2)' }])
  })
})

describe('the report read', () => {
  it("answers the chosen store's report", async () => {
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', store: '9901', rows: [{ code: '010101001', section: 'Sarees' }] })
  })

  it("answers the reader's first store when none is chosen", async () => {
    const { ctx } = context({ places: [place('9902', '9902'), place('9901', '9901')] })
    expect((await reads.report(ctx)).store).toBe('9901')
  })

  it('reads only the chosen store from the cached dataset', async () => {
    const { ctx, asked } = context({ payload: { store: '9901' } })
    await reads.report(ctx)
    expect(asked).toEqual([[SALES_DATASET, { store_code: '9901' }], [MONTH_DATASET, { store_code: '9901' }]])
  })

  it("refuses a store that is not one of the reader's", async () => {
    const { ctx } = context({ payload: { store: '9909' } })
    await expect(reads.report(ctx)).rejects.toThrow(/not one of your stores/)
  })

  it("answers a quiet section as ready from the month's metadata, the Dive allowed", async () => {
    const month = [{ store_code: '9901', subcategory_code: '010101001', period_start: '2026-10-01', data_through: '2026-10-14', targets_available: true }]
    const { ctx } = context({ payload: { store: '9901' }, rows: [], month })
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', rows: [{ code: '010101001', target: 0, actual: 0, targetRecorded: false, salesRecorded: false }] })
  })

  it('records who viewed the report', async () => {
    const { ctx, views } = context({ payload: { store: '9901' } })
    await reads.report(ctx)
    expect(views).toEqual([{ dataset: SALES_DATASET }])
  })
})

describe('the embed_session read', () => {
  function upstream(answer: () => Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = []
    setEmbedFetch(async (url, init) => { calls.push({ url: String(url), init: init! }); return answer() })
    return calls
  }
  const ok = () => Promise.resolve(new Response(JSON.stringify({ session: 'session-made-up' }), { status: 200 }))

  it("answers the Dive's frame address, carrying the new session", async () => {
    upstream(ok)
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await reads.embed_session(ctx)).toEqual({ frame: 'https://embed-motherduck.com/sandbox/#session=session-made-up' })
  })

  it("asks MotherDuck for a session of the configured Dive, as its service account, with the reader's state", async () => {
    const calls = upstream(ok)
    const { ctx } = context({ payload: { store: '9901' } })
    await reads.embed_session(ctx)
    const body = JSON.parse(String(calls[0].init.body))
    expect([calls[0].url, (calls[0].init.headers as Record<string, string>).authorization, body.username, body.version, body.initial_state.plant_code])
      .toEqual(['https://api.motherduck.com/v1/dives/dive-made-up/embed-session', 'Bearer token-made-up', 'svc-made-up', 7, '9901'])
  })

  it('puts the cached rows into the Dive\'s state under `cached`', async () => {
    const calls = upstream(ok)
    const { ctx } = context({ payload: { store: '9901' } })
    await reads.embed_session(ctx)
    expect(JSON.parse(String(calls[0].init.body)).initial_state.cached).toMatchObject({ refreshed_at: AT, rows: [{ hierarchy_code: '010101001' }] })
  })

  it("asks the page to wait for the Dive's ready message when the instance turns the signal on", async () => {
    upstream(ok)
    const { ctx } = context({ payload: { store: '9901' }, settings: { ...DIVE, dive_ready_signal: 'on' } })
    expect(await reads.embed_session(ctx)).toEqual({ frame: 'https://embed-motherduck.com/sandbox/#session=session-made-up', ready_signal: true })
  })

  it('says the Dive is not set up when a Dive setting is missing, and calls nothing', async () => {
    const calls = upstream(ok)
    const { ctx } = context({ payload: { store: '9901' }, settings: { dive_id: 'dive-made-up' } })
    expect([await reads.embed_session(ctx), calls.length]).toEqual([{ not_set_up: true }, 0])
  })

  it('says the Dive is unreachable when MotherDuck refuses the session', async () => {
    upstream(() => Promise.resolve(new Response('{"message":"nope"}', { status: 503 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await reads.embed_session(ctx)).toEqual({ unreachable: true })
  })

  it('says the Dive is unreachable when MotherDuck cannot be reached', async () => {
    upstream(() => Promise.reject(new TypeError('fetch failed')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await reads.embed_session(ctx)).toEqual({ unreachable: true })
  })

  it('never writes the token into what it logs', async () => {
    upstream(() => Promise.resolve(new Response('{"message":"bad token token-made-up"}', { status: 401 })))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = context({ payload: { store: '9901' } })
    await reads.embed_session(ctx)
    expect(JSON.stringify(logged.mock.calls)).not.toContain('token-made-up')
  })

  it('gives up on a MotherDuck that never answers, after its own timeout', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-10-15T06:00:00Z'))
    // Hangs for good unless the read aborts it.
    setEmbedFetch((_url, init) => new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = context({ payload: { store: '9901' } })
    let settled: unknown = 'pending'
    reads.embed_session(ctx).then(a => { settled = a })
    await vi.advanceTimersByTimeAsync(EMBED_API_TIMEOUT_MS ?? 10_000)
    expect(settled).toEqual({ unreachable: true })
  })

  it("refuses a store that is not one of the reader's", async () => {
    upstream(ok)
    const { ctx } = context({ payload: { store: '9909' } })
    await expect(reads.embed_session(ctx)).rejects.toThrow(/not one of your stores/)
  })

  it('opens the Dive without a cache while nothing is cached', async () => {
    const calls = upstream(ok)
    const { ctx } = context({ payload: { store: '9901' }, rows: null })
    await reads.embed_session(ctx)
    expect(JSON.parse(String(calls[0].init.body)).initial_state.cached).toBeUndefined()
  })

  it('records who opened the report', async () => {
    upstream(ok)
    const { ctx, views } = context({ payload: { store: '9901' } })
    await reads.embed_session(ctx)
    expect(views).toEqual([{ dataset: SALES_DATASET }])
  })

  describe("a whole-store reader's Dive, whatever the cache", () => {
    const manager = [place('9901', '9901'), place('9901 / Section: Sarees', '9901', ['010101001'])]
    const warehouse = [row('9901', '010101001'), row('9901', '010909001')]
    const state = async (options: Options) => {
      const calls = upstream(ok)
      await reads.embed_session(context({ payload: { store: '9901' }, ...options }).ctx)
      return JSON.parse(String(calls[0].init.body)).initial_state
    }

    it('names the whole store, so the Dive filters on the store alone', async () => {
      expect((await state({ places: manager })).whole_store).toBe(true)
    })

    it('still lists an unplaced subcategory with sales when nothing is cached', async () => {
      expect((await state({ places: manager, rows: null, live: warehouse })).material_groups).toEqual(['010101001', '010909001'])
    })

    it('still lists an unplaced subcategory with sales when the cache read throws', async () => {
      expect((await state({ places: manager, cacheThrows: true, live: warehouse })).material_groups).toEqual(['010101001', '010909001'])
    })

    it("still lists an unplaced subcategory when the cache is last month's", async () => {
      const lastMonth = warehouse.map(r => ({ ...r, period_start: '2026-09-01', data_through: '2026-09-30' }))
      expect((await state({ places: manager, rows: lastMonth })).material_groups).toEqual(['010101001', '010909001'])
    })

    it("never widens a section-scoped reader's Dive", async () => {
      const s = await state({ rows: null, live: warehouse })
      expect([s.whole_store, s.material_groups]).toEqual([false, ['010101001']])
    })
  })
})

// #4486: the page's header says why the reader sees the store on show.
describe("the report read's heading", () => {
  const based = (label: string, store: string, subcategory: string[] | undefined, basis: string): Place =>
    ({ ...place(label, store, subcategory), basis })
  const PLACES = [based('9901 / Section: Sarees', '9901', ['010101001'], 'team_leader'), based('9902', '9902', undefined, 'store_manager')]

  it("answers the chosen store's reasons and sections, named by the cached rows", async () => {
    const { ctx } = context({ places: PLACES, payload: { store: '9901' } })
    expect((await reads.report(ctx)).heading).toEqual({ name: 'Lakeside', sections: ['Sarees'], reasons: [{ basis: 'team_leader', sections: ['Sarees'] }] })
  })

  it("names the store from the month's metadata when the reader has no row of figures", async () => {
    const monthRow = { store_code: '9902', store_name: 'Hillview', subcategory_code: '010404001', period_start: '2026-10-01', data_through: '2026-10-14', targets_available: true }
    const { ctx } = context({ places: PLACES, payload: { store: '9902' }, rows: [], month: [monthRow] })
    expect((await reads.report(ctx)).heading).toEqual({ name: 'Hillview', sections: [], reasons: [{ basis: 'store_manager', sections: [] }] })
  })

  it('still answers the heading while nothing is cached yet (the figures are being prepared)', async () => {
    const { ctx } = context({ places: PLACES, payload: { store: '9901' }, rows: null })
    const report = await reads.report(ctx)
    expect([report.state, report.heading]).toEqual(['not_built', { name: null, sections: ['Sarees'], reasons: [{ basis: 'team_leader', sections: ['Sarees'] }] }])
  })
})
