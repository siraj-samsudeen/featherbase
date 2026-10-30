// What the report page shows, decided from what its reads answered, and how it
// writes money, days and times. Made-up figures.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORE_NAMES_TIMEOUT_MS } from './server.ts'
import { noAccessHelp, MADE_UP_DATA_COMMAND, BAR_STORE_WAIT_MS, DIVE_READY_TIMEOUT_MS, MEASURE_LINE, headingTitle, periodLine, whyLine, REPORT_TIMEOUT_MS, STORE_CHECK_TIMEOUT_MS, TOTALS_NOTE, sectionHeading, totalCells, blankNote, signedInr, dataLine, firstStore, inr, quickBody, subcategoryLabel, subtotalLabel, istTime, pageView, percent, reportLoader, shortDay } from './page.ts'

describe('the page', () => {
  const report = (state: string) => ({ ok: true as const, value: { state } })
  const frame = { ok: true as const, value: { frame: 'https://embed-motherduck.com/sandbox/#session=s' } }

  it('opens the Dive when it can', () => {
    expect(pageView({ embed: frame, report: report('ready') })).toEqual({ kind: 'dive', src: 'https://embed-motherduck.com/sandbox/#session=s' })
  })

  it('says "Opening your report…" until the embed session answers', () => {
    expect(pageView({ embed: undefined, report: report('ready') })).toEqual({ kind: 'opening' })
  })

  it('shows the quick view when the Dive is not set up', () => {
    expect(pageView({ embed: { ok: true, value: { not_set_up: true } }, report: report('ready') })).toEqual({ kind: 'quick' })
  })

  it('shows the quick view when the Dive is unreachable', () => {
    expect(pageView({ embed: { ok: true, value: { unreachable: true } }, report: report('ready') })).toEqual({ kind: 'quick' })
  })

  it("shows the quick view, saying why, when the store's Dive state is too large to embed", () => {
    expect(pageView({ embed: { ok: true, value: { too_large: true } }, report: report('ready') })).toEqual({ kind: 'quick', why: 'too_large' })
  })

  it('shows the quick view when the embed session read fails', () => {
    expect(pageView({ embed: { ok: false, status: 502 }, report: report('ready') })).toEqual({ kind: 'quick' })
  })

  it('waits for the cached report before falling back to the quick view', () => {
    expect(pageView({ embed: { ok: true, value: { unreachable: true } }, report: undefined })).toEqual({ kind: 'opening' })
  })

  it("says the reader has no access when a read refuses them", () => {
    expect(pageView({ embed: { ok: false, status: 403 }, report: undefined })).toEqual({ kind: 'no_access' })
  })

  it('asks the reader to sign in when they are signed out', () => {
    expect(pageView({ embed: { ok: false, status: 401 }, report: undefined })).toEqual({ kind: 'signed_out' })
  })

  it("says why there is nothing to show before opening the Dive: the month's figures haven't arrived", () => {
    expect(pageView({ embed: frame, report: report('no_data_yet') })).toEqual({ kind: 'empty', why: 'no_data_yet' })
  })

  it('says why there is nothing to show before opening the Dive: the store has no sections yet', () => {
    expect(pageView({ embed: frame, report: report('no_sections') })).toEqual({ kind: 'empty', why: 'no_sections' })
  })

  it("opens the Dive when the month can't be confirmed for an empty scope: nothing is hidden needlessly", () => {
    expect(pageView({ embed: frame, report: report('unconfirmed') })).toMatchObject({ kind: 'dive' })
  })

  it("says the figures are being prepared when the month can't be confirmed and the Dive can't load", () => {
    expect(pageView({ embed: { ok: true, value: { not_set_up: true } }, report: report('unconfirmed') })).toEqual({ kind: 'empty', why: 'not_built' })
  })

  it('opens the Dive while nothing is cached yet: the Dive reads the warehouse itself', () => {
    expect(pageView({ embed: frame, report: report('not_built') })).toMatchObject({ kind: 'dive' })
  })

  it('says the figures are being prepared when the Dive cannot load and nothing is cached', () => {
    expect(pageView({ embed: { ok: true, value: { not_set_up: true } }, report: report('not_built') })).toEqual({ kind: 'empty', why: 'not_built' })
  })

  it("shows the plain message with Try again when the quick view can't load either", () => {
    expect(pageView({ embed: { ok: true, value: { unreachable: true } }, report: { ok: false, status: 500 } })).toEqual({ kind: 'failed' })
  })
})

describe("the Dive's frame", () => {
  afterEach(() => vi.useRealTimers())
  const frame = { ok: true as const, value: { frame: 'https://embed-motherduck.com/sandbox/#session=s' } }
  const ready = { ok: true as const, value: { state: 'ready' } }

  it('shows the quick view, labelled cached, once the frame has failed', () => {
    expect(pageView({ embed: frame, report: ready, frameFailed: true })).toEqual({ kind: 'quick' })
  })
})

describe('how the page writes', () => {
  // AGENTS.md "Amount display": figures that must foot (target, sales, gap, subtotals, totals)
  // show exactly two decimals, Indian-grouped.
  it('money as rupees with Indian grouping and exactly two decimals', () => {
    expect(inr(1234567.8)).toBe('₹12,34,567.80')
  })

  it('a gap that foots against the two figures it comes from', () => {
    expect([inr(10.49), inr(10.51), inr(10.51 - 10.49)]).toEqual(['₹10.49', '₹10.51', '₹0.02'])
  })

  it('the footnote for one subcategory with nothing recorded, in the singular', () => {
    expect(blankNote(1)).toBe('1 subcategory has no target or no sales recorded this month: “—” means nothing was recorded, never ₹0.00.')
  })

  it('the footnote for several subcategories with nothing recorded, in the plural', () => {
    expect(blankNote(3)).toBe('3 subcategories have no target or no sales recorded this month: “—” means nothing was recorded, never ₹0.00.')
  })

  it('a negative gap with a minus sign', () => {
    expect(inr(-2500)).toBe('−₹2,500.00')
  })

  it('a missing figure as a dash', () => {
    expect(inr(null)).toBe('—')
  })

  // Display parity with the old report's helpers (featherbase lib/inr.ts): achievement to one
  // decimal, a gap with its sign both ways.
  it('an achievement to one decimal, as the old report wrote it', () => {
    expect([percent(80.44), percent(80)]).toEqual(['80.4%', '80%'])
  })

  it('a gap above target with a plus sign, as the old report wrote it', () => {
    expect([signedInr(2500), signedInr(-2500), signedInr(0), signedInr(null)]).toEqual(['+₹2,500.00', '−₹2,500.00', '₹0.00', '—'])
  })

  it("explains that the totals take every sale and every target, as the old report's did", () => {
    expect(TOTALS_NOTE).toBe('Totals add every target and every sale in the table, including subcategories that have only one of them, so they can differ from the sum of the gaps shown.')
  })

  it('a day as DD-Mon-YYYY', () => {
    expect(shortDay('2026-10-05')).toBe('05-Oct-2026')
  })

  it('a time as HH:MM IST', () => {
    expect(istTime('2026-10-15T00:19:00.000Z')).toBe('05:49 IST')
  })

  it('the cached timestamp line', () => {
    expect(dataLine({ data_through: '2026-10-14', refreshed_at: '2026-10-15T00:19:00.000Z' })).toBe('Data to 14-Oct-2026 · refreshed 05:49 IST')
  })
})

describe('opening the report (the deadline covers the session request and the frame)', () => {
  afterEach(() => vi.useRealTimers())
  type Pending = { resolve: (v: unknown) => void }
  function reads() {
    const pending: Record<string, Pending[]> = { report: [], embed_session: [] }
    const read = (name: string) => new Promise(resolve => pending[name].push({ resolve }))
    return { pending, read }
  }
  const flush = () => vi.advanceTimersByTimeAsync(0)
  const READY = { state: 'ready' }
  const FRAME = { frame: 'https://embed-motherduck.com/sandbox/#session=s' }

  it('falls back to the quick view when the session request never answers', async () => {
    vi.useFakeTimers()
    const { pending, read } = reads()
    let view = pageView({ embed: undefined, report: undefined })
    const loader = reportLoader<{ state: string }>(read, state => { view = pageView(state) })
    loader.open('9901')
    pending.report[0].resolve(READY)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view).toEqual({ kind: 'quick' })
  })

  it('ignores a session that answers after the deadline', async () => {
    vi.useFakeTimers()
    const { pending, read } = reads()
    let view = pageView({ embed: undefined, report: undefined })
    const loader = reportLoader<{ state: string }>(read, state => { view = pageView(state) })
    loader.open('9901')
    pending.report[0].resolve(READY)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    pending.embed_session[0].resolve(FRAME)
    await flush()
    expect(view).toEqual({ kind: 'quick' })
  })

  it("ignores the previous store's session after the reader switches stores", async () => {
    vi.useFakeTimers()
    const { pending, read } = reads()
    let view = pageView({ embed: undefined, report: undefined })
    const loader = reportLoader<{ state: string }>(read, state => { view = pageView(state) })
    loader.open('9901')
    loader.open('9902')
    pending.report[1].resolve(READY)
    pending.embed_session[0].resolve(FRAME)
    await flush()
    expect(view).toEqual({ kind: 'opening' })
  })

  it('falls back to the quick view when the session answers but its frame never loads', async () => {
    vi.useFakeTimers()
    const { pending, read } = reads()
    let view = pageView({ embed: undefined, report: undefined })
    const loader = reportLoader<{ state: string }>(read, state => { view = pageView(state) })
    loader.open('9901')
    pending.report[0].resolve(READY)
    pending.embed_session[0].resolve(FRAME)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view).toEqual({ kind: 'quick' })
  })

  it('keeps the Dive once its frame has loaded within the deadline', async () => {
    vi.useFakeTimers()
    const { pending, read } = reads()
    let view = pageView({ embed: undefined, report: undefined })
    const loader = reportLoader<{ state: string }>(read, state => { view = pageView(state) })
    loader.open('9901')
    pending.report[0].resolve(READY)
    pending.embed_session[0].resolve(FRAME)
    await flush()
    loader.frameLoaded()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS * 2)
    expect(view).toMatchObject({ kind: 'dive' })
  })
})

describe('the store the page opens with (one call per read on each load)', () => {
  afterEach(() => vi.useRealTimers())
  function bar() {
    let announce: (store: string) => void = () => {}
    return { listen: (cb: (store: string) => void) => { announce = cb; return () => { announce = () => {} } }, choose: (s: string) => announce(s) }
  }

  it('opens at once with the store already in the address', () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    firstStore('9901', bar().listen, store => opened.push(store))
    expect(opened).toEqual(['9901'])
  })

  it("waits for the bar's choice instead of opening without a store", () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    const b = bar()
    firstStore(undefined, b.listen, store => opened.push(store))
    b.choose('9901')
    vi.advanceTimersByTime(BAR_STORE_WAIT_MS)
    expect(opened).toEqual(['9901'])
  })

  it('opens without a store when the bar offers none (a reader with no access)', () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    firstStore(undefined, bar().listen, store => opened.push(store))
    vi.advanceTimersByTime(BAR_STORE_WAIT_MS)
    expect(opened).toEqual([undefined])
  })
})

describe("the Dive's ready signal (required only when the instance's `dive_ready_signal` setting is on)", () => {
  afterEach(() => vi.useRealTimers())
  const SIGNALLED = { frame: 'https://embed-motherduck.com/sandbox/#session=s', ready_signal: true }
  const frameWindow = {}
  async function opened() {
    vi.useFakeTimers()
    const pending: Record<string, ((v: unknown) => void)[]> = { report: [], embed_session: [] }
    let view = pageView({ embed: undefined, report: undefined })
    let ready = false
    const loader = reportLoader<{ state: string }>(name => new Promise(resolve => pending[name].push(resolve)), state => {
      view = pageView(state)
      ready = state.diveReady
    })
    loader.open('9901')
    pending.report[0]({ state: 'ready' })
    pending.embed_session[0](SIGNALLED)
    await vi.advanceTimersByTimeAsync(0)
    loader.frameLoaded()
    return { loader, view: () => view, ready: () => ready }
  }

  it('keeps "Opening your report…" up after the frame loads, until the ready message', async () => {
    const { loader, ready } = await opened()
    const before = ready()
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'feather-dash:dive-ready' } }, frameWindow)
    expect([before, ready()]).toEqual([false, true])
  })

  it('falls back to the quick view when the frame loads but no ready message arrives', async () => {
    const { view } = await opened()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'quick' })
  })

  it('keeps the Dive once the ready message arrives from the Dive\'s origin and frame', async () => {
    const { loader, view } = await opened()
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'feather-dash:dive-ready' } }, frameWindow)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toMatchObject({ kind: 'dive' })
  })

  it('ignores a ready message from another origin', async () => {
    const { loader, view } = await opened()
    loader.message({ origin: 'https://elsewhere.example', source: frameWindow, data: { type: 'feather-dash:dive-ready' } }, frameWindow)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'quick' })
  })

  it('ignores a ready message from another window, even on the right origin', async () => {
    const { loader, view } = await opened()
    loader.message({ origin: 'https://embed-motherduck.com', source: {}, data: { type: 'feather-dash:dive-ready' } }, frameWindow)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'quick' })
  })
})


describe('the cached report has a deadline too', () => {
  afterEach(() => vi.useRealTimers())
  function harness() {
    vi.useFakeTimers()
    const pending: Record<string, ((v: unknown) => void)[]> = { report: [], embed_session: [] }
    let view = pageView({ embed: undefined, report: undefined })
    const loader = reportLoader<{ state: string }>(name => new Promise(resolve => pending[name].push(resolve)), state => { view = pageView(state) })
    return { pending, loader, view: () => view }
  }

  it("shows couldn't-load with Try again when the report never answers and the Dive is unreachable", async () => {
    const { pending, loader, view } = harness()
    loader.open('9901')
    pending.embed_session[0]({ unreachable: true })
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'failed' })
  })

  it('recovers on Try again, which asks for both again', async () => {
    const { pending, loader, view } = harness()
    loader.open('9901')
    pending.embed_session[0]({ unreachable: true })
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS)
    loader.open('9901')
    pending.report[1]({ state: 'ready' })
    pending.embed_session[1]({ unreachable: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(view()).toEqual({ kind: 'quick' })
  })

  it('keeps a working Dive when the report never answers', async () => {
    const { pending, loader, view } = harness()
    loader.open('9901')
    pending.embed_session[0]({ frame: 'https://embed-motherduck.com/sandbox/#session=s' })
    await vi.advanceTimersByTimeAsync(0)
    loader.frameLoaded()
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS * 2)
    expect(view()).toMatchObject({ kind: 'dive' })
  })

  it('ignores a report that answers after its deadline', async () => {
    const { pending, loader, view } = harness()
    loader.open('9901')
    pending.embed_session[0]({ unreachable: true })
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS)
    pending.report[0]({ state: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    expect(view()).toEqual({ kind: 'failed' })
  })
})

describe("the quick view's labels and its empty table", () => {
  it('names the section in its subtotal, so a scrolled table still says whose total it is', () => {
    expect(subtotalLabel('Sarees')).toBe('Sarees total')
  })

  it('shows a subcategory with no name in plain words, never a bare code (#4531)', () => {
    expect(subcategoryLabel({ code: '010606001', subcategory: null })).toEqual({ name: 'Unnamed subcategory', unnamed: true })
  })

  it('shows a named subcategory by its name alone, never its code (#4531)', () => {
    expect(subcategoryLabel({ code: '010101001', subcategory: 'Silk sarees' })).toEqual({ name: 'Silk sarees', unnamed: false })
  })

  it('says nothing is recorded, rather than drawing a lone Total row, when every row is hidden', () => {
    const quiet = [{ noTargetNoSale: true }, { noTargetNoSale: true }]
    expect([quickBody(quiet, false), quickBody(quiet, true), quickBody([{ noTargetNoSale: false }], false)]).toEqual(['nothing', 'table', 'table'])
  })
})

describe('a store in the address that is not the reader\'s', () => {
  afterEach(() => vi.useRealTimers())

  it("is not read: the page waits for the bar's correction instead", async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    let announce: (s: string) => void = () => {}
    firstStore('9909', cb => { announce = cb; return () => {} }, store => opened.push(store), BAR_STORE_WAIT_MS, async store => store === '9901')
    await vi.advanceTimersByTimeAsync(0)
    announce('9901')
    await vi.advanceTimersByTimeAsync(BAR_STORE_WAIT_MS)
    expect(opened).toEqual(['9901'])
  })

  it('opens at once when the store in the address is one of the reader\'s', async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    firstStore('9901', () => () => {}, store => opened.push(store), BAR_STORE_WAIT_MS, async store => store === '9901')
    await vi.advanceTimersByTimeAsync(0)
    expect(opened).toEqual(['9901'])
  })
})

describe('a store in the address whose check is slow', () => {
  afterEach(() => vi.useRealTimers())
  const later = <T,>(value: T, ms: number) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms))

  it('still opens the store in the address, never the default, when its check takes longer than the wait', async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    firstStore('9902', () => () => {}, store => opened.push(store), BAR_STORE_WAIT_MS, store => later(store === '9902', BAR_STORE_WAIT_MS * 3))
    await vi.advanceTimersByTimeAsync(BAR_STORE_WAIT_MS * 4)
    expect(opened).toEqual(['9902'])
  })

  it("keeps the reader's own choice made while the check is pending", async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    let announce: (s: string) => void = () => {}
    firstStore('9902', cb => { announce = cb; return () => {} }, store => opened.push(store), BAR_STORE_WAIT_MS, () => later(true, BAR_STORE_WAIT_MS * 3))
    announce('9901')
    await vi.advanceTimersByTimeAsync(BAR_STORE_WAIT_MS * 4)
    expect(opened).toEqual(['9901'])
  })

  it("opens without a store when the address names one that isn't the reader's and the bar offers none", async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    firstStore('9909', () => () => {}, store => opened.push(store), BAR_STORE_WAIT_MS, async () => false)
    await vi.advanceTimersByTimeAsync(BAR_STORE_WAIT_MS)
    expect(opened).toEqual([undefined])
  })
})

describe('a store in the address whose check never ends in time', () => {
  afterEach(() => vi.useRealTimers())
  const later = <T,>(value: T, ms: number) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms))

  it('reports a retryable failure, never another store, when the check passes its limit', async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    let failed = false
    firstStore('9902', () => () => {}, store => opened.push(store), BAR_STORE_WAIT_MS, () => new Promise(() => {}),
      () => { failed = true })
    await vi.advanceTimersByTimeAsync(STORE_CHECK_TIMEOUT_MS)
    expect([failed, opened]).toEqual([true, []])
  })

  it('still opens the store in the address when its check answers after the limit', async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    firstStore('9902', () => () => {}, store => opened.push(store), BAR_STORE_WAIT_MS, () => later(true, STORE_CHECK_TIMEOUT_MS * 2), () => {})
    await vi.advanceTimersByTimeAsync(STORE_CHECK_TIMEOUT_MS * 3)
    expect(opened).toEqual(['9902'])
  })

  it('opens on Try again, which checks the store again', async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    let failed = false
    const stop = firstStore('9902', () => () => {}, store => opened.push(store), BAR_STORE_WAIT_MS, () => new Promise(() => {}), () => { failed = true })
    await vi.advanceTimersByTimeAsync(STORE_CHECK_TIMEOUT_MS)
    stop()
    firstStore('9902', () => () => {}, store => opened.push(store), BAR_STORE_WAIT_MS, async () => true, () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect([failed, opened]).toEqual([true, ['9902']])
  })

  it("names stores well inside the page's own waits", () => {
    expect(STORE_NAMES_TIMEOUT_MS).toBeLessThanOrEqual(BAR_STORE_WAIT_MS / 2)
  })
})


describe("a total's cells under the display rule", () => {
  const totals = (patch: Record<string, number | null>) => ({ target: 0, actual: 0, gap: 0, achievement: null, targets_recorded: 0, sales_recorded: 0, ...patch })

  it('draws "—" for a value none of its rows recorded, never ₹0.00', () => {
    expect(totalCells(totals({}))).toEqual({ target: '—', sales: '—', gap: '—', achieved: '—' })
  })

  it('draws the gap and achievement only when the group recorded both a target and sales', () => {
    expect(totalCells(totals({ target: 0, actual: 12000.75, gap: 12000.75, sales_recorded: 1 }))).toEqual({ target: '—', sales: '₹12,000.75', gap: '—', achieved: '—' })
  })

  it("draws the old report's sums when both were recorded", () => {
    expect(totalCells(totals({ target: 1000, actual: 800, gap: -200, achievement: 80, targets_recorded: 1, sales_recorded: 1 })))
      .toEqual({ target: '₹1,000.00', sales: '₹800.00', gap: '−₹200.00', achieved: '80%' })
  })
})

// Wording per issue #4444's checklist (owner-facing, 28-Oct-2026): the group is "No section",
// its subtotal "No section total"; "No section" never breaks, so a narrow column wraps it as
// "No section / total".
describe('the group of subcategories in no section', () => {
  it('is headed "No section"', () => {
    expect(sectionHeading(null)).toBe('No section')
  })

  it('has the subtotal "No section total", kept as "No section" on one line', () => {
    expect(subtotalLabel(null)).toBe('No\u00a0section total')
  })

  it('heads a named section by its name', () => {
    expect(sectionHeading('Sarees')).toBe('Sarees')
  })
})

// #4486: the "why" sentence under the period line. Made-up stores and sections; each test is one
// wording rule of the issue's checklist (items 3 to 6 and 8).
describe('the sentence that says why the reader sees the store', () => {
  const at = (reasons: { basis: string; sections: string[] }[], name: string | null = 'LKS') => whyLine({ name, reasons })

  describe('one reason (item 3)', () => {
    it("names the store, not its sections, for a Store Manager", () => {
      expect(at([{ basis: 'store_manager', sections: ['Alpha', 'Beta', 'Gamma'] }])).toBe('You see LKS because you are its Store Manager.')
    })
    it("names the sections and the store for a Department Manager", () => {
      expect(at([{ basis: 'department_manager', sections: ['Alpha', 'Beta'] }])).toBe('You see Alpha and Beta at LKS because you are their Department Manager.')
    })
    it("names the sections and the store for a Team Leader", () => {
      expect(at([{ basis: 'team_leader', sections: ['Alpha'] }])).toBe('You see Alpha at LKS because you are their Team Leader.')
    })
    it('says the reader works in the sections for section staff', () => {
      expect(at([{ basis: 'section_staff', sections: ['Alpha', 'Beta'] }])).toBe('You see Alpha and Beta at LKS because you work in them.')
    })
    it('says the subcategories are assigned to the reader, naming no section', () => {
      expect(at([{ basis: 'assignment', sections: ['Alpha'] }])).toBe('You see these subcategories at LKS because they are assigned to you.')
    })
  })

  describe('several reasons for one store (item 4)', () => {
    it("joins them into one sentence, leadership first: the issue's example", () => {
      expect(at([{ basis: 'team_leader', sections: ['Alpha'] }, { basis: 'store_manager', sections: ['Alpha', 'Beta'] }]))
        .toBe('You see LKS because you are its Store Manager and Team Leader of Alpha.')
    })
    it('orders Department Manager before Team Leader before section staff before assigned subcategories, whatever order they arrive in', () => {
      expect(at([{ basis: 'assignment', sections: [] }, { basis: 'section_staff', sections: ['Gamma'] },
        { basis: 'team_leader', sections: ['Beta'] }, { basis: 'department_manager', sections: ['Alpha'] }]))
        .toBe('You see Alpha, Beta and Gamma at LKS because you are Department Manager of Alpha and Team Leader of Beta, work in Gamma and have other subcategories assigned to you.')
    })
    it('names each section once in what the reader sees', () => {
      expect(at([{ basis: 'team_leader', sections: ['Alpha'] }, { basis: 'section_staff', sections: ['Alpha', 'Beta'] }]))
        .toBe('You see Alpha and Beta at LKS because you are Team Leader of Alpha and work in Alpha and Beta.')
    })
    it('lists what the reader sees in the order the title does, whichever job names each section', () => {
      expect(at([{ basis: 'team_leader', sections: ['Gamma'] }, { basis: 'section_staff', sections: ['Alpha'] }]))
        .toBe('You see Alpha and Gamma at LKS because you are Team Leader of Gamma and work in Alpha.')
    })
    it("reads one basis given twice as one reason", () => {
      expect(at([{ basis: 'team_leader', sections: ['Alpha'] }, { basis: 'team_leader', sections: ['Beta'] }]))
        .toBe('You see Alpha and Beta at LKS because you are their Team Leader.')
    })
    it('places a Store Manager\'s other jobs after it, and assigned subcategories last', () => {
      expect(at([{ basis: 'assignment', sections: ['Beta'] }, { basis: 'store_manager', sections: ['Alpha', 'Beta'] }]))
        .toBe('You see LKS because you are its Store Manager and have other subcategories assigned to you.')
    })
  })

  describe('how many sections are named (item 5)', () => {
    const tl = (sections: string[]) => at([{ basis: 'team_leader', sections }])
    it('names one, two or three sections', () => {
      expect([tl(['Alpha']), tl(['Alpha', 'Beta']), tl(['Alpha', 'Beta', 'Gamma'])]).toEqual([
        'You see Alpha at LKS because you are their Team Leader.',
        'You see Alpha and Beta at LKS because you are their Team Leader.',
        'You see Alpha, Beta and Gamma at LKS because you are their Team Leader.',
      ])
    })
    it('counts them from four on', () => {
      expect(tl(['Alpha', 'Beta', 'Gamma', 'Delta'])).toBe('You see 4 sections at LKS because you are their Team Leader.')
      expect(tl(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'])).toBe('You see 7 sections at LKS because you are their Team Leader.')
    })
    it('counts within a joined sentence too', () => {
      expect(at([{ basis: 'store_manager', sections: [] }, { basis: 'team_leader', sections: ['Alpha', 'Beta', 'Gamma', 'Delta'] }]))
        .toBe('You see LKS because you are its Store Manager and Team Leader of 4 sections.')
    })
    it("never names a Store Manager's sections, however many", () => {
      expect(at([{ basis: 'store_manager', sections: ['A1', 'A2', 'A3', 'A4', 'A5'] }])).toBe('You see LKS because you are its Store Manager.')
    })
  })

  describe('no reason known (item 6)', () => {
    it('leaves the sentence out when the store has no reason', () => {
      expect(at([])).toBeNull()
    })
    it('leaves it out when every basis is one the page does not know, rather than "because you are ."', () => {
      expect(at([{ basis: 'regional_auditor', sections: ['Alpha'] }, { basis: '', sections: [] }])).toBeNull()
    })
    it('drops an unknown basis beside a known one', () => {
      expect(at([{ basis: 'regional_auditor', sections: ['Beta'] }, { basis: 'team_leader', sections: ['Alpha'] }]))
        .toBe('You see Alpha at LKS because you are their Team Leader.')
    })
  })

  describe("the new org chart's reasons, in the same wording", () => {
    it("says Cluster Manager for a Cluster Manager, naming the store", () => {
      expect(at([{ basis: 'cluster_manager', sections: ['Alpha'] }])).toBe('You see LKS because you are its Cluster Manager.')
    })
    it('says Floor Manager for a Floor Manager, naming the sections', () => {
      expect(at([{ basis: 'floor_manager', sections: ['Alpha', 'Beta'] }])).toBe('You see Alpha and Beta at LKS because you are their Floor Manager.')
    })
    it('says "acting" before an acting job', () => {
      expect(at([{ basis: 'acting_team_leader', sections: ['Alpha'] }])).toBe('You see Alpha at LKS because you are their acting Team Leader.')
      expect(at([{ basis: 'acting_store_manager', sections: [] }])).toBe('You see LKS because you are its acting Store Manager.')
    })
    it('reads acting section staff as working in the section', () => {
      expect(at([{ basis: 'acting_section_staff', sections: ['Alpha'] }])).toBe('You see Alpha at LKS because you work in them.')
    })
    it('places an acting job after the same job held outright', () => {
      expect(at([{ basis: 'acting_team_leader', sections: ['Beta'] }, { basis: 'team_leader', sections: ['Alpha'] }]))
        .toBe('You see Alpha and Beta at LKS because you are Team Leader of Alpha and acting Team Leader of Beta.')
    })
  })

  describe('plain English (item 8)', () => {
    const every = [
      at([{ basis: 'store_manager', sections: ['Alpha'] }], null),
      at([{ basis: 'team_leader', sections: ['Alpha'] }], null),
      at([{ basis: 'assignment', sections: [] }], null),
      at([{ basis: 'store_manager', sections: [] }, { basis: 'section_staff', sections: ['Alpha'] }, { basis: 'assignment', sections: [] }]),
      at([{ basis: 'acting_department_manager', sections: [] }]),
    ]
    it('says "your store" when the store has no short name, as the title says "Your store", never its plant code', () => {
      expect(every.slice(0, 3)).toEqual([
        'You see your store because you are its Store Manager.',
        'You see Alpha at your store because you are their Team Leader.',
        'You see these subcategories at your store because they are assigned to you.',
      ])
    })
    it('says "these subcategories" when a job names no section', () => {
      expect(every[4]).toBe('You see these subcategories at LKS because you are their acting Department Manager.')
    })
    it.each(every.map(s => [s]))('never shows a code or a basis name: %s', (sentence) => {
      expect(sentence).not.toMatch(/_|\d{4}|material group/i)
      expect(sentence).not.toMatch(/\bstore_manager\b|\bassignment\b/)
    })
  })
})

describe("the page's header (#4486)", () => {
  it('titles the store by its short name and its sections, three at most', () => {
    expect(headingTitle({ name: 'LKS', sections: ['Alpha', 'Beta', 'Gamma'] })).toBe('LKS · Alpha · Beta · Gamma')
    expect(headingTitle({ name: 'LKS', sections: ['Alpha', 'Beta', 'Gamma', 'Delta'] })).toBe('LKS · 4 sections')
    expect(headingTitle({ name: 'LKS', sections: [] })).toBe('LKS')
  })
  it('titles a store with no short name "Your store", never by its plant code', () => {
    expect(headingTitle({ name: null, sections: ['Alpha'] })).toBe('Your store · Alpha')
  })
  it('gives the period as DD-Mon-YYYY to DD-Mon-YYYY', () => {
    expect(periodLine({ period_start: '2026-10-01', period_end: '2026-10-29' })).toBe('01-Oct-2026 to 29-Oct-2026')
  })
  it('keeps the measure on its own line, in the old page\'s words', () => {
    expect(MEASURE_LINE).toBe('Sales before tax, net of returns')
  })
})

describe('noAccessHelp: why the report refused, for the person reading it', () => {
  it('a store reader keeps today\'s message, whatever the setup', () => {
    expect(noAccessHelp({ manages: false, local: false })).toEqual({ kind: 'reader' })
    expect(noAccessHelp({ manages: false, missing: ['secret X'], local: true })).toEqual({ kind: 'reader' })
  })
  it('a manager of an app not set up is told what it lacks; the command only on this machine', () => {
    expect(noAccessHelp({ manages: true, missing: ['secret X'], fix: 'Set it.', local: false }))
      .toEqual({ kind: 'not_set_up', missing: ['secret X'], fix: 'Set it.', command: null })
    expect(noAccessHelp({ manages: true, missing: ['secret X'], local: true }))
      .toEqual({ kind: 'not_set_up', missing: ['secret X'], fix: null, command: MADE_UP_DATA_COMMAND })
  })
  it('a manager of a set-up app is told it opens only for people who cover a store', () => {
    expect(noAccessHelp({ manages: true, missing: [], local: false })).toEqual({ kind: 'manager_no_store', command: null })
    expect(noAccessHelp({ manages: true, local: true })).toEqual({ kind: 'manager_no_store', command: MADE_UP_DATA_COMMAND })
  })
})
