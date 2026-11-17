// The #1259 flake was a real bug: a link picker searched before it knew the
// target Table's title column, so on a slow connection its options were bare
// row ids ("TN", "KL") until (or, on CI, unless) the details arrived. It now
// says Loading… until it knows how to name the rows.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { REGION, SITE, seedSites } from './relational-fixture'
import { api } from '../src/lib/api'

configure({ asyncUtilTimeout: 10_000 })

test("a link picker never shows bare ids while its Table's details are still on their way", async ({ admin }) => {
  await seedSites(admin)
  let release!: () => void
  const held = new Promise<void>((done) => { release = done })
  const get = api.get.bind(api)
  const spy = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (decodeURIComponent(path).includes(`${REGION}:meta`)) await held
    return get(path)
  })
  try {
    await renderApp(tableHref(SITE), admin)
    fireEvent.click(await screen.findByTestId('filter-toggle'))
    fireEvent.change(await screen.findByTestId('filter-field'), { target: { value: 'region' } })
    fireEvent.focus(screen.getByTestId('filter-value'))
    const list = await screen.findByTestId('link-options-region')
    expect(within(list).getByTestId('link-options-loading')).toBeInTheDocument()
    // Long enough for a search to have answered, had it run.
    await new Promise((done) => setTimeout(done, 600))
    expect(within(list).queryAllByTestId('link-option')).toHaveLength(0)
    release()
    await waitFor(() => expect(within(list).getByRole('button', { name: 'Kerala' })).toBeInTheDocument())
    expect(list).not.toHaveTextContent(/\bKL\b|\bTN\b/)
  } finally {
    spy.mockRestore()
  }
})

// An older search that fails after a newer one answered changes nothing.
test('a stale search that fails late never empties the newer answer', async ({ admin }) => {
  await seedSites(admin)
  let failOld!: () => void
  const oldHeld = new Promise<void>((done) => { failOld = done })
  const real = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const text = decodeURIComponent(String(url))
    if (text.includes(REGION) && text.includes('"%k%"')) {
      await oldHeld
      return new Response(JSON.stringify({ error: { type: 'InternalError', message: 'late failure' } }), { status: 500, headers: { 'content-type': 'application/json' } })
    }
    return real(url, init)
  })
  try {
    await renderApp(tableHref(SITE), admin)
    fireEvent.click(await screen.findByTestId('filter-toggle'))
    fireEvent.change(await screen.findByTestId('filter-field'), { target: { value: 'region' } })
    fireEvent.focus(screen.getByTestId('filter-value'))
    const list = await screen.findByTestId('link-options-region')
    await waitFor(() => expect(within(list).getAllByTestId('link-option').length).toBeGreaterThan(0))
    const box = within(list).getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'k' } })
    await new Promise((done) => setTimeout(done, 300))
    fireEvent.change(box, { target: { value: 'ke' } })
    await waitFor(() => expect(within(list).getByRole('button', { name: 'Kerala' })).toBeInTheDocument())
    failOld()
    await new Promise((done) => setTimeout(done, 300))
    expect(within(list).getByRole('button', { name: 'Kerala' })).toBeInTheDocument()
  } finally {
    spy.mockRestore()
  }
})
