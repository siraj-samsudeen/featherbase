import { describe, expect } from 'vitest'
import postgres from 'postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { AppError } from '../src/errors'
import { PLATFORM_SCHEMA } from '../src/platform-schema'
import { EXTERNAL_DATABASE_URL } from './external-database'
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

  test('an ordinary different PostgreSQL database is allowed while this database is refused', async () => {
    const external = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
    try {
      const identity = await readIdentity(external)
      expect(identity.oid).not.toBe((await readIdentity(sql)).oid)
      await expect(assertNotPlatformDatabase({ name: 'external' } as never, external)).resolves.toBeUndefined()
      await expect(assertNotPlatformDatabase({ name: 'own' } as never, sql)).rejects.toMatchObject({ type: 'PermissionError' })
    } finally {
      await external.end({ timeout: 1 })
    }
  })

  test('a source denied access to identity catalogs is not assumed to be a different database', async () => {
    await sql`savepoint identity_probe`
    await sql`create role identity_catalog_reader nologin`
    await sql`revoke select on pg_catalog.pg_database from public`
    await sql`set local role identity_catalog_reader`
    try {
      await expect(assertNotPlatformDatabase({ name: 'restricted' } as never, sql))
        .rejects.toMatchObject({ code: '42501' })
    } finally {
      await sql`rollback to savepoint identity_probe`
    }
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
