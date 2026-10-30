// Every async step of the page acts only while the attempt that started it is current
// (Codex rounds 7, 10, 14 and 15: a late result from a superseded attempt must never act on
// the page). Made-up stores 9901 and 9902.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BAR_STORE_WAIT_MS, DIVE_READY_TIMEOUT_MS, STORE_CHECK_TIMEOUT_MS, firstStore, generations, pageView, reportLoader, storeChooser, visibleState, type LoadState } from './page.ts'

afterEach(() => vi.useRealTimers())

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('a superseded store check', () => {
  it('does nothing when it answers yes after Try again and a new pick: only the new store stays', async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    const first = deferred<boolean>()
    const stop = firstStore('9902', () => () => {}, s => opened.push(s), BAR_STORE_WAIT_MS, () => first.promise, () => {})
    await vi.advanceTimersByTimeAsync(STORE_CHECK_TIMEOUT_MS)
    stop()
    let announce: (s: string) => void = () => {}
    firstStore('9902', cb => { announce = cb; return () => {} }, s => opened.push(s), BAR_STORE_WAIT_MS, () => new Promise(() => {}), () => {})
    announce('9901')
    first.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(opened).toEqual(['9901'])
  })

  it('does nothing when it fails after Try again and a new pick', async () => {
    vi.useFakeTimers()
    const opened: (string | undefined)[] = []
    const first = deferred<boolean>()
    const stop = firstStore('9902', () => () => {}, s => opened.push(s), BAR_STORE_WAIT_MS, () => first.promise, () => {})
    await vi.advanceTimersByTimeAsync(STORE_CHECK_TIMEOUT_MS)
    stop()
    let announce: (s: string) => void = () => {}
    firstStore('9902', cb => { announce = cb; return () => {} }, s => opened.push(s), BAR_STORE_WAIT_MS, () => new Promise(() => {}), () => {})
    announce('9901')
    first.reject(new Error('offline'))
    await vi.advanceTimersByTimeAsync(0)
    expect(opened).toEqual(['9901'])
  })

  it('never fires a timer once disposed', async () => {
    vi.useFakeTimers()
    let timedOut = false
    const opened: (string | undefined)[] = []
    const stop = firstStore(undefined, () => () => {}, s => opened.push(s), BAR_STORE_WAIT_MS, undefined, () => { timedOut = true })
    stop()
    await vi.advanceTimersByTimeAsync(STORE_CHECK_TIMEOUT_MS * 2)
    expect([opened, timedOut]).toEqual([[], false])
  })
})

describe('the generation guard', () => {
  it('runs a callback of the current generation', async () => {
    const g = generations()
    const token = g.bump()
    let ran = false
    g.settle(token, Promise.resolve(1), () => { ran = true })
    await Promise.resolve(); await Promise.resolve()
    expect(ran).toBe(true)
  })

  it('drops a callback of a superseded generation', async () => {
    const g = generations()
    const token = g.bump()
    g.bump()
    let ran = false
    g.settle(token, Promise.resolve(1), () => { ran = true }, () => { ran = true })
    await Promise.resolve(); await Promise.resolve()
    expect(ran).toBe(false)
  })

  it('creates no timer after disposal', () => {
    vi.useFakeTimers()
    const g = generations()
    const token = g.bump()
    g.dispose()
    let fired = false
    g.after(token, 10, () => { fired = true })
    vi.advanceTimersByTime(100)
    expect([fired, vi.getTimerCount()]).toEqual([false, 0])
  })
})

describe("an earlier store's frame", () => {
  it("can't vouch for the Dive of the store now on show", async () => {
    vi.useFakeTimers()
    const pending: Record<string, ((v: unknown) => void)[]> = { report: [], embed_session: [] }
    let state: LoadState = { embed: undefined, report: undefined, frameFailed: false, diveReady: false }
    const loader = reportLoader(name => new Promise(resolve => pending[name].push(resolve)), s => { state = s })
    loader.open('9901')
    const earlier = loader.current()
    loader.open('9902')
    pending.embed_session[1]({ frame: 'https://embed-motherduck.com/sandbox/#store=9902' })
    await vi.advanceTimersByTimeAsync(0)
    loader.frameLoaded(earlier)
    await vi.advanceTimersByTimeAsync(DIVE_READY_TIMEOUT_MS)
    expect([state.diveReady, state.frameFailed]).toEqual([false, true])
  })
})

describe('the store on show, repeated (Codex round 9)', () => {
  it('changes nothing: no reset, no new store', () => {
    const selected: string[] = []
    const set: (string | undefined)[] = []
    const choose = storeChooser({ select: (s: string) => { selected.push(s) } }, s => { set.push(s) })
    choose('9901')
    choose('9901')
    choose('9902')
    choose('9902')
    expect([selected, set]).toEqual([['9901', '9902'], ['9901', '9902']])
  })
})

describe('choosing a store (Codex round 8)', () => {
  it('drops an earlier store\'s answer that arrives after the choice but before the new store opens', async () => {
    const pending: Record<string, ((v: unknown) => void)[]> = { report: [], embed_session: [] }
    let state: LoadState<{ state: string; store: string }> = { embed: undefined, report: undefined, frameFailed: false, diveReady: false }
    const loader = reportLoader<{ state: string; store: string }>(name => new Promise(resolve => pending[name].push(resolve)), s => { state = s })
    loader.open('9901')
    loader.select('9902')
    pending.report[0]({ state: 'ready', store: '9901' })
    pending.embed_session[0]({ not_set_up: true })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect([state.store, state.report, state.embed]).toEqual(['9902', undefined, undefined])
  })

  it('shows nothing of a state published for another store than the one chosen', () => {
    const other = { store: '9901', embed: { ok: true as const, value: { not_set_up: true } }, report: { ok: true as const, value: { state: 'ready' } },
      frameFailed: false, diveReady: false }
    expect(visibleState(other, '9902')).toEqual({ store: '9902', embed: undefined, report: undefined, frameFailed: false, diveReady: false })
  })

  it('shows a state published for the store chosen', () => {
    const mine = { store: '9902', embed: undefined, report: { ok: true as const, value: { state: 'ready' } }, frameFailed: false, diveReady: false }
    expect(visibleState(mine, '9902')).toBe(mine)
  })
})

// Property-style: random interleavings of the page's events never leave figures on screen for
// a store other than the one the bar and the address show.
describe('random interleavings of checks, reads, picks, Try again and timeouts', () => {
  function rng(seed: number) {
    let s = seed >>> 0
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
  }

  it('never show, or open, another store than the one in the bar and the address', async () => {
    vi.useFakeTimers()
    for (let seed = 1; seed <= 300; seed++) {
      const random = rng(seed)
      const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)]
      let address: string | undefined = '9902'
      let state: LoadState<{ state: string; store: string }> = { embed: undefined, report: undefined, frameFailed: false, diveReady: false }
      const pending: { name: string; store: string; d: ReturnType<typeof deferred<unknown>> }[] = []
      const read = (name: string, payload: Record<string, unknown>) => {
        const d = deferred<unknown>()
        pending.push({ name, store: String(payload.store ?? ''), d })
        return d.promise
      }
      const loader = reportLoader<{ state: string; store: string }>(read, s => { state = s })
      let shown: string | undefined
      let listeners: ((s: string) => void)[] = []
      const listen = (cb: (s: string) => void) => { listeners.push(cb); return () => { listeners = listeners.filter(l => l !== cb) } }
      // As main.tsx does it: a choice invalidates at once (loader.select) and the store opens in a
      // later effect. Opening a store never moves the bar or the address; only the reader does.
      // The effect runs at a later step of its own ('effect'), so answers can land in between.
      let effect: (() => void) | undefined
      // The page's own chooser (as app.tsx uses it); its setStore bails out on an unchanged
      // store exactly as React's state update does, so no effect runs then.
      let opened = false
      const open = storeChooser(loader, (store?: string) => {
        if (opened && store === shown) return
        opened = true
        shown = store
        effect = () => loader.open(store)
      })
      const checks: ReturnType<typeof deferred<boolean>>[] = []
      const check = () => { const d = deferred<boolean>(); checks.push(d); return d.promise }
      let failed = false
      let stop = firstStore(address, listen, open, BAR_STORE_WAIT_MS, check, () => { failed = true })
      for (let step = 0; step < 30; step++) {
        const action = pick(['check', 'report', 'embed', 'pickStore', 'sameStore', 'retry', 'time', 'frame', 'effect', 'effect'])
        if (action === 'check' && checks.length) {
          const d = pick(checks)
          // Both stores are the reader's here, so a check answers yes or fails (a "no" is the
          // bar's correction, covered in page.test.ts).
          if (random() < 0.7) d.resolve(true); else d.reject(new Error('x'))
        } else if ((action === 'report' || action === 'embed') && pending.length) {
          const p = pick(pending.filter(x => x.name === (action === 'report' ? 'report' : 'embed_session')).concat(pending))
          if (random() < 0.8) p.d.resolve(p.name === 'report' ? { state: 'ready', store: p.store } : { frame: `https://embed-motherduck.com/sandbox/#store=${p.store}` })
          else p.d.reject(Object.assign(new Error('x'), { status: 502 }))
        } else if (action === 'pickStore' || action === 'sameStore') {
          // 'sameStore': the bar, or Back/Forward, repeats the store on show.
          const s: string = action === 'sameStore' ? address! : pick(['9901', '9902'])
          address = s
          for (const l of [...listeners]) l(s)
        } else if (action === 'retry') {
          if (shown === undefined && failed) { stop(); failed = false; stop = firstStore(address, listen, open, BAR_STORE_WAIT_MS, check, () => { failed = true }) }
          else if (shown !== undefined) loader.open(shown)
        } else if (action === 'time') {
          await vi.advanceTimersByTimeAsync(pick([500, 2_000, 10_000, 15_000]))
        } else if (action === 'effect') {
          effect?.()
          effect = undefined
        } else if (action === 'frame') {
          loader.frameLoaded()
        }
        await vi.advanceTimersByTimeAsync(0)
        // No answer for another store is ever accepted, rendered or not.
        if (state.report?.ok) expect([seed, step, 'accepted', state.report.value.store]).toEqual([seed, step, 'accepted', state.store])
        if (state.embed?.ok && state.embed.value.frame) expect([seed, step, 'accepted', state.embed.value.frame.split('#store=')[1]]).toEqual([seed, step, 'accepted', state.store])
        const seen = visibleState(state, shown)
        const view = pageView(seen)
        const figuresFor = view.kind === 'quick' && seen.report?.ok ? seen.report.value.store
          : view.kind === 'dive' ? view.src.split('#store=')[1] : undefined
        if (figuresFor !== undefined) expect([seed, step, figuresFor]).toEqual([seed, step, address])
        // Never stuck: once a store is open, "Opening…" always has an attempt running (or its
        // effect queued), so it ends in figures, an empty state or couldn't-load with Try again.
        if (view.kind === 'opening' && opened) expect([seed, step, 'stuck', loader.running() || !!effect]).toEqual([seed, step, 'stuck', true])
        // Stronger: the page never even opens (reads for) another store than the one shown.
        if (shown !== undefined) expect([seed, step, 'opened', shown]).toEqual([seed, step, 'opened', address])
      }
      stop()
      loader.close()
      await vi.runOnlyPendingTimersAsync()
    }
  })
})
