// What the report page shows, decided from what its reads answered, and how it
// writes money, days and times. Made-up figures.
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

  it('shows the quick view when the Dive is not set up', () => {
    expect(pageView({ embed: { ok: true, value: { not_set_up: true } }, report: report('ready') })).toEqual({ kind: 'quick' })
  })

  it('shows the quick view when the Dive is unreachable', () => {
    expect(pageView({ embed: { ok: true, value: { unreachable: true } }, report: report('ready') })).toEqual({ kind: 'quick' })
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

  // #1143: past the deadline the cached view stands in, until the Dive says it is ready.
  it('shows the quick view past the deadline while the Dive has not said it is ready', () => {
    expect(pageView({ embed: frame, report: ready, timedOut: true })).toEqual({ kind: 'quick' })
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
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'dash:dive-ready' } }, frameWindow)
    expect([before, ready()]).toEqual([false, true])
  })

  it('falls back to the quick view when the frame loads but no ready message arrives', async () => {
    const { view } = await opened()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'quick' })
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
    expect(view()).toEqual({ kind: 'quick' })
  })

  it('ignores a ready message from another window, even on the right origin', async () => {
    const { loader, view } = await opened()
    loader.message({ origin: 'https://embed-motherduck.com', source: {}, data: { type: 'dash:dive-ready' } }, frameWindow)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect(view()).toEqual({ kind: 'quick' })
  })

  // #1143: a Dive can take longer than the deadline to say it is ready (MotherDuck's session start).
  it('switches to the Dive when its ready message arrives after the deadline', async () => {
    const { loader, view } = await opened()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    const atDeadline = view()
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'feather-dash:dive-ready' } }, frameWindow)
    expect([atDeadline, view()]).toEqual([{ kind: 'quick' }, expect.objectContaining({ kind: 'dive' })])
  })

  it('keeps the cached view when no ready message ever arrives', async () => {
    const { view } = await opened()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS * 4)
    expect(view()).toEqual({ kind: 'quick' })
  })

  it('keeps the cached view for good once the frame errors, even if a ready message follows', async () => {
    const { loader, view } = await opened()
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    loader.frameFailed()
    loader.message({ origin: 'https://embed-motherduck.com', source: frameWindow, data: { type: 'dash:dive-ready' } }, frameWindow)
    expect(view()).toEqual({ kind: 'quick' })
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

  it("counts a report whose row isn't set up as failed", () => {
    expect(said('report_not_set_up')).toEqual({ kind: 'failed' })
  })
})

describe('a report with no quick view', () => {
  const plain = { ok: true as const, value: { state: 'ready', no_quick_view: true } }

  it('shows its Dive', () => {
    expect(pageView({ embed: { ok: true, value: { frame: 'https://embed-motherduck.com/x' } }, report: plain })).toEqual({ kind: 'dive', src: 'https://embed-motherduck.com/x' })
  })

  it.each<[string, Parameters<typeof pageView>[0]]>([
    ['the Dive is unreachable', { embed: { ok: true, value: { unreachable: true } }, report: plain }],
    ['the Dive is not set up', { embed: { ok: true, value: { not_set_up: true } }, report: plain }],
    ['the session read fails', { embed: { ok: false, status: 502 }, report: plain }],
    ["the Dive's frame fails", { embed: { ok: true, value: { frame: 'https://embed-motherduck.com/x' } }, report: plain, frameFailed: true }],
  ])('counts as failed when %s, with nothing to stand in', (_what, input) => {
    expect(pageView(input)).toEqual({ kind: 'failed' })
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

  it('departments_not_filled: wait for them, with no link', () => {
    expect(reachMessage(['departments_not_filled'])).toEqual({ text: "Your store's departments aren't filled in yet. Your report will open once they are.", sectionsLink: false })
  })

  it('no_cluster: not in a cluster, with no link', () => {
    expect(reachMessage(['no_cluster'])).toEqual({ text: "Your store isn't in a cluster yet, so there is no report to show.", sectionsLink: false })
  })

  it.each([[['head_office']], [['no_job']], [[]]])('%j: nothing of its own, so the no-access page says it', problems => {
    expect(reachMessage(problems)).toBeNull()
  })

  it('a section to fix comes before the rest', () => {
    expect(reachMessage(['departments_not_filled', 'no_section'])?.sectionsLink).toBe(true)
  })
})
