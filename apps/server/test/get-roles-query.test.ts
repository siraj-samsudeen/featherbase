// #620 (Codex/CI review on #623): getRoles runs on almost every permission
// check, many times per request, so the roles a person holds and the app
// roles bound to them come back in one round trip. The binding behaviour
// itself is tested in app-role-bindings.test.ts.
import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { makePerson } from './fixtures'

const counter = vi.hoisted(() => ({ queries: 0 }))
vi.mock('../src/db', async (original) => {
  const db = await original<typeof import('../src/db')>()
  return { ...db, sql: new Proxy(db.sql, { apply(target, self, args) {
    if (Array.isArray(args[0]) && 'raw' in args[0]) counter.queries++ // a statement, not an sql(...) helper
    return Reflect.apply(target as never, self, args)
  } }) }
})

const { getRoles } = await import('../src/permissions')
const { sql } = await import('../src/db')

describe('getRoles', () => {
  test('reads held roles and bound app roles in one query', async () => {
    const person = await makePerson({ email: 'roles@example.test' })
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values ('hr-620', ${person}, 'Person', 'roles', 'System Manager')`
    await getRoles(person) // the first call may also check that bindings exist
    counter.queries = 0
    expect(await getRoles(person)).toContain('System Manager')
    expect(counter.queries).toBe(1)
  })
})
