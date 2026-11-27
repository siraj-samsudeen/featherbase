// #1409: the Store Sales fixture app's own page (test-apps/fixtures/
// stand-in-proof/client/index.html), opened in jsdom the way the server serves
// it: the shared bar's host first in the body, then the page's own markup, and
// the page's own script run unchanged. The script is the fixture's, read from
// its file, so these tests show what the platform draws around a page that
// knows nothing about stand-ins.
import { readFileSync } from 'node:fs'
import { act, within } from '@testing-library/react'
import { afterEach, beforeAll } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { FIXTURE } from 'server/test/stand-in-fixture'
import { setSession } from '../src/lib/api'
import { mountBar } from '../src/bar/mount'
import { forgetStandIns, installStandInMark } from '../src/lib/stand-in-mark'

const PAGE = new DOMParser().parseFromString(readFileSync(`${FIXTURE}/client/index.html`, 'utf8'), 'text/html')
const MARKUP = PAGE.querySelector('main')!.outerHTML
const SCRIPT = PAGE.querySelector('script[type="module"]')!.textContent!
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (fetch: typeof globalThis.fetch) => Promise<void>

let mounted: { unmount: () => void } | undefined

/** The platform's fetch wrapper, installed over the in-process server's bridge
 *  as a page entry installs it over the browser's fetch, and nothing
 *  remembered or mounted from one test to the next. */
export function useStandInMark() {
  beforeAll(() => installStandInMark(window))
  afterEach(() => {
    act(() => mounted?.unmount())
    mounted = undefined
    document.body.replaceChildren()
    window.history.replaceState(null, '', '/')
    forgetStandIns()
  })
}

/** Run the page's own script, as `as`. A browser sends the person's session
 *  cookie with the page's requests; here their token stands in for it. */
export async function loadStoreSales(as: TestClient) {
  const signedIn: typeof globalThis.fetch = (input, init) =>
    fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${as.token}` } })
  await act(() => new AsyncFunction('fetch', SCRIPT)(signedIn))
}

/** Open the Store Sales page at `path` as `as`: the bar mounted on its host,
 *  the page's markup, and its script run. Answers the bar (its shadow root). */
export async function openStoreSales(as: TestClient, path = '/storesales/', leave: (href: string) => void = () => {}) {
  window.history.replaceState(null, '', path)
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  const host = document.createElement('featherbase-bar')
  host.dataset.app = 'storesales'
  host.dataset.title = 'Store Sales'
  document.body.innerHTML = MARKUP
  document.body.prepend(host)
  mounted = mountBar(host, { leave })
  await loadStoreSales(as)
  return within(host.shadowRoot as unknown as HTMLElement)
}

/** A table of the page (Sales, Targets) as rows of cell text, or null when the page shows none. */
export function pageTable(section: 'sales' | 'targets'): string[][] | null {
  const shown = document.getElementById(section)
  if (!shown || shown.hidden) return null
  return [...shown.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''))
}
