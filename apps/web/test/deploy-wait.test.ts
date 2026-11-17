// #1260: a deploy's gap is waited out, not shown. The production service has
// a volume, so Railway stops the old server before the new one serves, and for
// ~11 s its edge answers 502 itself (x-railway-fallback: true). These tests
// drive the wrapper with a scripted fetch and fake timers.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDeployWait, waitThroughDeploys, NOTICE_TEXT } from '../src/lib/deploy-wait'

const EDGE_502 = () => new Response('{"status":"error","code":502,"message":"Application failed to respond"}', {
  status: 502, headers: { 'content-type': 'application/json', 'x-railway-fallback': 'true' },
})
const OK = (body = '{"ok":true}') => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })

type Call = { url: string; method: string; body: string | null }

/** A fetch that answers from `script(call, n)`, recording every call. Pings
 *  answer `pingUp()`'s verdict. */
function scripted(script: (call: Call, n: number) => Response | Promise<Response>, pingUp: () => boolean = () => true) {
  const calls: Call[] = []
  const pings: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), window.location.href), init)
    const url = new URL(request.url).pathname
    if (url === '/api/ping') {
      pings.push(url)
      return pingUp() ? OK('{"message":"pong"}') : EDGE_502()
    }
    const body = request.body ? await request.text() : null
    const call = { url, method: request.method, body }
    calls.push(call)
    return script(call, calls.length)
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls, pings }
}

let notices: boolean[]
const onWaiting = (waiting: boolean) => notices.push(waiting)

beforeEach(() => {
  vi.useFakeTimers()
  notices = []
})
afterEach(() => {
  vi.useRealTimers()
  document.querySelectorAll('featherbase-updating').forEach((node) => node.remove())
})

const here = (path: string) => new URL(path, window.location.href).href

describe('a read during a deploy', () => {
  test('an answer from Railway\'s edge is held, and the read is sent again once the server answers its ping', async () => {
    const { fetch, calls } = scripted((_call, n) => (n < 3 ? EDGE_502() : OK('{"rows":[1]}')))
    const wrapped = waitThroughDeploys(fetch, { onWaiting })
    const answer = wrapped('/api/rows')
    await vi.advanceTimersByTimeAsync(5000)
    const res = await answer
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rows: [1] })
    expect(calls).toHaveLength(3)
  })

  test('a network error is held and the read sent again', async () => {
    let n = 0
    const base = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/ping')) return OK()
      if (++n === 1) throw new TypeError('Failed to fetch')
      return OK()
    }) as unknown as typeof globalThis.fetch
    const answer = waitThroughDeploys(base, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(2000)
    expect((await answer).status).toBe(200)
    expect(n).toBe(2)
  })
})

describe('a write during a deploy', () => {
  test('an answer from Railway\'s edge is held and the write sent again with the same body', async () => {
    const { fetch, calls } = scripted((_call, n) => (n === 1 ? EDGE_502() : OK()))
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/app_actions/dash/decide', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"decision":"approve"}',
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect((await answer).status).toBe(200)
    expect(calls).toEqual([
      { url: '/api/app_actions/dash/decide', method: 'POST', body: '{"decision":"approve"}' },
      { url: '/api/app_actions/dash/decide', method: 'POST', body: '{"decision":"approve"}' },
    ])
  })

  test('a write given as a Request is sent again with its body', async () => {
    const { fetch, calls } = scripted((_call, n) => (n === 1 ? EDGE_502() : OK()))
    const answer = waitThroughDeploys(fetch, { onWaiting })(new Request(here('/api/save'), { method: 'PATCH', body: 'x=1' }))
    await vi.advanceTimersByTimeAsync(2000)
    expect((await answer).status).toBe(200)
    expect(calls.map((c) => c.body)).toEqual(['x=1', 'x=1'])
  })

  test('a network error on a write is passed on at once: the write may have reached the server, so it is never sent twice', async () => {
    let writes = 0
    const base = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/ping')) return OK()
      writes++
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof globalThis.fetch
    const answer = waitThroughDeploys(base, { onWaiting })('/api/save', { method: 'POST', body: '{}' })
    await expect(answer).rejects.toThrow('Failed to fetch')
    expect(writes).toBe(1)
  })
})

describe('what passes through untouched', () => {
  test('Featherbase\'s own 502 and 503 reach the page at once', async () => {
    for (const status of [502, 503]) {
      const { fetch, calls } = scripted(() => new Response('{"error":{"type":"InternalError"}}', { status }))
      const res = await waitThroughDeploys(fetch, { onWaiting })('/api/rows')
      expect(res.status).toBe(status)
      expect(calls).toHaveLength(1)
    }
  })

  test('another site\'s answers are not held, even an edge 502', async () => {
    const base = vi.fn(async () => EDGE_502()) as unknown as typeof globalThis.fetch
    const res = await waitThroughDeploys(base, { onWaiting })('https://app.motherduck.com/api/x')
    expect(res.status).toBe(502)
    expect(base).toHaveBeenCalledTimes(1)
  })

  test('a same-site address outside /api is not held', async () => {
    const base = vi.fn(async () => EDGE_502()) as unknown as typeof globalThis.fetch
    const res = await waitThroughDeploys(base, { onWaiting })('/featherbase/assets/app.js')
    expect(res.status).toBe(502)
    expect(base).toHaveBeenCalledTimes(1)
  })
})

describe('waiting together', () => {
  test('several held requests share one ping a second, and all go once it answers', async () => {
    let up = false
    const { fetch, calls, pings } = scripted(() => (up ? OK() : EDGE_502()), () => up)
    const wrapped = waitThroughDeploys(fetch, { onWaiting })
    const answers = [wrapped('/api/a'), wrapped('/api/b'), wrapped('/api/c')]
    await vi.advanceTimersByTimeAsync(3500)
    expect(pings.length).toBeGreaterThanOrEqual(3)
    expect(pings.length).toBeLessThanOrEqual(4)
    up = true
    await vi.advanceTimersByTimeAsync(1100)
    expect((await Promise.all(answers)).map((r) => r.status)).toEqual([200, 200, 200])
    expect(calls).toHaveLength(6)
  })

  test('a held request whose page gave up on it is not sent again', async () => {
    const { fetch, calls } = scripted(() => EDGE_502(), () => false)
    const controller = new AbortController()
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/rows', { signal: controller.signal })
    const settled = answer.catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(1500)
    controller.abort()
    await vi.advanceTimersByTimeAsync(3000)
    expect((await settled as Error).name).toBe('AbortError')
    expect(calls).toHaveLength(1)
  })
})

describe('the notice', () => {
  test('shows once a request has been held a second, and goes when it goes through', async () => {
    let up = false
    const { fetch } = scripted(() => (up ? OK() : EDGE_502()), () => up)
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(900)
    expect(notices).toEqual([])
    await vi.advanceTimersByTimeAsync(300)
    expect(notices).toEqual([true])
    up = true
    await vi.advanceTimersByTimeAsync(1100)
    await answer
    expect(notices).toEqual([true, false])
  })

  test('a gap shorter than a second shows nothing', async () => {
    const { fetch } = scripted((_call, n) => (n === 1 ? EDGE_502() : OK()))
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(2000)
    await answer
    expect(notices).toEqual([])
  })
})

describe('giving up', () => {
  test('after 90 seconds the request fails as it would have, and the notice goes', async () => {
    const { fetch } = scripted(() => EDGE_502(), () => false)
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(89_000)
    expect(notices).toEqual([true])
    await vi.advanceTimersByTimeAsync(2_000)
    const res = await answer
    expect(res.status).toBe(502)
    expect(notices).toEqual([true, false])
  })
})

describe('installing on a page', () => {
  test('wraps the page\'s fetch once, however often it is installed, and draws the notice in its own shadow root', async () => {
    const win = { fetch: scripted(() => EDGE_502(), () => false).fetch, location: window.location } as unknown as Window & typeof globalThis
    installDeployWait(win, document)
    const once = win.fetch
    installDeployWait(win, document)
    expect(win.fetch).toBe(once)
    void win.fetch('/api/rows').catch(() => {})
    await vi.advanceTimersByTimeAsync(1200)
    const host = document.querySelector('featherbase-updating')!
    expect(host).not.toBeNull()
    const status = host.shadowRoot!.querySelector('[role="status"]')!
    expect(status.textContent).toBe(NOTICE_TEXT)
    expect(status.getAttribute('aria-live')).toBe('polite')
  })

  test('the notice takes its colours from the page\'s own tokens, so it reads on light and dark pages', async () => {
    const win = { fetch: scripted(() => EDGE_502(), () => false).fetch, location: window.location } as unknown as Window & typeof globalThis
    installDeployWait(win, document)
    void win.fetch('/api/rows').catch(() => {})
    await vi.advanceTimersByTimeAsync(1200)
    const css = document.querySelector('featherbase-updating')!.shadowRoot!.querySelector('style')!.textContent!
    expect(css).toContain('background: var(--color-ink)')
    expect(css).toContain('color: var(--color-surface)')
  })
})
