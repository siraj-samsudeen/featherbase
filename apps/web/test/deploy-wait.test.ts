// #1260: a deploy's gap is waited out, not shown. The production service has
// a volume, so Railway stops the old server before the new one serves, and for
// ~11 s its edge answers 502 itself (x-railway-fallback: true). These tests
// drive the wrapper with a scripted fetch and fake timers.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDeployWait, waitThroughDeploys, NOTICE_TEXT, INTERRUPTED_WRITE } from '../src/lib/deploy-wait'

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
    let up = false
    const { fetch, calls } = scripted(() => (up ? OK('{"rows":[1]}') : EDGE_502()), () => up)
    const wrapped = waitThroughDeploys(fetch, { onWaiting })
    const answer = wrapped('/api/rows')
    await vi.advanceTimersByTimeAsync(3000)
    up = true
    await vi.advanceTimersByTimeAsync(1100)
    const res = await answer
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rows: [1] })
    expect(calls).toHaveLength(2)
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
  // Codex (#1260): x-railway-fallback says the edge wrote the answer, not that
  // Featherbase never ran the request (Railway answers 502 for a slow app
  // too). A write is never sent twice: it waits out the gap, then fails clearly.
  test('a write answered by the edge is never sent again: it waits out the gap with the notice, then fails with a clear message', async () => {
    let up = false
    const { fetch, calls } = scripted(() => (up ? OK() : EDGE_502()), () => up)
    let settled = false
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/app_actions/dash/decide', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"decision":"approve"}',
    }).finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(3000)
    expect(settled).toBe(false)
    expect(notices).toEqual([true])
    up = true
    await vi.advanceTimersByTimeAsync(1100)
    const res = await answer
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: { type: 'ServiceUnavailableError', message: INTERRUPTED_WRITE } })
    expect(calls).toHaveLength(1)
    expect(notices).toEqual([true, false])
  })

  test('a read given as a Request is sent again', async () => {
    const { fetch, calls } = scripted((_call, n) => (n === 1 ? EDGE_502() : OK()))
    const answer = waitThroughDeploys(fetch, { onWaiting })(new Request(here('/api/rows')))
    await vi.advanceTimersByTimeAsync(2000)
    expect((await answer).status).toBe(200)
    expect(calls).toHaveLength(2)
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

describe('an app read, which apps send as a POST', () => {
  // Codex round 2 (#1260): Dash loads its reports with POST /api/app_reads/dash/<read>.
  // The server runs a declared read with no writes, so it is retried like a GET.
  test('is held and sent again with its body, so the report loads after the gap', async () => {
    const { fetch, calls } = scripted((_call, n) => (n === 1 ? EDGE_502() : OK('{"answer":{"rows":[]}}')))
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/app_reads/dash/team_report', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{"payload":{"store":"LKS"}}',
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect((await answer).status).toBe(200)
    expect(calls).toEqual([
      { url: '/api/app_reads/dash/team_report', method: 'POST', body: '{"payload":{"store":"LKS"}}' },
      { url: '/api/app_reads/dash/team_report', method: 'POST', body: '{"payload":{"store":"LKS"}}' },
    ])
  })

  test('an app action, its sibling, is still never sent twice', async () => {
    const { fetch, calls } = scripted((_call, n) => (n === 1 ? EDGE_502() : OK()))
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/app_actions/dash/decide', { method: 'POST', body: '{}' })
    await vi.advanceTimersByTimeAsync(2000)
    expect((await answer).status).toBe(503)
    expect(calls).toHaveLength(1)
  })
})

describe('a ping that never answers', () => {
  // Codex round 2 (#1260): a stalled ping froze the shared check, so every later read waited the full 90 s.
  test('is given up after a few seconds and asked again, so the held read goes once the server is back', async () => {
    let pingCalls = 0
    const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname
      if (path === '/api/ping') {
        pingCalls++
        if (pingCalls === 1) return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
        return Promise.resolve(OK())
      }
      return Promise.resolve(pingCalls >= 2 ? OK() : EDGE_502())
    }) as unknown as typeof globalThis.fetch
    const answer = waitThroughDeploys(base, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await answer).status).toBe(200)
    expect(pingCalls).toBeGreaterThanOrEqual(2)
  })
})

describe('a failure that is not a deploy', () => {
  // CI (#1260, Tasker's journey): a read cut on the network while the server
  // answers its ping is not a deploy. It was held and resent for 90 s, so the
  // page never showed its own "Sign in" fallback. Once the ping says the server
  // is back, a request gets one more try; a second failure is the page's.
  test('a read that fails on the network while the server answers its ping fails after one retry', async () => {
    let reads = 0
    const base = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input), window.location.href).pathname === '/api/ping') return OK()
      reads++
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof globalThis.fetch
    const answer = waitThroughDeploys(base, { onWaiting })('/api/whoami').catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await answer).toBeInstanceOf(TypeError)
    expect(reads).toBe(2)
    expect(notices).toEqual([])
  })

  test('a read the edge answers again after the server is back is passed on, not held for 90 s', async () => {
    const { fetch, calls } = scripted(() => EDGE_502(), () => true)
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/slow_report')
    await vi.advanceTimersByTimeAsync(1000)
    expect((await answer).status).toBe(502)
    expect(calls).toHaveLength(2)
  })
})

describe('the remaining paths', () => {
  const hangingPing = (init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })

  test('a slow request that answers while its reachability check is out shows nothing', async () => {
    const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), window.location.href).pathname === '/api/ping') return hangingPing(init)
      return new Promise<Response>((resolve) => setTimeout(() => resolve(OK()), 4000))
    }) as unknown as typeof globalThis.fetch
    const answer = waitThroughDeploys(base, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(6000)
    expect((await answer).status).toBe(200)
    expect(notices).toEqual([])
  })

  test('the notice shown during a hang goes when the answer comes, and the check stops', async () => {
    let pings = 0
    const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), window.location.href).pathname === '/api/ping') { pings++; return hangingPing(init) }
      return new Promise<Response>((resolve) => setTimeout(() => resolve(OK()), 5500))
    }) as unknown as typeof globalThis.fetch
    const answer = waitThroughDeploys(base, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(5200)
    expect(notices).toEqual([true])
    await vi.advanceTimersByTimeAsync(800)
    expect((await answer).status).toBe(200)
    expect(notices).toEqual([true, false])
    const asked = pings
    await vi.advanceTimersByTimeAsync(10_000)
    expect(pings).toBe(asked)
  })

  test('two slow requests share one reachability check', async () => {
    let pings = 0
    const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), window.location.href).pathname === '/api/ping') { pings++; return hangingPing(init) }
      return new Promise<Response>((resolve) => setTimeout(() => resolve(OK()), 4000))
    }) as unknown as typeof globalThis.fetch
    const wrapped = waitThroughDeploys(base, { onWaiting })
    const answers = [wrapped('/api/a'), wrapped('/api/b')]
    await vi.advanceTimersByTimeAsync(3500)
    expect(pings).toBe(1)
    await vi.advanceTimersByTimeAsync(3000)
    await Promise.all(answers)
  })

  test('a read whose body is a stream is passed through, since it can be sent only once', async () => {
    const base = vi.fn(async () => EDGE_502()) as unknown as typeof globalThis.fetch
    const body = new ReadableStream({ start(controller) { controller.close() } })
    const res = await waitThroughDeploys(base, { onWaiting })('/api/rows', { method: 'GET', body } as RequestInit)
    expect(res.status).toBe(502)
    expect(base).toHaveBeenCalledTimes(1)
  })

  test('a read cut on the network while the server never comes back fails with its own error after 90 s', async () => {
    const base = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input), window.location.href).pathname === '/api/ping') return EDGE_502()
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof globalThis.fetch
    const answer = waitThroughDeploys(base, { onWaiting })('/api/rows').catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(91_000)
    expect(await answer).toBeInstanceOf(TypeError)
    expect(notices).toEqual([true, false])
  })

  test('an installed page removes the notice when the requests go through', async () => {
    let up = false
    const win = { fetch: scripted(() => (up ? OK() : EDGE_502()), () => up).fetch, location: window.location } as unknown as Window & typeof globalThis
    installDeployWait(win, document)
    const answer = win.fetch('/api/rows')
    await vi.advanceTimersByTimeAsync(1200)
    expect(document.querySelector('featherbase-updating')).not.toBeNull()
    up = true
    await vi.advanceTimersByTimeAsync(1100)
    await answer
    expect(document.querySelector('featherbase-updating')).toBeNull()
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
  test('held requests share one ping: three held ask the server no more often than one', async () => {
    const pingsFor = async (count: number) => {
      let up = false
      const { fetch, calls, pings } = scripted(() => (up ? OK() : EDGE_502()), () => up)
      const wrapped = waitThroughDeploys(fetch, { onWaiting })
      const answers = Array.from({ length: count }, (_, i) => wrapped(`/api/r${i}`))
      await vi.advanceTimersByTimeAsync(3500)
      const asked = pings.length
      up = true
      await vi.advanceTimersByTimeAsync(1100)
      expect((await Promise.all(answers)).every((r) => r.status === 200)).toBe(true)
      expect(calls).toHaveLength(count * 2)
      return asked
    }
    const one = await pingsFor(1)
    const three = await pingsFor(3)
    expect(three).toBe(one)
    expect(one).toBeLessThanOrEqual(7)
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

  // Verifier (#1260): with a ping at 250 ms and then every second, a 0.5 s gap
  // held its requests ~1.25 s and flashed the notice.
  test('a half-second gap shows nothing', async () => {
    let up = false
    setTimeout(() => { up = true }, 500)
    const { fetch } = scripted(() => (up ? OK() : EDGE_502()), () => up)
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(3000)
    expect((await answer).status).toBe(200)
    expect(notices).toEqual([])
  })

  test('a gap shorter than a second shows nothing', async () => {
    const { fetch } = scripted((_call, n) => (n === 1 ? EDGE_502() : OK()))
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(2000)
    await answer
    expect(notices).toEqual([])
  })
})

describe('a request the edge holds before answering', () => {
  // Measured on dev (17-Nov-2026): during the gap Railway's edge holds each
  // request 15 s before its 502, and the server is usually back by then, so
  // the notice must come from the hold itself, not only from the 502.
  test('while it hangs and the ping cannot get through either, the notice shows; it goes when the answer comes', async () => {
    let up = false
    const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname
      if (path === '/api/ping') {
        if (up) return Promise.resolve(OK())
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }
      if (up) return Promise.resolve(OK())
      return new Promise<Response>((resolve) => setTimeout(() => { up = true; resolve(EDGE_502()) }, 15_000))
    }) as unknown as typeof globalThis.fetch
    const answer = waitThroughDeploys(base, { onWaiting })('/api/rows')
    await vi.advanceTimersByTimeAsync(2900)
    expect(notices).toEqual([])
    await vi.advanceTimersByTimeAsync(2500)
    expect(notices).toEqual([true])
    await vi.advanceTimersByTimeAsync(11_000)
    expect(notices).toEqual([true, false])
    expect((await answer).status).toBe(200)
  })

  test('a slow answer while the server answers its ping shows nothing: a long report is not an update', async () => {
    const base = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.href).pathname
      if (path === '/api/ping') return Promise.resolve(OK())
      return new Promise<Response>((resolve) => setTimeout(() => resolve(OK()), 8000))
    }) as unknown as typeof globalThis.fetch
    const answer = waitThroughDeploys(base, { onWaiting })('/api/app_reads/dash/big_report', { method: 'POST', body: '{}' })
    await vi.advanceTimersByTimeAsync(9000)
    expect((await answer).status).toBe(200)
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

describe('a write that waits the full 90 seconds', () => {
  test('fails with the clear message, not the edge\'s 502, and was sent once', async () => {
    const { fetch, calls } = scripted(() => EDGE_502(), () => false)
    const answer = waitThroughDeploys(fetch, { onWaiting })('/api/save', { method: 'POST', body: '{}' })
    await vi.advanceTimersByTimeAsync(91_000)
    const res = await answer
    expect(res.status).toBe(503)
    expect((await res.json()).error.message).toBe(INTERRUPTED_WRITE)
    expect(calls).toHaveLength(1)
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
