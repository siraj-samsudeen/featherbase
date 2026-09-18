// Stand-in for api.motherduck.com + embed-motherduck.com, used ONLY when the
// sales-target spec runs with SALES_TARGET_EMBED=stub. It proves the host
// contract — login, assignment → initial_state, one session per opening,
// isolation between viewers — when a real embed session cannot be minted. It
// renders the initial_state it received as JSON under a "STUB EMBED" banner
// and NEVER rows or amounts, so a stub run can never be mistaken for live
// evidence. Started in-process by the spec; the API server reaches it through
// MOTHERDUCK_API_BASE and the page frames it through MOTHERDUCK_EMBED_ORIGIN.
import { createServer, type Server } from 'node:http'

export interface StubRecord {
  seq: number
  dive_id: string
  username: string
  version: number
  initial_state: unknown
}

export interface Stub {
  log: StubRecord[]
  /** Delay the NEXT embed-session answer by this many milliseconds. */
  setDelay(ms: number): void
  close(): Promise<void>
}

const page = `<!doctype html><html><head><meta charset="utf-8"><title>STUB embed</title></head>
<body style="font-family:monospace;background:#fffbe6;padding:12px">
<h2 data-testid="stub-banner">STUB EMBED — not the MotherDuck report (host-contract check only)</h2>
<pre data-testid="stub-state" style="white-space:pre-wrap"></pre>
<button data-testid="stub-change" type="button">simulate in-report selection change (this session only)</button>
<script>
  var m = /session=([^&]*)/.exec(location.hash);
  var s = m ? JSON.parse(atob(decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/"))) : { error: "no session" };
  var pre = document.querySelector('[data-testid="stub-state"]'); pre.textContent = JSON.stringify(s);
  document.querySelector('[data-testid="stub-change"]').onclick = function () {
    s.initial_state.material_groups.push("999999999"); s.changed = true; pre.textContent = JSON.stringify(s);
  };
</script></body></html>`

export function startStub(port: number): Promise<Stub> {
  const log: StubRecord[] = []
  let delayMs = 0
  let counter = 0
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      if (req.method === 'POST' && /^\/v1\/dives\/[^/]+\/embed-session$/.test(url.pathname)) {
        if (!(req.headers.authorization ?? '').startsWith('Bearer ')) {
          res.writeHead(401, { 'content-type': 'application/json' })
          return res.end(JSON.stringify({ message: 'missing bearer' }))
        }
        const parsed = JSON.parse(body) as { username: string; version: number; initial_state: unknown }
        const record: StubRecord = {
          seq: ++counter,
          dive_id: url.pathname.split('/')[3],
          username: parsed.username,
          version: parsed.version,
          initial_state: parsed.initial_state,
        }
        log.push(record)
        const session = Buffer.from(JSON.stringify(record)).toString('base64url')
        const wait = delayMs
        delayMs = 0
        return setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ session }))
        }, wait)
      }
      if (req.method === 'GET' && url.pathname === '/sandbox/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(page)
      }
      res.writeHead(404)
      res.end()
    })
  })
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () =>
      resolve({
        log,
        setDelay: (ms) => {
          delayMs = ms
        },
        close: () => new Promise((r) => server.close(() => r())),
      }),
    ),
  )
}
