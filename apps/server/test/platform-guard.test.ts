import { describe, expect } from 'vitest'
import postgres from 'postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { AppError } from '../src/errors'
import { PLATFORM_SCHEMA } from '../src/platform-schema'
import {
  assertNotPlatformDatabase,
  assertNotPlatformRelation,
  readIdentity,
  sameDatabase,
} from '../src/sources/platform-guard'

// External data sources: "A data source never reaches the platform's own
// records". The end-to-end refusals live in system-written.test.ts (#432);
// these pin the identity rule and the failure paths it has to tell apart.
describe('a data source never reaches the platform\'s own records', () => {
  test('two connections are the same database only when their identity matches', async () => {
    const ours = await readIdentity(sql)
    expect(sameDatabase(ours, { ...ours })).toBe(true)
    expect(sameDatabase(ours, { ...ours, oid: `${ours.oid}0` })).toBe(false)
    expect(sameDatabase(ours, { ...ours, system_id: 'another-cluster' })).toBe(false)
    // Without a cluster id on either side, the start time decides.
    const noCluster = { ...ours, system_id: null }
    expect(sameDatabase(noCluster, { ...noCluster })).toBe(true)
    expect(sameDatabase(noCluster, { ...noCluster, started: 'another start' })).toBe(false)
  })

  test('a table on a data source cannot use the platform schema', () => {
    expect(() => assertNotPlatformRelation('warehouse', PLATFORM_SCHEMA)).toThrow(AppError)
    expect(() => assertNotPlatformRelation('warehouse', 'public')).not.toThrow()
    expect(() => assertNotPlatformRelation('warehouse', null)).not.toThrow()
  })

  test('a source that cannot be reached is reported as unreachable, not as safe', async () => {
    const unreachable = postgres('postgres://nobody@127.0.0.1:1/none', { max: 1, connect_timeout: 2, onnotice: () => {} })
    try {
      await expect(assertNotPlatformDatabase({ name: 'gone' } as never, unreachable)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    } finally {
      await unreachable.end({ timeout: 1 })
    }
  })
})
