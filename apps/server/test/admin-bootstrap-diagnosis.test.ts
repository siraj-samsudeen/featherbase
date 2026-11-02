// #130 in-process: the first-admin warning. The subprocess cases in
// admin-bootstrap.test.ts prove provisioning on a fresh database; these run
// in the sandbox.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { hashPassword } from '../src/auth'
import { diagnoseAdminBootstrap } from '../src/admin-bootstrap'
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
