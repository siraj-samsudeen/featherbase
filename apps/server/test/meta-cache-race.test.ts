// A definition, a view's definition or the slug map read while the metadata
// changes is answered but not cached (#426): the load saw the generation move.
// The change is staged with a module mock: the database client is wrapped so
// that the moment the load sends its query, the metadata is invalidated.
import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { makeTable } from './fixtures'

const stage = vi.hoisted(() => ({ when: null as null | ((text: string) => boolean), invalidate: () => {}, slugReads: 0 }))

vi.mock('../src/db', async (original) => {
  const db = await original<typeof import('../src/db')>()
  return { ...db, sql: new Proxy(db.sql, { apply(target, self, args) {
    if (Array.isArray(args[0]) && 'raw' in args[0] && (args[0] as string[]).join('?').trim() === 'select name from table_def') stage.slugReads++
    if (stage.when && Array.isArray(args[0]) && 'raw' in args[0] && stage.when((args[0] as string[]).join('?'))) {
      stage.when = null
      stage.invalidate()
    }
    return Reflect.apply(target as never, self, args)
  } }) }
})

const { getMeta, invalidateMeta, metaCacheStats, resolveTableName } = await import('../src/meta')
stage.invalidate = () => invalidateMeta()

const DT = 'Race Probe DT'
const loadingDefinitionOf = (text: string) => text.includes('from table_def where name =')

describe('read while the metadata changes', () => {
  test('a definition is answered but not cached, so the next read loads it again', async ({ admin }) => {
    await makeTable(admin, { name: DT, columns: ['title'] })
    invalidateMeta()
    stage.when = loadingDefinitionOf
    expect((await getMeta(DT)).name).toBe(DT)
    const loadsBefore = metaCacheStats.loads
    await getMeta(DT)
    expect(metaCacheStats.loads).toBe(loadsBefore + 1)
  })

  test("a view's definition is answered but not cached either", async ({ admin }) => {
    await makeTable(admin, { name: DT, columns: ['title'] })
    await admin.post('/api/table_def', { name: 'Race Probe View', kind: 'view', view_of: DT, view_filters: [['title', '=', 'x']] })
    invalidateMeta()
    await getMeta(DT)
    stage.when = loadingDefinitionOf
    expect((await getMeta('Race Probe View')).kind).toBe('view')
    const loadsBefore = metaCacheStats.loads
    await getMeta('Race Probe View')
    expect(metaCacheStats.loads).toBeGreaterThan(loadsBefore)
  })

  test('a Table found by its slug is found, and the slugs are read afresh next time', async ({ admin }) => {
    await makeTable(admin, { name: DT, columns: ['title'] })
    invalidateMeta()
    stage.when = (text) => text.trim() === 'select name from table_def'
    expect(await resolveTableName('race-probe-dt')).toBe(DT)
    // Nothing invalidates the metadata between the two lookups, so only a map
    // left uncached makes the second one read the slugs again.
    const readsBefore = stage.slugReads
    expect(await resolveTableName('race-probe-dt')).toBe(DT)
    expect(stage.slugReads).toBe(readsBefore + 1)
  })
})
