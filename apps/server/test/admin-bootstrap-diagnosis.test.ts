// #130 in-process: the first-admin warning and the pre-rename provisioning
// path. The subprocess cases in admin-bootstrap.test.ts prove the same on a
// fresh database; these run in the sandbox, where DDL rolls back too.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { hashPassword, verifyPassword } from '../src/auth'
import { bootstrapAdministrator, diagnoseAdminBootstrap } from '../src/admin-bootstrap'
import { makePerson } from './fixtures'

async function warnings(run: () => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => void seen.push(args.join(' '))
  try {
    await run()
  } finally {
    console.warn = original
  }
  return seen
}

describe('the first-admin bootstrap diagnosis', () => {
  test('a production instance with no password-enabled System Manager is warned to create one', async () => {
    await sql`update person set password_hash = null`
    const seen = await warnings(() => diagnoseAdminBootstrap('production'))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('First admin bootstrap pending')
  })

  test('a password-enabled Administrator, or a development or test run, is not warned', async () => {
    expect(await warnings(() => diagnoseAdminBootstrap('production'))).toEqual([])
    await sql`update person set password_hash = null`
    expect(await warnings(() => diagnoseAdminBootstrap('development'))).toEqual([])
    expect(await warnings(() => diagnoseAdminBootstrap('test'))).toEqual([])
  })

  test('a password-enabled System Manager other than Administrator also clears the warning', async () => {
    await sql`update person set password_hash = null where row_id = 'Administrator'`
    const manager = await makePerson({ email: 'manager@example.com', full_name: 'Manager', roles: [{ role: 'System Manager' }] })
    await sql`update person set password_hash = ${hashPassword('pw-123456')} where row_id = ${manager}`
    expect(await warnings(() => diagnoseAdminBootstrap('production'))).toEqual([])
  })
})

describe('provisioning before the person table was renamed', () => {
  test('a null Administrator hash is set on the old `user` table, and a hash already there is kept', async () => {
    await sql`alter table person rename to "user"`
    await sql`update "user" set password_hash = null where row_id = 'Administrator'`
    await bootstrapAdministrator('development')
    const [set] = await sql`select password_hash from "user" where row_id = 'Administrator'`
    expect(verifyPassword('admin', set.password_hash)).toBe(true)
    await sql`update "user" set password_hash = ${hashPassword('kept-secret')} where row_id = 'Administrator'`
    await bootstrapAdministrator('development')
    const [kept] = await sql`select password_hash from "user" where row_id = 'Administrator'`
    expect(verifyPassword('kept-secret', kept.password_hash)).toBe(true)
  })
})
