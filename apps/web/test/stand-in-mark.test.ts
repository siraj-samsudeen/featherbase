// #1409 (design D6): what a page was told about stand-ins. The server names
// the stand-ins a response carried in one header; lib/stand-in-mark.ts wraps
// the page's fetch, reads the header and remembers it per page, for the line
// under the top bar. These tests drive the wrapper with a scripted fetch; the
// line itself, against the real server, is stand-in-line.test.tsx.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { STAND_IN_HEADER, standInHeaderValue, type StandInServed } from 'shared'
import { forgetStandIns, installStandInMark, markStandIns, recordStandIns, useStandIns } from '../src/lib/stand-in-mark'

const TARGETS: StandInServed = { app: 'storesales', dataset: 'targets', loaded_at: '2026-11-27T06:28:27.434Z', note: 'From the planning workbook', expected_by: '2026-12-15' }
const SALES: StandInServed = { app: 'storesales', dataset: 'sales', loaded_at: '2026-11-26T04:00:00.000Z', note: null, expected_by: null }

const answer = (standIns: StandInServed[] = [], status = 200) => new Response('{"result":1}', {
  status, headers: standIns.length ? { [STAND_IN_HEADER]: standInHeaderValue(standIns) } : {},
})
const here = (path: string) => new URL(path, window.location.href).href
/** A wrapped fetch whose answers come from `next`, and what it remembered. */
function marked(next: () => Response) {
  const seen: [string, string, readonly StandInServed[]][] = []
  const fetch = markStandIns(vi.fn(async () => next()) as unknown as typeof globalThis.fetch, (...told) => seen.push(told))
  return { fetch, seen }
}

afterEach(() => {
  forgetStandIns()
  window.history.replaceState(null, '', '/')
})

describe('reading the header off an answer', () => {
  test('an answer that carried stand-in rows is remembered under the page it arrived on, and passed on unread', async () => {
    window.history.replaceState(null, '', '/storesales/')
    const { fetch, seen } = marked(() => answer([TARGETS]))
    const res = await fetch('/api/app_reads/storesales/overview?x=1', { method: 'post', body: '{"payload":{}}' })
    expect(await res.json()).toEqual({ result: 1 })
    expect(seen).toEqual([['/storesales/', 'POST /api/app_reads/storesales/overview?x=1 {"payload":{}}', [TARGETS]]])
  })

  test('an answer with no header says the request carried none', async () => {
    const { fetch, seen } = marked(() => answer())
    await fetch(here('/api/datasets'))
    expect(seen).toEqual([['/', 'GET /api/datasets ', []]])
  })

  test('a request given as a Request is named by its own method and address', async () => {
    const { fetch, seen } = marked(() => answer([SALES]))
    await fetch(new Request(here('/api/app_reads/storesales/sales'), { method: 'POST', body: '{}' }))
    expect(seen).toEqual([['/', 'POST /api/app_reads/storesales/sales ', [SALES]]])
  })

  test('a body that is not text is left out of the request\'s name', async () => {
    const { fetch, seen } = marked(() => answer())
    await fetch('/api/upload', { method: 'POST', body: new FormData() })
    expect(seen).toEqual([['/', 'POST /api/upload ', []]])
  })

  test('an error answer carried no rows, so it clears nothing', async () => {
    const { fetch, seen } = marked(() => answer([], 503))
    expect((await fetch('/api/app_reads/storesales/overview')).status).toBe(503)
    expect(seen).toEqual([])
  })

  test('another site\'s answer, and an address outside /api, are not read', async () => {
    const { fetch, seen } = marked(() => answer([TARGETS]))
    await fetch('https://elsewhere.example/api/app_reads/storesales/overview')
    await fetch('/storesales/assets/main.js')
    expect(seen).toEqual([])
  })

  test('a header that cannot be read names no stand-in', async () => {
    const { fetch, seen } = marked(() => new Response('{}', { headers: { [STAND_IN_HEADER]: '%7Bnot-a-list' } }))
    await fetch('/api/datasets')
    expect(seen).toEqual([['/', 'GET /api/datasets ', []]])
  })
})

describe('what a page remembers', () => {
  const shown = (pathname: string) => renderHook(({ at }) => useStandIns(at), { initialProps: { at: pathname } })

  test('each dataset is shown once, in name order, whichever requests carried it', () => {
    const page = shown('/storesales/')
    expect(page.result.current).toEqual([])
    act(() => {
      recordStandIns('/storesales/', 'POST overview', [TARGETS, SALES])
      recordStandIns('/storesales/', 'POST ask', [TARGETS])
    })
    expect(page.result.current).toEqual([SALES, TARGETS])
  })

  test('a dataset loaded again is shown by its latest load', () => {
    const again = { ...TARGETS, loaded_at: '2026-11-28T03:00:00.000Z', note: 'Second draft' }
    const page = shown('/storesales/')
    act(() => {
      recordStandIns('/storesales/', 'POST ask', [again])
      recordStandIns('/storesales/', 'POST overview', [TARGETS])
    })
    expect(page.result.current).toEqual([again])
  })

  test('a request answered again without stand-in rows clears only what it said', () => {
    const page = shown('/storesales/')
    act(() => {
      recordStandIns('/storesales/', 'POST overview', [TARGETS])
      recordStandIns('/storesales/', 'POST sales', [SALES])
    })
    act(() => recordStandIns('/storesales/', 'POST overview', []))
    expect(page.result.current).toEqual([SALES])
    act(() => recordStandIns('/storesales/', 'POST sales', []))
    expect(page.result.current).toEqual([])
  })

  test('each page keeps its own: another page shows none, and going back shows what was remembered', () => {
    const page = shown('/storesales/')
    act(() => recordStandIns('/storesales/', 'POST overview', [TARGETS]))
    page.rerender({ at: '/storesales/help' })
    expect(page.result.current).toEqual([])
    page.rerender({ at: '/storesales/' })
    expect(page.result.current).toEqual([TARGETS])
  })

  test('an answer that says what is already remembered changes nothing', () => {
    const page = shown('/storesales/')
    act(() => recordStandIns('/storesales/', 'POST overview', [TARGETS]))
    const before = page.result.current
    act(() => {
      recordStandIns('/storesales/', 'POST overview', [{ ...TARGETS }])
      recordStandIns('/storesales/', 'GET nothing', [])
    })
    expect(page.result.current).toBe(before)
  })
})

test('the wrapper is installed over the page\'s fetch once, however many entries load', async () => {
  const base = vi.fn(async () => answer([TARGETS]))
  const win = { fetch: base } as unknown as Window & typeof globalThis
  installStandInMark(win)
  const first = win.fetch
  installStandInMark(win)
  expect(win.fetch).toBe(first)
  const page = renderHook(() => useStandIns('/'))
  await act(async () => { await win.fetch('/api/app_reads/storesales/overview') })
  expect(base).toHaveBeenCalledTimes(1)
  expect(page.result.current).toEqual([TARGETS])
})
