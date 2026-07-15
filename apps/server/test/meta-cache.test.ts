import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { getMeta, invalidateMeta, metaCacheStats } from '../src/meta'
import { app } from '../src/index'

const DT = 'Cache Probe DT'

beforeAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_cache_probe_dt')
  await app.request('/api/doctype', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: DT,
      fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Old Label' }],
    }),
  })
})

afterAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_cache_probe_dt')
  invalidateMeta(DT)
  await sql.end()
})

describe('META-011: meta cache with invalidation', () => {
  it('serves repeat lookups from cache — one DB load per doctype', async () => {
    invalidateMeta(DT)
    const loadsBefore = metaCacheStats.loads
    await getMeta(DT)
    expect(metaCacheStats.loads).toBe(loadsBefore + 1)
    const hitsBefore = metaCacheStats.hits
    await getMeta(DT)
    await getMeta(DT)
    expect(metaCacheStats.loads).toBe(loadsBefore + 1)
    expect(metaCacheStats.hits).toBe(hitsBefore + 2)
  })

  it('sees altered metadata after invalidation', async () => {
    expect((await getMeta(DT)).fields[0].label).toBe('Old Label')
    await sql`update docfield set label = 'New Label' where parent = ${DT}`
    // Still cached:
    expect((await getMeta(DT)).fields[0].label).toBe('Old Label')
    invalidateMeta(DT)
    expect((await getMeta(DT)).fields[0].label).toBe('New Label')
  })

  it('creating a DocType invalidates and serves fresh meta over HTTP', async () => {
    const res = await app.request(`/api/meta/${encodeURIComponent(DT)}`)
    expect(((await res.json()) as { fields: { label: string }[] }).fields[0].label).toBe(
      'New Label',
    )
  })
})
