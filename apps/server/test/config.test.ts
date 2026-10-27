// The server's configuration as read from the environment at start-up.
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function freshConfig() {
  vi.resetModules()
  return (await import('../src/config')).config
}

describe('the default database', () => {
  test('without DATABASE_URL a test run uses featherbase_test and any other environment uses featherbase', async () => {
    vi.stubEnv('DATABASE_URL', undefined)
    vi.stubEnv('FEATHERBASE_ENV', 'test')
    expect((await freshConfig()).databaseUrl).toBe('postgres://postgres:postgres@127.0.0.1:5432/featherbase_test')
    vi.stubEnv('FEATHERBASE_ENV', 'development')
    expect((await freshConfig()).databaseUrl).toBe('postgres://postgres:postgres@127.0.0.1:5432/featherbase')
  })

  test('an explicit DATABASE_URL wins', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://someone@db.example:5432/elsewhere')
    expect((await freshConfig()).databaseUrl).toBe('postgres://someone@db.example:5432/elsewhere')
  })
})
