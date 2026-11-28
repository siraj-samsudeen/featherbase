// What the report page shows, decided from what its reads answered. Made-up stores.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BAR_STORE_WAIT_MS, DIVE_READY_TIMEOUT_MS, REPORT_TIMEOUT_MS, STORE_CHECK_TIMEOUT_MS, firstStore, pageView, reachMessage, reportAddress, reportLoader } from './page.ts'

describe('the page', () => {
  const report = (state: string) => ({ ok: true as const, value: { state } })
  const frame = { ok: true as const, value: { frame: 'https://embed-motherduck.com/sandbox/#session=s' } }

  it('opens the Dive when it can', () => {
    expect(pageView({ embed: frame, report: report('ready') })).toEqual({ kind: 'dive', src: 'https://embed-motherduck.com/sandbox/#session=s' })
  })

  it('says "Opening your report…" until the embed session answers', () => {
    expect(pageView({ embed: undefined, report: report('ready') })).toEqual({ kind: 'opening' })
  })

  // #1366: there is no quick view; a Dive that can't open says so, with Try again.
  it.each([
    ['not set up', { ok: true as const, value: { not_set_up: true } }],
    ['unreachable', { ok: true as const, value: { unreachable: true } }],
    ['a failed session read', { ok: false as const, status: 502 }],
  ])("says the report couldn't open when the Dive is %s", (_why, embed) => {
    expect(pageView({ embed, report: report('ready') })).toEqual({ kind: 'failed' })
  })

  it("waits for the report read before saying the report couldn't open", () => {
    expect(pageView({ embed: { ok: true, value: { unreachable: true } }, report: undefined })).toEqual({ kind: 'opening' })
  })

  it("says the reader has no access when a read refuses them", () => {
    expect(pageView({ embed: { ok: false, status: 403 }, report: undefined })).toEqual({ kind: 'no_access' })
  })

  it('asks the reader to sign in when they are signed out', () => {
    expect(pageView({ embed: { ok: false, status: 401 }, report: undefined })).toEqual({ kind: 'signed_out' })
  })

  it("says the report couldn't open, with Try again, when the report read fails", () => {
    expect(pageView({ embed: { ok: true, value: { unreachable: true } }, report: { ok: false, status: 500 } })).toEqual({ kind: 'failed' })
  })

  // #1391: no answer at all (the request failed on the way, or ran out of time) is the connection,
  // not the report; an answer that refuses, or a MotherDuck error, is the report.
  it.each([
    ['the session request failed on the way', { embed: { ok: false as const }, report: report('ready') }],
    ['the report read failed on the way', { embed: { ok: true as const, value: { unreachable: true } }, report: { ok: false as const } }],
    ['the session request ran out of time', { embed: undefined, report: report('ready'), timedOut: true }],
  ])("says Dash couldn't be reached when %s", (_why, input) => {
    expect(pageView(input)).toEqual({ kind: 'offline' })
  })

  it("says the report couldn't open, not the connection, when the server answered", () => {
    expect([pageView({ embed: { ok: false, status: 500 }, report: report('ready') }),
      pageView({ embed: { ok: true, value: { unreachable: true } }, report: report('ready'), timedOut: true })])
      .toEqual([{ kind: 'failed' }, { kind: 'failed' }])
  })

  // #1423: a refusal says why, from either read, never "couldn't open".
  it.each<[string, Parameters<typeof pageView>[0], unknown]>([
    ['the reader reaches nothing yet', { embed: undefined, report: report('no_reach') }, { kind: 'refused', why: 'no_reach' }],
    ['the report is not set up', { embed: undefined, report: report('report_not_set_up') }, { kind: 'refused', why: 'report_not_set_up' }],
    ['the session refuses a reader who reaches nothing', { embed: { ok: true, value: { refused: 'no_reach' } }, report: report('ready') }, { kind: 'refused', why: 'no_reach' }],
    ['the session refuses a report not set up', { embed: { ok: true, value: { refused: 'report_not_set_up' } }, report: report('ready') }, { kind: 'refused', why: 'report_not_set_up' }],
    ['the session refuses a whole-stores report', { embed: { ok: true, value: { refused: 'whole_stores_only' } }, report: report('ready') }, { kind: 'empty', why: 'whole_stores_only' }],
    ['the session refuses a store not theirs', { embed: { ok: true, value: { refused: 'not_your_store' } }, report: report('ready') }, { kind: 'no_access' }],
    ['the session refuses a report not theirs', { embed: { ok: true, value: { refused: 'no_access' } }, report: report('ready') }, { kind: 'no_access' }],
  ])('says why when %s', (_why, input, view) => {
    expect(pageView(input)).toEqual(view)
  })

  // #1269: MotherDuck refused the reader's reach as too large.
  it('says the reach is too large where it would say only "couldn\'t open"', () => {
    const tooLarge = { ok: true as const, value: { too_large: true } }
    expect([pageView({ embed: tooLarge, report: report('ready') }), pageView({ embed: tooLarge, report: { ok: false, status: 500 } })])
      .toEqual([{ kind: 'too_large' }, { kind: 'too_large' }])
  })
})

describe("the Dive's frame", () => {
  afterEach(() => vi.useRealTimers())
  const frame = { ok: true as const, value: { frame: 'https://embed-motherduck.com/sandbox/#session=s' } }
  const ready = { ok: true as const, value: { state: 'ready' } }

  it("says the report couldn't open once the frame has failed", () => {
    expect(pageView({ embed: frame, report: ready, frameFailed: true })).toEqual({ kind: 'failed' })
  })

  // #1143: past the deadline "couldn't open" stands in, until the Dive says it is ready.
  it("says the report couldn't open past the deadline while the Dive has not said it is ready", () => {
    expect(pageView({ embed: frame, report: ready, timedOut: true })).toEqual({ kind: 'failed' })
  })

  it('shows the Dive past the deadline once it has said it is ready', () => {
    expect(pageView({ embed: frame, report: ready, timedOut: true, diveReady: true })).toMatchObject({ kind: 'dive' })
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

  it("says Dash couldn't be reached when the session request never answers", async () => {
    vi.useFakeTimers()
    const { pending, read } = reads()
    let view = pageView({ embed: undefined, report: undefined })
    const loader = reportLoader<{ state: string }>(read, state => { view = pageView(state) })
    loader.open('9901')
    pending.report[0].resolve(READY)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view).toEqual({ kind: 'offline' })
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
    expect(view).toEqual({ kind: 'offline' })
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

  it("says the report couldn't open when the session answers but its frame never loads", async () => {
    vi.useFakeTimers()
    const { pending, read } = reads()
    let view = pageView({ embed: undefined, report: undefined })
    const loader = reportLoader<{ state: string }>(read, state => { view = pageView(state) })
    loader.open('9901')
    pending.report[0].resolve(READY)
    pending.embed_session[0].resolve(FRAME)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view).toEqual({ kind: 'failed' })
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
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'dash:dive-ready' } }, frameWindow)
    expect([before, ready()]).toEqual([false, true])
  })

  it("says the report couldn't open when the frame loads but no ready message arrives", async () => {
    const { view } = await opened()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'failed' })
  })

  it('keeps the Dive once the ready message arrives from the Dive\'s origin and frame', async () => {
    const { loader, view } = await opened()
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'dash:dive-ready' } }, frameWindow)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toMatchObject({ kind: 'dive' })
  })

  it('ignores a ready message from another origin', async () => {
    const { loader, view } = await opened()
    loader.message({ origin: 'https://elsewhere.example', source: frameWindow, data: { type: 'dash:dive-ready' } }, frameWindow)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'failed' })
  })

  it('ignores a ready message from another window, even on the right origin', async () => {
    const { loader, view } = await opened()
    loader.message({ origin: 'https://embed-motherduck.com', source: {}, data: { type: 'dash:dive-ready' } }, frameWindow)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'failed' })
  })

  // #1143: a Dive can take longer than the deadline to say it is ready (MotherDuck's session start).
  it('switches to the Dive when its ready message arrives after the deadline', async () => {
    const { loader, view } = await opened()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    const atDeadline = view()
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'feather-dash:dive-ready' } }, frameWindow)
    expect([atDeadline, view()]).toEqual([{ kind: 'failed' }, expect.objectContaining({ kind: 'dive' })])
  })

  it("keeps saying it couldn't open when no ready message ever arrives", async () => {
    const { view } = await opened()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS * 4)
    expect(view()).toEqual({ kind: 'failed' })
  })

  it("keeps saying it couldn't open once the frame errors, even if a ready message follows", async () => {
    const { loader, view } = await opened()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    loader.frameFailed()
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'dash:dive-ready' } }, frameWindow)
    expect(view()).toEqual({ kind: 'failed' })
  })

  // #1141: Dives published before #966 renamed the message still post its old name.
  it('keeps the Dive when it posts the legacy ready message, feather-dash:dive-ready', async () => {
    const { loader, view } = await opened()
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'feather-dash:dive-ready' } }, frameWindow)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toMatchObject({ kind: 'dive' })
  })

  it('ignores any other message type from the Dive', async () => {
    const { loader, view } = await opened()
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'feather-dash:dive-loaded' } }, frameWindow)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'failed' })
  })
})


describe('the report read has a deadline too', () => {
  afterEach(() => vi.useRealTimers())
  function harness() {
    vi.useFakeTimers()
    const pending: Record<string, ((v: unknown) => void)[]> = { report: [], embed_session: [] }
    let view = pageView({ embed: undefined, report: undefined })
    const loader = reportLoader<{ state: string }>(name => new Promise(resolve => pending[name].push(resolve)), state => { view = pageView(state) })
    return { pending, loader, view: () => view }
  }

  it("says Dash couldn't be reached, with Try again, when the report never answers and the Dive is unreachable", async () => {
    const { pending, loader, view } = harness()
    loader.open('9901')
    pending.embed_session[0]({ unreachable: true })
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'offline' })
  })

  it('recovers on Try again, which asks for both again', async () => {
    const { pending, loader, view } = harness()
    loader.open('9901')
    pending.embed_session[0]({ unreachable: true })
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS)
    loader.open('9901')
    pending.report[1]({ state: 'ready' })
    pending.embed_session[1]({ frame: 'https://embed-motherduck.com/sandbox/#session=s' })
    await vi.advanceTimersByTimeAsync(0)
    loader.frameLoaded()
    expect(view()).toMatchObject({ kind: 'dive' })
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
    expect(view()).toEqual({ kind: 'offline' })
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
})

describe('a report whose reader or row refuses it', () => {
  const said = (state: string) => pageView({ embed: { ok: true, value: { refused: state } }, report: { ok: true, value: { state } } })

  it("says a whole-stores report isn't for this job", () => {
    expect(said('whole_stores_only')).toEqual({ kind: 'empty', why: 'whole_stores_only' })
  })

  it('shows no access for a report that is not theirs', () => {
    expect(said('no_access')).toEqual({ kind: 'no_access' })
  })

  // #1423: not "couldn't open": the report isn't set up yet, and whoever runs Dash can fix it.
  it("says a report whose row isn't set up isn't set up yet", () => {
    expect(said('report_not_set_up')).toEqual({ kind: 'refused', why: 'report_not_set_up' })
  })
})

describe("a report's address", () => {
  it('names the report', () => {
    expect(reportAddress('sales', '')).toBe('?report=sales')
  })

  it('replaces the report named, keeping the store and month', () => {
    expect(reportAddress('whole', '?store=9901&month=last&report=sales')).toBe('?store=9901&month=last&report=whole')
  })

  it('leaves a sub-page behind', () => {
    expect(reportAddress('sales', '?view=approvals')).toBe('?report=sales')
  })
})

describe('what a job that reaches nothing is told', () => {
  it.each(['no_section', 'nothing_placed'])('%s: not set against a section, with a link to Your sections', problem => {
    expect(reachMessage([problem])).toEqual({ text: "You aren't set against a section yet, so there is no report to show.", sectionsLink: true })
  })

  it('departments_not_filled: set up your department, with the way in (#1195)', () => {
    expect(reachMessage(['departments_not_filled'])).toEqual({ title: 'Set up your department to open your report', sectionsLink: false, departmentLink: true,
      text: "Your report shows your department's sections, and Dash doesn't know them yet. Say which sections are yours and give the department a name. It takes a minute." })
  })

  it("store_sections_not_set_up: the store's sections come first, with no way in yet (#1195)", () => {
    expect(reachMessage(['store_sections_not_set_up'])).toMatchObject({ title: "Your store's sections aren't set up yet", sectionsLink: false })
    expect(reachMessage(['store_sections_not_set_up'])?.departmentLink).toBeUndefined()
  })

  it('no_cluster: not in a cluster, with no link', () => {
    expect(reachMessage(['no_cluster'])).toEqual({ text: "Your store isn't in a cluster yet, so there is no report to show.", sectionsLink: false })
  })

  // #1172: Dash now opens for them (any Dash role), so each says why there is no report.
  it('head_office: no store report is set against a head-office job, with no link', () => {
    expect(reachMessage(['head_office'])).toEqual({ text: 'Your job is in head office, so no store report is set against it. Ask the person who gives Dash reports in your company if you need one.', sectionsLink: false, readerOnly: true })
  })

  it('no_job: not on the staff list, with no link', () => {
    expect(reachMessage(['no_job'])).toEqual({ text: "You aren't on the staff list yet, so there is no report to show. Ask HR to add you.", sectionsLink: false, readerOnly: true })
  })

  it('no problem at all: nothing of its own, so the no-access page says it', () => {
    expect(reachMessage([])).toBeNull()
  })

  it('a section to fix comes before the rest', () => {
    expect(reachMessage(['departments_not_filled', 'no_section'])?.sectionsLink).toBe(true)
  })
})
