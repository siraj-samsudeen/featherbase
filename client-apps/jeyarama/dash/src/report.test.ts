// The report's own rules, over made-up places and dataset rows: which stores a
// reader has, what one store's scope is, and the report built from the cached
// rows. Made-up stores 9901 and 9902; no real figure.
import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { CACHE_BUDGET_BYTES, buildReport, headingOf, initialState, periodOf, scopeIn, storeShortName, storesOf, type CachedAnswer, type InitialState, type Report, type SalesRow } from './report.ts'
import { gzipBase64 } from './compress.ts'
import type { Place } from './provider.ts'

const place = (label: string, store: string, subcategory?: string[]): Place =>
  ({ label, filters: subcategory ? { store: [store], subcategory } : { store: [store] } })
const TODAY = '2026-10-15'
const AT = '2026-10-15T00:19:00.000Z'

function row(code: string, values: Partial<SalesRow> = {}): SalesRow {
  return { store_code: '9901', store_name: 'Lakeside', short_code: 'LKS', subcategory_code: code, subcategory: `Name ${code}`,
    target: 1000, actual: 800, days_with_actual: 14, days: 15, period_start: '2026-10-01', data_through: '2026-10-14',
    targets_available: true, target_days: 15, target_quantity: 10, actual_quantity: 8, ...values }
}

describe("a reader's stores", () => {
  it('are every store their places name, once each, by plant code', () => {
    expect(storesOf([place('9902 / Section: Belts', '9902', ['010404001']), place('9901', '9901'), place('9901 / Section: Sarees', '9901', ['010101001'])]))
      .toEqual(['9901', '9902'])
  })
})

describe("a reader's scope in one store", () => {
  it('is the whole store when a place names the store alone', () => {
    expect(scopeIn([place('9901', '9901'), place('9901 / Section: Sarees', '9901', ['010101001'])], '9901').wholeStore).toBe(true)
  })

  it("is the subcategories of the store's places otherwise", () => {
    const scope = scopeIn([place('9901 / Section: Sarees', '9901', ['010101001', '010303001']), place('9902 / Section: Belts', '9902', ['010404001'])], '9901')
    expect([scope.wholeStore, scope.codes]).toEqual([false, ['010101001', '010303001']])
  })

  it("reads each subcategory's section from the label of the section's place", () => {
    const scope = scopeIn([place('9901', '9901'), place('9901 / Section: Sarees', '9901', ['010101001']), place('9901 / Section: Tops', '9901', ['010303002'])], '9901')
    expect(scope.sectionOf).toEqual({ '010101001': 'Sarees', '010303002': 'Tops' })
  })
})

describe('the period', () => {
  it('is the month to date', () => {
    expect(periodOf('2026-10-15')).toEqual({ period_start: '2026-10-01', period_end: '2026-10-15' })
  })
})

describe('the report for one store', () => {
  const sarees = [place('9901 / Section: Sarees', '9901', ['010101001', '010303001'])]

  it('says the figures are being prepared when nothing is cached yet', () => {
    expect(buildReport({ store: '9901', places: sarees, answer: null, today: TODAY }).state).toBe('not_built')
  })

  it("says the month's figures haven't arrived when the cached copy is of an earlier month", () => {
    const rows = [row('010101001', { period_start: '2026-09-01', data_through: '2026-09-30' })]
    expect(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows }, today: TODAY }).state).toBe('no_data_yet')
  })

  it("says the month's figures haven't arrived when the warehouse has no day of the month yet", () => {
    const rows = [row('010101001', { data_through: '2026-09-30' })]
    expect(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows }, today: TODAY }).state).toBe('no_data_yet')
  })

  it("doesn't claim ready for an empty scope when no metadata is known", () => {
    expect(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [] }, today: TODAY }).state).toBe('unconfirmed')
  })

  // The month's metadata (`sales_month`) refreshes apart from the figures (`sales_to_date`), so
  // it only speaks for an EMPTY scoped result, and only when it is compatible with the figures'
  // snapshot (#4444 review, round 3): of this month, and no older than that snapshot. The
  // reader's own rows always set the period, the cutoff and the targets.
  const LATER = '2026-10-15T00:40:00.000Z'
  const arrived = { period_start: '2026-10-01', data_through: '2026-10-14', targets_available: true, at: LATER }

  it('shows a quiet section as ready when compatible metadata says the month has arrived', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [] }, month: arrived, today: TODAY })
    expect([report.state, report.rows.map(r => [r.code, r.target, r.actual])]).toEqual(['ready', [['010101001', 0, 0], ['010303001', 0, 0]]])
  })

  it("says the month's figures haven't arrived when compatible metadata has no day of actuals", () => {
    const month = { ...arrived, data_through: '2026-09-30' }
    expect(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [] }, month, today: TODAY }).state).toBe('no_data_yet')
  })

  it("keeps this month's figures ready while the metadata's refresh failed and it is still last month's", () => {
    const month = { period_start: '2026-09-01', data_through: '2026-09-30', targets_available: true, at: '2026-09-30T00:19:00.000Z' }
    expect(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001')] }, month, today: TODAY }).state).toBe('ready')
  })

  it('keeps figures activated just after midnight IST on the 1st ready while the metadata is still the previous month\'s', () => {
    const nov = row('010101001', { period_start: '2026-11-01', data_through: '2026-11-01' })
    const month = { period_start: '2026-10-01', data_through: '2026-10-31', targets_available: true, at: '2026-10-31T00:19:00.000Z' }
    const report = buildReport({ store: '9901', places: sarees, answer: { at: '2026-10-31T18:40:00.000Z', rows: [nov] }, month, today: '2026-11-01' })
    expect(report.state).toBe('ready')
  })

  it("never relabels the figures with a newer metadata's later day: the figures' own rows set it", () => {
    const month = { ...arrived, data_through: '2026-10-15' }
    expect(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001')] }, month, today: TODAY }).data_through).toBe('2026-10-14')
  })

  it("doesn't claim ready for an empty scope when the metadata is an earlier month's", () => {
    const month = { period_start: '2026-09-01', data_through: '2026-09-30', targets_available: true, at: LATER }
    expect(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [] }, month, today: TODAY }).state).toBe('unconfirmed')
  })

  it("doesn't claim ready for an empty scope when the metadata is older than the figures' snapshot", () => {
    const month = { ...arrived, at: '2026-10-14T00:19:00.000Z' }
    expect(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [] }, month, today: TODAY }).state).toBe('unconfirmed')
  })

  it("says the figures haven't arrived for an empty scope when the figures' snapshot is from before this month", () => {
    const month = { ...arrived, at: '2026-10-15T00:40:00.000Z' }
    expect(buildReport({ store: '9901', places: sarees, answer: { at: '2026-09-30T00:19:00.000Z', rows: [] }, month, today: TODAY }).state).toBe('no_data_yet')
  })

  it('says the store has no sections yet when a whole-store reader has no section place in it', () => {
    expect(buildReport({ store: '9901', places: [place('9901', '9901')], answer: { at: AT, rows: [row('010101001')] }, today: TODAY }).state).toBe('no_sections')
  })

  it('shows each row with its gap and achievement', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001')] }, today: TODAY })
    expect(report.rows[0]).toMatchObject({ code: '010101001', subcategory: 'Name 010101001', section: 'Sarees', target: 1000, actual: 800, gap: -200, achievement: 80 })
  })

  // Parity first: the figures are the old report's (a target that wasn't set is ₹0 in every sum,
  // a subcategory that neither had a target nor sold is ₹0 / ₹0). Whether a value was recorded
  // is carried beside it, for the page's display rule ("—" for nothing recorded).
  it('computes a listed subcategory with no row as ₹0 target and ₹0 sales, as the old report did', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001')] }, today: TODAY })
    expect(report.rows.find(r => r.code === '010303001')).toMatchObject({ subcategory: null, target: 0, actual: 0, noTargetNoSale: true, missingActual: false })
  })

  it('marks a listed subcategory with no row as having neither a target nor sales recorded', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001')] }, today: TODAY })
    expect(report.rows.find(r => r.code === '010303001')).toMatchObject({ targetRecorded: false, salesRecorded: false })
  })

  it('shows a target with no day of actuals as missing, never as zero', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001', { actual: null, days_with_actual: 0 })] }, today: TODAY })
    expect(report.rows[0]).toMatchObject({ actual: null, gap: null, missingActual: true })
  })

  it('computes a sale with no target against a ₹0 target, as the old report did', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001', { target: null })] }, today: TODAY })
    expect(report.rows[0]).toMatchObject({ target: 0, actual: 800, gap: 800, achievement: null, targetRecorded: false, salesRecorded: true })
  })

  it('marks a recorded zero target as recorded', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001', { target: 0 })] }, today: TODAY })
    expect(report.rows[0]).toMatchObject({ target: 0, gap: 800, targetRecorded: true })
  })

  it('totals over every row, a sale with no target included, as the old report did', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001', { target: null })] }, today: TODAY })
    expect(report.total).toMatchObject({ target: 0, actual: 800, gap: 800 })
  })

  it('shows no target at all when the warehouse has no targets for the month', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001', { target: null, targets_available: false })] }, today: TODAY })
    expect([report.targets_available, report.rows[0].target]).toEqual([false, null])
  })

  it('orders rows by section, sections A to Z and rows outside a section last', () => {
    const places = [place('9901', '9901'), place('9901 / Section: Tops', '9901', ['010303002']), place('9901 / Section: Ethnic', '9901', ['010101001'])]
    const rows = [row('010101001'), row('010202001'), row('010303002')]
    const report = buildReport({ store: '9901', places, answer: { at: AT, rows }, today: TODAY })
    expect(report.rows.map(r => [r.section, r.code])).toEqual([['Ethnic', '010101001'], ['Tops', '010303002'], [null, '010202001']])
  })

  it('totals each section and the store', () => {
    const places = [place('9901 / Section: Sarees', '9901', ['010101001', '010303001'])]
    const rows = [row('010101001'), row('010303001', { target: 500, actual: 600 })]
    const report = buildReport({ store: '9901', places, answer: { at: AT, rows }, today: TODAY })
    expect(report.sections).toMatchObject([{ section: 'Sarees', target: 1500, actual: 1400, gap: -100, n: 2 }])
    expect(report.total).toMatchObject({ target: 1500, actual: 1400, gap: -100, n: 2 })
  })

  it('carries the store name, the refresh time and the day the data runs to', () => {
    const report = buildReport({ store: '9901', places: sarees, answer: { at: AT, rows: [row('010101001')] }, today: TODAY })
    expect(report).toMatchObject({ store: '9901', store_name: 'Lakeside', refreshed_at: AT, data_through: '2026-10-14', period_start: '2026-10-01' })
  })
})

describe("the Dive's initial state", () => {
  const sarees = [place('9901 / Section: Sarees', '9901', ['010101001', '010303001'])]
  const answer = { at: AT, rows: [row('010101001')] }
  const report = buildReport({ store: '9901', places: sarees, answer, today: TODAY })
  // The default is the legacy shape: the server asks for the compact one only for a pinned Dive
  // known to read it (`stateFormat`, #4453).
  const state = (r: Report, a: CachedAnswer, places: Place[]) => initialState(r, a, places, TODAY, { compress: gzipBase64 })
  const compact = (r: Report, a: CachedAnswer, places: Place[]) => initialState(r, a, places, TODAY, { compress: gzipBase64, format: 'compact' })

  it("carries a section reader's store, subcategories, sections and period, as the Dive reads them", () => {
    const { cached: _cached, ...rest } = state(report, answer, sarees)
    expect(rest).toEqual({ plant_code: '9901', whole_store: false, material_groups: ['010101001', '010303001'],
      section_by_material_group: { '010101001': 'Sarees', '010303001': 'Sarees' }, period_start: '2026-10-01', period_end: '2026-10-15' })
  })

  const places = [place('9901', '9901'), place('9901 / Section: Sarees', '9901', ['010101001', '010101003']),
    place('9901 / Section: Belts', '9901', ['010404001'])]
  const all = { at: AT, rows: [row('010101001'), row('010909001')] }
  const whole = buildReport({ store: '9901', places, answer: all, today: TODAY })

  describe('for a whole-store reader, in the compact shape', () => {
    it('sends no material_groups: the Dive filters on the store alone', () => {
      expect(compact(whole, all, places)).not.toHaveProperty('material_groups')
    })

    it('sends no section_by_material_group', () => {
      expect(compact(whole, all, places)).not.toHaveProperty('section_by_material_group')
    })

    it("sends each section's subcategory codes as numbers, ascending, each after the first as a step from the one before", () => {
      expect(compact(whole, all, places).sections).toEqual({ Belts: [10404001], Sarees: [10101001, 2] })
    })
  })

  // The legacy shape is 0.8.0's: a Dive that predates v12 reads a missing material_groups as
  // "every store", so it is never left out unless the instance says the Dive reads the compact one.
  describe('for a whole-store reader, in the legacy shape (the default)', () => {
    it("lists every subcategory of the store the reader's places and the cache know, as 0.8.0 did", () => {
      expect(state(whole, all, places).material_groups).toEqual(['010101001', '010101003', '010404001', '010909001'])
    })

    it('adds the subcategories the warehouse names when nothing is cached', () => {
      const none = buildReport({ store: '9901', places, answer: null, today: TODAY })
      expect(initialState(none, null, places, TODAY, { compress: gzipBase64, storeCodes: ['010909001'] }).material_groups)
        .toEqual(['010101001', '010101003', '010404001', '010909001'])
    })

    it('sends section_by_material_group', () => {
      expect(state(whole, all, places).section_by_material_group).toEqual({ '010101001': 'Sarees', '010101003': 'Sarees', '010404001': 'Belts' })
    })

    it('sends no compact section map', () => {
      expect(state(whole, all, places)).not.toHaveProperty('sections')
    })

    it('still names the whole store', () => {
      expect(state(whole, all, places).whole_store).toBe(true)
    })

    it('still carries the cache, on the same ladder', () => {
      expect(state(whole, all, places).cached).toMatchObject({ v: 1, q: true, cols: { c: [10101001, 808000] } })
    })
  })

  it("gives a section reader the same scope keys in either shape", () => {
    const { cached: _a, ...legacy } = state(report, answer, sarees)
    const { cached: _b, ...compacted } = compact(report, answer, sarees)
    expect(compacted).toEqual(legacy)
  })

  it('never gives a section reader the compact section map', () => {
    expect(compact(report, answer, sarees)).not.toHaveProperty('sections')
  })

  it('carries the cached month to date column by column, with its refresh time', () => {
    expect(state(report, answer, sarees).cached).toEqual({ v: 1, refreshed_at: AT, data_through: '2026-10-14', q: true,
      cols: { c: [10101001], n: ['Name 010101001'], t: [100000], a: [80000], tq: [10000], aq: [8000] } })
  })

  it('carries money as whole paise, so no figure drifts on its way through JSON', () => {
    const odd = { at: AT, rows: [row('010101001', { target: 0.29, actual: 1234567.89 })] }
    const cols = state(buildReport({ store: '9901', places: sarees, answer: odd, today: TODAY }), odd, sarees).cached?.cols
    expect([cols?.t, cols?.a]).toEqual([[29], [123456789]])
  })

  it('carries quantities as whole thousandths', () => {
    const odd = { at: AT, rows: [row('010101001', { target_quantity: 2.5, actual_quantity: 0.007 })] }
    const cols = state(buildReport({ store: '9901', places: sarees, answer: odd, today: TODAY }), odd, sarees).cached?.cols
    expect([cols?.tq, cols?.aq]).toEqual([[2500], [7]])
  })

  it('keeps a value the warehouse does not have as null', () => {
    const gaps = { at: AT, rows: [row('010101001', { target: null, actual: null, subcategory: null })] }
    const cols = state(buildReport({ store: '9901', places: sarees, answer: gaps, today: TODAY }), gaps, sarees).cached?.cols
    expect([cols?.n, cols?.t, cols?.a]).toEqual([[null], [null], [null]])
  })

  it('leaves out the subcategories with no day this month, which the Dive never lists', () => {
    const rows = [row('010101001'), row('010303001', { days: 0, days_with_actual: 0, target: null, actual: null })]
    const cols = state(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows }, today: TODAY }), { at: AT, rows }, sarees).cached?.cols
    expect(cols?.c).toEqual([10101001])
  })

  it("never puts a row outside a section reader's subcategories in their cache", () => {
    const rows = [row('010101001'), row('010909001')]
    const cols = state(buildReport({ store: '9901', places: sarees, answer: { at: AT, rows }, today: TODAY }), { at: AT, rows }, sarees).cached?.cols
    expect(cols?.c).toEqual([10101001])
  })

  it('sends no cache when the cached copy is not of this month', () => {
    const old = { at: AT, rows: [row('010101001', { period_start: '2026-09-01' })] }
    const stale = buildReport({ store: '9901', places: sarees, answer: old, today: TODAY })
    expect(state(stale, old, sarees).cached).toBeUndefined()
  })
})

// The 56 KB budget at real scale, with made-up data shaped like the warehouse's: 31 stores of
// about 1,514 subcategories, nine-digit codes in clusters, names of two to four words, paise and
// fractional quantities. Seeded, so every run measures the same bytes.
describe("the Dive's cache at real scale", () => {
  /** mulberry32: a small seeded generator with a full-length cycle. */
  function seeded(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const random = seeded(4453)
  const words = Array.from({ length: 500 }, () => {
    const length = 3 + Math.floor(random() * 7)
    const word = Array.from({ length }, () => String.fromCharCode(97 + Math.floor(random() * 26))).join('')
    return word[0].toUpperCase() + word.slice(1)
  })
  const sectionNames = Array.from({ length: 40 }, (_, i) => `Section ${words[i]}`)
  /** One store's dataset rows and its sections: `n` subcategories. */
  function store(code: string, n: number) {
    let next = 10101000
    const rows = Array.from({ length: n }, () => {
      next += 1 + Math.floor(random() * random() * 40)
      const target = Math.round(Math.exp(random() * 6 + 10)) / 100
      const quantity = Math.round(random() * random() * 2_000_000) / 1000
      return row(String(next).padStart(9, '0'), { store_code: code, target, actual: Math.round(target * (50 + random() * 100)) / 100,
        target_quantity: quantity, actual_quantity: Math.round(quantity * (500 + random() * 1000)) / 1000,
        subcategory: Array.from({ length: 2 + Math.floor(random() * 3) }, () => words[Math.floor(random() * words.length)]).join(' '),
        days_with_actual: 27, days: 28 })
    })
    const sections = sectionNames.map((name, k) => place(`${code} / Section: ${name}`, code,
      rows.filter((_, i) => i % sectionNames.length === k).map(r => r.subcategory_code)))
    return { rows, sections }
  }
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
  const rungOf = (s: InitialState) => !s.cached ? 'none' : `${s.cached.cols ? 'plain' : 'compressed'}${s.cached.q ? ' with quantities' : ' value-only'}`
  const wholeStore = (code: string, n: number) => {
    const { rows, sections } = store(code, n)
    const places = [place(code, code), ...sections]
    const answer = { at: AT, rows }
    return { rows, state: initialState(buildReport({ store: code, places, answer, today: TODAY }), answer, places, TODAY, { compress: gzipBase64, format: 'compact' }) }
  }
  const sectionReader = (code: string, n: number) => {
    const { rows, sections } = store(code, n)
    const answer = { at: AT, rows: rows.filter(r => sections[0].filters.subcategory!.includes(r.subcategory_code)) }
    return initialState(buildReport({ store: code, places: [sections[0]], answer, today: TODAY }), answer, [sections[0]], TODAY, { compress: gzipBase64, format: 'compact' })
  }
  /** The cache as the Dive reads it back: the columns, unzipped when compressed. */
  const columns = (s: InitialState) => s.cached?.cols ?? JSON.parse(gunzipSync(Buffer.from(s.cached!.z!, 'base64')).toString('utf8'))

  const stores = Array.from({ length: 31 }, (_, i) => [String(1501 + i), 1300 + Math.floor(seeded(i + 1)() * 400)] as const)

  // Names of random letters compress worse than real ones, so these sizes are pessimistic.
  it.each(stores)("gives the whole-store reader of store %s (%i subcategories) a cached view, within 56 KB", (code, n) => {
    const { state: s } = wholeStore(code, n)
    expect([rungOf(s).startsWith('compressed'), bytes(s) <= CACHE_BUDGET_BYTES]).toEqual([true, true])
  })

  it.each([
    [40, 'plain with quantities'], [1200, 'compressed with quantities'], [1514, 'compressed with quantities'],
    [2000, 'compressed value-only'], [6000, 'none'],
  ] as const)('picks the first rung that fits for a whole-store reader of %i subcategories: %s, within 56 KB', (n, rung) => {
    const { state: s } = wholeStore('1599', n)
    expect([rungOf(s), bytes(s) <= CACHE_BUDGET_BYTES]).toEqual([rung, true])
  })

  // The legacy shape at the same scale: the full list stays, so the cache usually does not fit.
  it("keeps every subcategory in a large store's legacy material_groups", () => {
    const { rows, sections } = store('1505', 1514)
    const places = [place('1505', '1505'), ...sections]
    const answer = { at: AT, rows }
    const s = initialState(buildReport({ store: '1505', places, answer, today: TODAY }), answer, places, TODAY, { compress: gzipBase64 })
    expect([s.material_groups?.length, rungOf(s)]).toEqual([1514, 'none'])
  })

  it('keeps every row of a large store in its compressed cache', () => {
    const { rows, state: s } = wholeStore('1501', 1514)
    expect(columns(s).c.length).toBe(rows.length)
  })

  it('reads back every code of a large store exactly', () => {
    const { rows, state: s } = wholeStore('1501', 1514)
    const codes: number[] = columns(s).c
    const back = codes.map((step, i) => codes.slice(0, i + 1).reduce((a, b) => a + b, 0))
    expect(back.map(code => String(code).padStart(9, '0'))).toEqual(rows.map(r => r.subcategory_code))
  })

  it('reads back every target and actual of a large store to the paisa', () => {
    const { rows, state: s } = wholeStore('1501', 1514)
    const cols = columns(s)
    expect([cols.t.map((p: number) => p / 100), cols.a.map((p: number) => p / 100)]).toEqual([rows.map(r => r.target), rows.map(r => r.actual)])
  })

  it('gives a section reader of a large store a plain cache with quantities, within 56 KB', () => {
    const s = sectionReader('1502', 1514)
    expect([rungOf(s), bytes(s) <= CACHE_BUDGET_BYTES]).toEqual(['plain with quantities', true])
  })
})

describe('the quick view totals', () => {
  it('equal the sum of the rows as they are shown, to the paisa', async () => {
    const { inr } = await import('./page.ts')
    const places = [place('9901 / Section: Sarees', '9901', ['010101001', '010101002'])]
    const rows = [row('010101001', { target: 10.49, actual: 10.51 }), row('010101002', { target: 0.25, actual: 0.26 })]
    const report = buildReport({ store: '9901', places, answer: { at: AT, rows }, today: TODAY })
    const shownSum = (pick: (r: (typeof report.rows)[number]) => number | null) =>
      inr(report.rows.reduce((a, r) => a + Math.round((pick(r) ?? 0) * 100), 0) / 100)
    expect([inr(report.total.target), inr(report.total.actual), inr(report.total.gap)])
      .toEqual([shownSum(r => r.target), shownSum(r => r.actual), shownSum(r => r.gap)])
  })
})

describe('what each total recorded (for the display rule only)', () => {
  it('counts the rows that recorded a target and the rows that recorded sales, beside the old sums', () => {
    const places = [place('9901 / Section: Sarees', '9901', ['010101001', '010101002', '010303001'])]
    const rows = [row('010101001'), row('010101002', { target: null }), row('010303001', { actual: null, days_with_actual: 0 })]
    const report = buildReport({ store: '9901', places, answer: { at: AT, rows }, today: TODAY })
    expect(report.total).toMatchObject({ target: 2000, targets_recorded: 2, sales_recorded: 2 })
  })
})

// #4486: what the page's header needs to say why the reader sees the store.
describe("a store's heading", () => {
  const based = (label: string, store: string, subcategory: string[] | undefined, basis: string): Place => ({ ...place(label, store, subcategory), basis })

  it("gives each basis on the store's places with the sections those places name", () => {
    const places = [
      based('9901 / Section: Sarees', '9901', ['010101001'], 'team_leader'),
      based('9901 / Section: Tops', '9901', ['010303002'], 'section_staff, team_leader'),
      based('9901 / Section: Kids', '9901', ['010202001'], 'section_staff'),
    ]
    expect(headingOf(places, '9901', 'LKS')).toEqual({ name: 'LKS', sections: ['Kids', 'Sarees', 'Tops'], reasons: [
      { basis: 'section_staff', sections: ['Kids', 'Tops'] },
      { basis: 'team_leader', sections: ['Sarees', 'Tops'] },
    ] })
  })

  it("never carries another store's reasons or sections", () => {
    const places = [based('9901 / Section: Sarees', '9901', ['010101001'], 'team_leader'), based('9902', '9902', undefined, 'store_manager'),
      based('9902 / Section: Belts', '9902', ['010404001'], 'store_manager')]
    expect(headingOf(places, '9901', null)).toEqual({ name: null, sections: ['Sarees'], reasons: [{ basis: 'team_leader', sections: ['Sarees'] }] })
  })

  it("gives a whole-store place's basis with no section of its own", () => {
    const places = [based('9901', '9901', undefined, 'store_manager'), based('9901 / Section: Sarees', '9901', ['010101001'], 'store_manager')]
    expect(headingOf(places, '9901', 'LKS').reasons).toEqual([{ basis: 'store_manager', sections: ['Sarees'] }])
  })

  it('gives a basis whose places name no section (subcategories outside the map) with no sections', () => {
    expect(headingOf([based('9901', '9901', ['010909001'], 'assignment')], '9901', 'LKS'))
      .toEqual({ name: 'LKS', sections: [], reasons: [{ basis: 'assignment', sections: [] }] })
  })

  it('gives no reason for places that carry no basis', () => {
    expect(headingOf([place('9901 / Section: Sarees', '9901', ['010101001'])], '9901', 'LKS').reasons).toEqual([])
  })

  it("names the store by its short code, else its name, from the report or the month's metadata, never by its plant code", () => {
    expect([storeShortName({ short_code: 'LKS', store_name: 'Lakeside' }, null), storeShortName({ short_code: null, store_name: 'Lakeside' }, null),
      storeShortName({ short_code: null, store_name: null }, { store_name: 'Lakeside' }), storeShortName({ short_code: null, store_name: null }, null)])
      .toEqual(['LKS', 'Lakeside', 'Lakeside', null])
  })
})
