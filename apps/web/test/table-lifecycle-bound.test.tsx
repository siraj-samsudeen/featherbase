// docs/specs/0007-table-lifecycle.md — the row lifecycle against a SOURCE-BOUND
// table, which the browser journeys deliberately leave alone (they use plain
// local tables).
//
// Two claims that only a binding can make, and both were review findings on
// #258 rather than things the original journeys could have caught:
//
//   TLC-R3.bound  — a writable binding refuses a delete that omits the loaded
//                   revision, so the form must echo it or the button is
//                   decorative. Asserted on the WIRE (the DELETE URL) and on
//                   the OUTCOME (the row is actually gone).
//   TLC-R1.bound  — a read-only binding owns its rows, so the create
//                   affordance is absent (EDS-13: absent, not disabled).
//
// A csv-folder source is the cheapest real fixture for both: it is writable,
// its pk is positional (`_row`), and it maps file mtime to updated_at — which
// is exactly the class where a missing revision deletes the wrong row.
import { screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { invalidateSources } from 'server/src/sources/registry'
import type { TestClient } from 'feather-testing-postgres'
import { test, expect, renderApp } from './pg-test'

let dir: string

const STORES = `store_code,store_name,city
KKL,Karaikal,Karaikal
TVM,Thiruvananthapuram,TVM
`

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fb-lifecycle-'))
})
beforeEach(() => {
  writeFileSync(path.join(dir, 'store_master.csv'), STORES)
})
afterAll(() => {
  invalidateSources()
  rmSync(dir, { recursive: true, force: true })
})

/** Reflect the fixture folder as a bound Table at the given access level. */
async function bindCsv(admin: TestClient, access: 'read_write' | 'read_only'): Promise<string> {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', {
    row_id: 'lifecycle-fixture',
    engine: 'csv-folder',
    root_path: dir,
    access,
  })
  const res = await admin.fetch('/api/table/Data%20Source/lifecycle-fixture:reflect', {
    method: 'POST',
    body: JSON.stringify({ tables: ['store_master.csv'] }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { created: { name: string }[] }
  return body.created[0].name
}

/** Record the DELETE URLs the UI sends, letting them through to the server. */
function recordDeletes(): string[] {
  const urls: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.method === 'DELETE') urls.push(url)
    return real(input, init)
  })
  return urls
}

test('TLC-R3.bound: deleting a bound row echoes the loaded revision, so the delete actually lands', async ({
  admin,
}) => {
  const table = await bindCsv(admin, 'read_write')
  const enc = encodeURIComponent(table)
  const deletes = recordDeletes()

  // Row 1 is KKL; its updated_at is the csv file's mtime.
  const before = (await admin.get(`/api/table/${enc}/1`)) as { updated_at: string }
  expect(Date.parse(before.updated_at)).not.toBeNaN()

  await renderApp(`/admin/${enc}/1`, admin)
  await screen.findByTestId('form-view')
  ;(await screen.findByTestId('form-delete')).click()
  ;(await screen.findByTestId('delete-row-confirm')).click()

  // The wire carries the stamp the form loaded. Without it the server answers
  // "Deletes must include the updated_at timestamp of the loaded row" and the
  // row survives — which is what this PR shipped before the fix.
  await waitFor(() => expect(deletes).toHaveLength(1))
  expect(deletes[0]).toContain(`updated_at=${encodeURIComponent(before.updated_at)}`)

  // And the outcome, not just the request: the row is gone from the source.
  await waitFor(async () => {
    const list = (await admin.get(`/api/table/${enc}`)) as { total: number }
    expect(list.total).toBe(1)
  })
})

test('TLC-R1.bound: a read-only binding owns its rows, so the list offers no New', async ({
  admin,
}) => {
  const table = await bindCsv(admin, 'read_only')

  await renderApp(`/admin/${encodeURIComponent(table)}`, admin)
  await screen.findByTestId('list-view')

  // EDS-13: absent, not disabled.
  expect(screen.queryByTestId('list-new')).toBeNull()
  expect(screen.queryByTestId('list-empty-new')).toBeNull()
})
