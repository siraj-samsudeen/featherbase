import { expect, vi } from 'vitest'
import { test } from './pg-test'

// #1224: a Table whose storage can't be found as it is read (its app's storage gone mid-request, say)
// names nobody through its rows or shares; a Person reader still looks names up. The database refuses a
// Table without storage, so its definition is stood in for, for this one made-up Table only.

vi.mock('../src/meta', async (original) => {
  const real = await original<typeof import('../src/meta')>()
  return { ...real, getMeta: async (table: string, ...rest: unknown[]) => {
    if (table === 'lostapp.note') return { name: 'lostapp.note', kind: 'table', owner_app: 'lostapp', physical_schema: null, physical_relation: null, data_source: null, system_written: false, row_key: 'row_id', columns: [] }
    return (real.getMeta as (...args: unknown[]) => unknown)(table, ...rest)
  } }
})

test('a Table whose storage is gone names nobody through its rows; a Person reader still looks names up', async ({ createUser }) => {
  const { actorNamesOn } = await import('../src/actor-names')
  const writer = await createUser({ roles: [], fullName: 'Lost Writer' })
  const nobody = await createUser({ roles: [] })
  expect(await actorNamesOn(nobody.user!, 'lostapp.note', [writer.user!])).toEqual({ [writer.user!]: null })
  expect(await actorNamesOn('Administrator', 'lostapp.note', [writer.user!])).toEqual({ [writer.user!]: 'Lost Writer' })
})
