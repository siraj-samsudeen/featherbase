// #1260: wait out a deploy instead of showing it. The service has a Railway
// volume, so Railway stops the old server before the new one serves; for
// about 11 s its edge answers 502 itself, marked `x-railway-fallback: true`
// (measured on dev, 17-Nov-2026). Featherbase's own answers never carry that
// mark, so only the edge's are held. Installed by both page entries: the
// platform's (main.tsx) and the shared bar every app page loads (bar/main.tsx).

export const NOTICE_TEXT = 'Updating to the latest version. Back in a few seconds.'
/** What a write the edge answered fails with, once the server is back. */
export const INTERRUPTED_WRITE = 'The app was updating when this change was sent, so it may not have been saved. Check, then try again.'

const EDGE_STATUSES = new Set([502, 503, 504])
const READS = new Set(['GET', 'HEAD'])
// An app's declared read is sent as a POST (it carries a payload), but the
// server runs it writing nothing (runtime-actions.ts, #1254), so it is retried
// like a GET (Codex round 2: Dash's reports). Its sibling, app_actions, is a write.
const APP_READ = /^\/api\/app_reads\/[^/]+\/[^/]+$/

interface Options {
  /** Told true once a request has been held `noticeAfterMs`, false when none is. */
  onWaiting: (waiting: boolean) => void
  pingPath?: string
  firstPollMs?: number
  pollMs?: number
  /** A ping not answered by then is dropped and asked again. */
  pingTimeoutMs?: number
  /** A request pending this long makes the page check the server is reachable. */
  suspectAfterMs?: number
  /** A reachability ping not answered by then means the server is not reachable. */
  reachTimeoutMs?: number
  noticeAfterMs?: number
  giveUpMs?: number
}

type Fetch = typeof globalThis.fetch

const abortError = () => new DOMException('The operation was aborted.', 'AbortError')

/** `base`, except that a same-site `/api/...` request answered by Railway's
 *  edge (or, for a read, failing on the network) is held until the server
 *  answers its ping. A read is then sent again; after `giveUpMs` it fails as
 *  before. A write is never sent twice (Codex, #1260): the edge's mark says
 *  who answered, not that Featherbase never ran it, since Railway answers 502
 *  for a slow app too. It waits out the gap, then fails with INTERRUPTED_WRITE
 *  in Featherbase's own error shape, which every page already shows. */
export function waitThroughDeploys(base: Fetch, options: Options): Fetch {
  const { onWaiting, pingPath = '/api/ping', firstPollMs = 250, pollMs = 1000, pingTimeoutMs = 5000, suspectAfterMs = 3000, reachTimeoutMs = 2000, noticeAfterMs = 1000, giveUpMs = 90_000 } = options
  // Every held request waits on the same ping, so a gap is asked about once a
  // second, not once per request.
  const held = new Set<{ since: number }>()
  let back: Promise<void> | null = null
  let noticeShown = false
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  // During the gap Railway's edge holds a request ~15 s before its 502 (dev,
  // 17-Nov-2026), so a hang must show the notice too. A request pending
  // `suspectAfterMs` makes the page ping; a ping (normally well under a
  // second) that gets no answer from Featherbase in `reachTimeoutMs` means the
  // server is not reachable. A long report with a quick ping shows nothing.
  let inFlight = 0
  let unreachable = false
  let checking = false

  const refreshNotice = () => {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = null
    if (!held.size && !unreachable) {
      if (noticeShown) onWaiting((noticeShown = false))
      return
    }
    if (noticeShown) return
    if (unreachable) return onWaiting((noticeShown = true))
    const oldest = Math.min(...[...held].map((h) => h.since))
    const due = oldest + noticeAfterMs - Date.now()
    if (due <= 0) onWaiting((noticeShown = true))
    else noticeTimer = setTimeout(refreshNotice, due)
  }

  /** One ping, its own timer (not AbortSignal.timeout, so one clock drives
   *  it in tests): true when Featherbase itself answered it. */
  const ping = async (timeoutMs: number): Promise<boolean> => {
    const stalled = new AbortController()
    const timer = setTimeout(() => stalled.abort(), timeoutMs)
    const answer = await base(pingPath, { cache: 'no-store', signal: stalled.signal }).catch(() => null)
    clearTimeout(timer)
    return Boolean(answer?.ok && answer.headers.get('x-railway-fallback') !== 'true')
  }

  const reachable = () => {
    if (!unreachable) return
    unreachable = false
    refreshNotice()
  }

  const checkReachable = async () => {
    if (checking) return
    checking = true
    try {
      for (;;) {
        if (await ping(reachTimeoutMs)) return reachable()
        if (!inFlight && !held.size) return reachable()
        if (!unreachable) {
          unreachable = true
          refreshNotice()
        }
        await new Promise((r) => setTimeout(r, pollMs))
        if (!inFlight && !held.size) return reachable()
      }
    } finally {
      checking = false
    }
  }

  const serverBack = (): Promise<void> => {
    back ??= new Promise<void>((resolve) => {
      // Asked every `firstPollMs` until the notice would show, then every
      // `pollMs`: a blip under a second ends before the notice (verifier, #1260).
      const started = Date.now()
      const next = () => (Date.now() - started < noticeAfterMs ? firstPollMs : pollMs)
      const ask = (delay: number) => {
        setTimeout(async () => {
          if (await ping(pingTimeoutMs)) {
            back = null
            resolve()
          } else if (held.size) ask(next())
          else back = null
        }, delay)
      }
      ask(firstPollMs)
    })
    return back
  }

  return async function fetchThroughDeploys(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return base(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const read = READS.has(method) || (method === 'POST' && APP_READ.test(url.pathname))
    // A body that is a stream can be sent only once; such a request is not held.
    if (init?.body instanceof ReadableStream) return base(input, init)
    // A Request's body is consumed by sending it, so each try sends a copy.
    const template = input instanceof Request ? input.clone() : null
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    // One try, then (if Railway's edge answered, or a read failed on the
    // network) a wait until the server answers its ping, then one more try
    // whose outcome is the page's. Bounded at two: a read cut on the network
    // while the server answers is not a deploy (CI, Tasker's sign-in
    // fallback), and was resent for 90 s when this was a loop.
    const attempt = async (): Promise<{ answer: Response } | { error: unknown }> => {
      inFlight++
      const watch = setTimeout(() => void checkReachable(), suspectAfterMs)
      try {
        return { answer: await base(template ? template.clone() : input, init) }
      } catch (error) {
        return { error }
      } finally {
        clearTimeout(watch)
        inFlight--
      }
    }
    const first = await attempt()
    if ('answer' in first && !fromEdge(first.answer)) {
      // Featherbase itself answered: it is reachable.
      reachable()
      return first.answer
    }
    // A write that failed on the network may have reached the server: it is
    // passed on, never sent twice. A page that gave up gets its own abort.
    if ('error' in first && (!read || signal?.aborted)) throw first.error
    const entry = { since: Date.now() }
    held.add(entry)
    refreshNotice()
    try {
      const outcome = await new Promise<'back' | 'late' | 'aborted'>((resolve) => {
        const finish = (result: 'back' | 'late' | 'aborted') => {
          clearTimeout(late)
          signal?.removeEventListener('abort', onAbort)
          resolve(result)
        }
        const onAbort = () => finish('aborted')
        const late = setTimeout(() => finish('late'), giveUpMs)
        signal?.addEventListener('abort', onAbort, { once: true })
        void serverBack().then(() => finish('back'))
      })
      if (outcome === 'aborted') throw abortError()
      if ('error' in first) {
        if (outcome === 'late') throw first.error
      } else if (!read || outcome === 'late') {
        return read ? first.answer : interruptedWrite()
      }
    } finally {
      held.delete(entry)
      refreshNotice()
    }
    const second = await attempt()
    if ('error' in second) throw second.error
    if (!fromEdge(second.answer)) reachable()
    return second.answer
  }
}

/** An answer Railway's edge made itself (the server did not answer). */
function fromEdge(answer: Response): boolean {
  return EDGE_STATUSES.has(answer.status) && answer.headers.get('x-railway-fallback') === 'true'
}

function interruptedWrite(): Response {
  return new Response(JSON.stringify({ error: { type: 'ServiceUnavailableError', message: INTERRUPTED_WRITE } }), {
    status: 503, headers: { 'content-type': 'application/json' },
  })
}

const INSTALLED = Symbol.for('featherbase.deploy-wait')
const NOTICE_TAG = 'featherbase-updating'

/** Wrap the page's fetch (once) and draw the notice while a deploy is waited out. */
export function installDeployWait(win: Window & typeof globalThis, doc: Document): void {
  const marked = win as unknown as Record<symbol, boolean>
  if (marked[INSTALLED]) return
  marked[INSTALLED] = true
  win.fetch = waitThroughDeploys(win.fetch.bind(win), {
    onWaiting: (waiting) => (waiting ? showNotice(doc) : hideNotice(doc)),
  })
}

// Its own shadow root: an app's styles never reach the notice, and the
// notice's never reach the app.
// Colours are the page's own Shop Floor tokens (every page loads them, and
// custom properties reach into a shadow root), inverted: ink behind, surface
// in front, so the notice reads on a light page and a dark one alike.
const NOTICE_STYLE = `
:host { position: fixed; left: 0; right: 0; bottom: 24px; display: flex; justify-content: center; pointer-events: none; z-index: 2147483647; }
.pill { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 999px; font: 500 14px/1.3 var(--font-sans, system-ui, sans-serif); background: var(--color-ink); color: var(--color-surface); box-shadow: 0 6px 24px color-mix(in srgb, var(--color-ink) 22%, transparent); max-width: calc(100vw - 32px); }
.spinner { width: 14px; height: 14px; flex: none; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin .8s linear infinite; opacity: .8; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
`

function showNotice(doc: Document) {
  hideNotice(doc)
  const host = doc.createElement(NOTICE_TAG)
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>${NOTICE_STYLE}</style><div class="pill" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span class="text"></span></div>`
  doc.body.append(host)
  // Written after the live region exists, so a screen reader announces it.
  root.querySelector('.text')!.textContent = NOTICE_TEXT
}

function hideNotice(doc: Document) {
  doc.querySelector(NOTICE_TAG)?.remove()
}
