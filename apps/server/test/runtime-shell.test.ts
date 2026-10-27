// #650 (design D3): an installed app's entry document gets the platform's
// shared top bar. The server adds only a host element, first in the body, and
// the platform's bar script; the bar itself is drawn in the browser by the
// web app's bar bundle, never by app code (ADR 0011).
import { describe, expect, test } from 'vitest'
import { composeRuntimeShell } from '../src/runtime-shell'

const app = { name: 'notes', title: 'Notes' }

describe("an app's entry document", () => {
  test("the bar's host is the body's first element and names the app", () => {
    const html = composeRuntimeShell('<html><head></head><body class="x"><main>app</main></body></html>', app)
    expect(html).toContain('<body class="x"><featherbase-bar data-app="notes" data-title="Notes"></featherbase-bar><main>app</main>')
  })

  test("the app's title is escaped in the host", () => {
    const html = composeRuntimeShell('<body></body>', { name: 'notes', title: `Notes & "<O'Brien>"` })
    expect(html).toContain('data-title="Notes &amp; &quot;&lt;O&#39;Brien&gt;&quot;"')
  })

  test("the platform's bar script is loaded as a module at the end of the head", () => {
    const html = composeRuntimeShell('<html><head><title>t</title></head><body></body></html>', app)
    expect(html).toContain('<title>t</title><script type="module" src="/featherbase/bar.js"></script></head>')
  })

  test('a document without head or body still gets the script and the host first', () => {
    const html = composeRuntimeShell('<main>bare</main>', app)
    expect(html).toBe('<script type="module" src="/featherbase/bar.js"></script><featherbase-bar data-app="notes" data-title="Notes"></featherbase-bar><main>bare</main>')
  })

  test("the old runtime-shell header is gone", () => {
    const html = composeRuntimeShell('<html><head></head><body></body></html>', app)
    expect(html).not.toMatch(/runtime-shell|<select|Switch application/)
  })
})
