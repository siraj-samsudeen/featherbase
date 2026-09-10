// Not sandboxed: independent pools must contend on committed counters to
// prove deployment-wide admission. An owned schema is dropped in finally.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { expect, it } from 'vitest'
import { config } from '../src/config'
import { admit, forgive, cleanExpiredBuckets, preAuthPolicy, sourceAddress } from '../src/pre-auth-rate-limit'

it('#245 admits exactly the shared budget across independent pools, resets expiry and bounds cleanup', async () => {
  const schema = `limiter_${randomUUID().replaceAll('-', '')}`
  const control = postgres(config.databaseUrl, { onnotice: () => {} })
  const pools = Array.from({ length: 3 }, () => postgres(config.databaseUrl, { max: 4, prepare: false, connection: { search_path: schema }, onnotice: () => {} }))
  const db = pools[0]
  try {
    await control.unsafe(`create schema "${schema}"`)
    await db.unsafe(readFileSync(new URL('../migrations/0084_pre_auth_buckets.sql', import.meta.url), 'utf8'))
    const batch = () => Promise.all(Array.from({ length: 60 }, (_, i) => admit('shared', 7, 60_000, pools[i % pools.length])))
    const first = await batch()
    expect(first.filter((r) => r.revision !== null)).toHaveLength(7)
    expect(first.filter((r) => !r.revision).every((r) => r.retryAfter > 0 && r.retryAfter <= 60)).toBe(true)
    expect((await db`select hits from pre_auth_bucket where key = 'shared'`)[0].hits).toBe(7)
    await db`update pre_auth_bucket set expires_at = statement_timestamp() - interval '1 second' where key = 'shared'`
    const second = await batch()
    expect(second.filter((r) => r.revision !== null)).toHaveLength(7)
    await forgive(first.find((r) => r.revision)!, pools[1])
    expect((await db`select hits from pre_auth_bucket where key = 'shared'`)[0].hits).toBe(7)
    const old = await admit('credential', 3, 60_000, pools[0])
    const newer = await admit('credential', 3, 60_000, pools[1])
    await forgive(old, pools[2])
    expect((await db`select hits from pre_auth_bucket where key = 'credential'`)[0].hits).toBe(2)
    await forgive(newer, pools[0])
    expect(await db`select key from pre_auth_bucket where key = 'credential'`).toHaveLength(0)
    await db`insert into pre_auth_bucket (key, hits, expires_at, revision)
      select 'expired-' || i, 1, statement_timestamp() - interval '1 second', ${randomUUID()} from generate_series(1, 205) i`
    expect(await cleanExpiredBuckets(db)).toHaveLength(100)
    expect((await db`select count(*)::int as n from pre_auth_bucket where key like 'expired-%'`)[0].n).toBe(105)
    expect((await db`select hits from pre_auth_bucket where key = 'shared'`)[0].hits).toBe(7)
  } finally {
    await Promise.all(pools.map((pool) => pool.end({ timeout: 1 })))
    await control.unsafe(`drop schema if exists "${schema}" cascade`)
    await control.end()
  }
})

it('#245 trusts only explicitly configured proxy hops and validates configuration', () => {
  const trusted = preAuthPolicy({ TRUSTED_PROXY_IPS: '::ffff:127.0.0.1, 2001:db8::1' }).trusted
  expect(sourceAddress('192.0.2.1', '198.51.100.9', trusted)).toBe('192.0.2.1')
  expect(sourceAddress('::ffff:127.0.0.1', '198.51.100.9, 2001:0db8::1', trusted)).toBe('198.51.100.9')
  expect(sourceAddress('127.0.0.1', 'spoofed, 198.51.100.9', trusted)).toBe('127.0.0.1')
  expect(sourceAddress('127.0.0.1', 'fe80::1%eth0, 198.51.100.9', trusted)).toBe('127.0.0.1')
  expect(sourceAddress('127.0.0.1', '203.0.113.99, 198.51.100.9', trusted)).toBe('198.51.100.9')
  expect(sourceAddress(undefined, '198.51.100.9', trusted)).toBe('unknown')
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', '', '2147483648'])
    expect(() => preAuthPolicy({ PREAUTH_WINDOW_MS: value })).toThrow('PREAUTH_WINDOW_MS')
  expect(() => preAuthPolicy({ PREAUTH_FORM_MAX: 'bad' })).toThrow('PREAUTH_FORM_MAX')
  expect(() => preAuthPolicy({ TRUSTED_PROXY_IPS: '0.0.0.0/0' })).toThrow('TRUSTED_PROXY_IPS')
})
