// Table deletion (docs/specs/0003-table-deletion.md) paying its hermeticity
// dividend: create-path journey specs PRE-CLEAN the Tables they are about to
// create instead of self-skipping on a used database. A leftover from a
// crashed run is deleted here; a delete refusal (DEL-R3: something still
// references it) fails the spec loudly rather than skipping quietly.
import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'

export async function deleteTableIfExists(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` }
  const enc = encodeURIComponent(name)
  const exists = await request.get(`/api/table/${enc}:meta`, { headers })
  if (exists.status() !== 200) return
  const res = await request.delete(`/api/doctype/${enc}`, { headers })
  expect(res.status(), `pre-clean: deleting leftover Table ${name}`).toBe(200)
}
