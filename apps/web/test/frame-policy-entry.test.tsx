// #642 (E4): a page with a frame policy of its own (the Sales Target report)
// is entered by a full load, so the document carries the policy the server
// set for it. jsdom does not say where its document was loaded; here the
// browser says it was the Admin, and jsdom reports the full load it cannot do.
import { waitFor } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

afterEach(() => vi.restoreAllMocks())

test('entering the Sales Target report from a document loaded at the Admin loads the report in full', async ({ admin }) => {
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ name: 'http://localhost/featherbase/admin' } as PerformanceEntry])
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await renderApp('/featherbase/sales-target', admin)
  await waitFor(() => expect(errors.mock.calls.some((c) => /Not implemented: navigation/.test(String((c[0] as Error)?.message ?? c[0])))).toBe(true))
})
