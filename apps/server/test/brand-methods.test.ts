// The sign-in page lists the enabled methods by their labels; a method whose
// label was left blank still gets a name a person can read.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { test } from './pg-test'
import { configureGoogle } from './identity-fixtures'

const labelOf = async (api: TestClient, kind: string) =>
  ((await (await api.fetch('/api/brand')).json()) as { sign_in_methods: { kind: string; label: string }[] })
    .sign_in_methods.find((m) => m.kind === kind)?.label

describe('a sign-in method with a blank label', () => {
  test('password is listed as Password', async ({ api }) => {
    await sql`update sign_in_method set label = '' where kind = 'password'`
    expect(await labelOf(api, 'password')).toBe('Password')
  })

  test('Google is listed as Google', async ({ api }) => {
    await configureGoogle({ client_id: 'client-1', enabled: true })
    await sql`update sign_in_method set label = '' where row_id = 'google'`
    expect(await labelOf(api, 'google')).toBe('Google')
  })
})
