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

const { getRoles, getRolesMany } = await import('../src/permissions')
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

  // #1254: Waiting for you asks about everyone who might decide a waiting change; one query, however many.
  test('reads many people\'s roles in one query, each as getRoles gives it', async () => {
    const people = [await makePerson({ email: 'roles-a@example.test' }), await makePerson({ email: 'roles-b@example.test' }), await makePerson({ email: 'roles-c@example.test' })]
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values ('hr-1254', ${people[1]}, 'Person', 'roles', 'System Manager')`
    await getRolesMany(people)
    counter.queries = 0
    const many = await getRolesMany(people)
    expect(counter.queries).toBe(1)
    for (const person of people) expect(many.get(person)).toEqual(await getRoles(person))
  })
})
