// M1: csv-folder sources — dbt seed files edited through the Desk. The
// fixture folder mimics a dbt seeds/ directory; byte stability of untouched
// records is the load-bearing property (reviewable git diffs).
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, patchDoc } from './pg-test'
import { parseCsv, serializeCsv } from '../src/sources/csv'
import { invalidateSources } from '../src/sources/registry'

let dir: string

// Quoting quirks on purpose: quoted value with comma, embedded quote,
// quoted newline, and a file WITHOUT a trailing newline.
const STORES = `store_code,store_name,city
KKL,"Karaikal, Main",Karaikal
TVM,Thiruvananthapuram,TVM
CHN,"He said ""hi""",Chennai
`
const NOTES_NO_EOF = `id,note
1,"multi
line note"
2,plain`

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fb-seeds-'))
  writeFileSync(path.join(dir, 'store_master.csv'), STORES)
  mkdirSync(path.join(dir, 'finance'))
  writeFileSync(path.join(dir, 'finance', 'notes.csv'), NOTES_NO_EOF)
  writeFileSync(path.join(dir, '_seeds.yml'), 'version: 2\n')
})

beforeEach(() => {
  writeFileSync(path.join(dir, 'store_master.csv'), STORES)
  writeFileSync(path.join(dir, 'finance', 'notes.csv'), NOTES_NO_EOF)
})

afterAll(() => {
  invalidateSources()
  rmSync(dir, { recursive: true, force: true })
})

describe('csv.ts: byte-stable round trip', () => {
  test('parse → serialize reproduces tricky files byte for byte', () => {
    for (const text of [STORES, NOTES_NO_EOF, 'a,b\r\n1,2\r\n', 'only_header\n']) {
      expect(serializeCsv(parseCsv(text))).toBe(text)
    }
  })

  test('mixed and lone-CR terminators survive untouched (review finding 8)', () => {
    const mixed = 'a,b\r\n1,2\n3,4\r\n5,6'
    expect(serializeCsv(parseCsv(mixed))).toBe(mixed)
    const loneCr = 'a,b\r1,2\r3,4'
    expect(serializeCsv(parseCsv(loneCr))).toBe(loneCr)
    // Each record remembers its own terminator.
    const m = parseCsv(mixed)
    expect(m.headerEol).toBe('\r\n')
    expect(m.records.map((r) => r.eol)).toEqual(['\n', '\r\n', ''])
  })

  test('quoted fields parse correctly', () => {
    const m = parseCsv(STORES)
    expect(m.headers).toEqual(['store_code', 'store_name', 'city'])
    expect(m.records[0].fields[1]).toBe('Karaikal, Main')
    expect(m.records[2].fields[1]).toBe('He said "hi"')
    const n = parseCsv(NOTES_NO_EOF)
    expect(n.records[0].fields[1]).toBe('multi\nline note')
    // The final record carries no terminator — that is how "file ends
    // without a newline" is represented now (per-record EOLs).
    expect(n.records[n.records.length - 1].eol).toBe('')
  })
})

async function makeCsvSource(admin: {
  post: <T = Record<string, unknown>>(p: string, b?: unknown) => Promise<T>
  fetch: (p: string, i?: RequestInit) => Promise<Response>
}): Promise<string[]> {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', {
    name: 'seed-fixture',
    engine: 'csv-folder',
    root_path: dir,
    access: 'read_write',
  })
  const res = await admin.fetch('/api/table/Data%20Source/seed-fixture:reflect', {
    method: 'POST',
    body: JSON.stringify({ tables: ['store_master.csv', 'finance/notes.csv'] }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { created: { name: string }[]; skipped: { reason: string }[] }
  expect(body.skipped).toEqual([])
  return body.created.map((c) => c.name)
}

describe('M1: csv-folder source', () => {
  test('introspects every csv (recursively), skipping non-csv files', async ({ admin }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      name: 'seed-fixture',
      engine: 'csv-folder',
      root_path: dir,
      access: 'read_write',
    })
    const res = (await admin.get('/api/table/Data%20Source/seed-fixture:introspect')) as {
      tables: { table: string; pk: string; proposed_name: string }[]
    }
    expect(res.tables.map((t) => t.table).sort()).toEqual([
      'finance/notes.csv',
      'store_master.csv',
    ])
    const stores = res.tables.find((t) => t.table === 'store_master.csv')!
    expect(stores.pk).toBe('_row')
    expect(stores.proposed_name).toBe('Seed Store Master')
  })

  test('reflects, lists (row number pk, mtime as updated_at), filters in memory', async ({
    admin,
  }) => {
    const [stores] = await makeCsvSource(admin)
    expect(stores).toBe('Seed Store Master')
    const enc = encodeURIComponent(stores)
    const list = (await admin.get(
      `/api/table/${enc}?fields=${encodeURIComponent('["name","store_code","store_name"]')}&order_by=store_code asc`,
    )) as { data: Record<string, unknown>[]; total: number }
    expect(list.total).toBe(3)
    expect(list.data.map((r) => r.store_code)).toEqual(['CHN', 'KKL', 'TVM'])

    const doc = (await admin.get(`/api/table/${enc}/1`)) as Record<string, unknown>
    expect(doc.store_code).toBe('KKL')
    expect(doc.store_name).toBe('Karaikal, Main')
    expect(doc.updated_at).toBeTruthy()
  })

  test('a cell edit rewrites only that record — other lines keep their bytes', async ({
    admin,
  }) => {
    const [stores] = await makeCsvSource(admin)
    const enc = encodeURIComponent(stores)
    const doc = (await admin.get(`/api/table/${enc}/2`)) as Record<string, unknown>
    const updated = await patchDoc<Record<string, unknown>>(admin, `/api/table/${enc}/2`, {
      city: 'Trivandrum',
      updated_at: doc.updated_at,
    })
    expect(updated.city).toBe('Trivandrum')
    const text = readFileSync(path.join(dir, 'store_master.csv'), 'utf8')
    const lines = text.split('\n')
    expect(lines[0]).toBe('store_code,store_name,city') // header verbatim
    expect(lines[1]).toBe('KKL,"Karaikal, Main",Karaikal') // untouched, quoting preserved
    expect(lines[2]).toBe('TVM,Thiruvananthapuram,Trivandrum') // edited record
    expect(lines[3]).toBe('CHN,"He said ""hi""",Chennai') // untouched
    expect(text.endsWith('\n')).toBe(true)
  })

  test('insert appends a row; delete removes one; both atomic on disk', async ({ admin }) => {
    const [stores] = await makeCsvSource(admin)
    const enc = encodeURIComponent(stores)
    const created = await admin.post<Record<string, unknown>>(`/api/table/${enc}`, {
      store_code: 'MDU',
      store_name: 'Madurai',
      city: 'Madurai',
    })
    expect(created.name).toBe('4')
    let text = readFileSync(path.join(dir, 'store_master.csv'), 'utf8')
    expect(text).toContain('MDU,Madurai,Madurai')

    const loaded = (await admin.get(`/api/table/${enc}/4`)) as Record<string, unknown>
    const del = await admin.fetch(
      `/api/table/${enc}/4?updated_at=${encodeURIComponent(String(loaded.updated_at))}`,
      { method: 'DELETE' },
    )
    expect(del.status).toBe(200)
    text = readFileSync(path.join(dir, 'store_master.csv'), 'utf8')
    expect(text).toBe(STORES)
  })

  test('an outside edit to the file conflicts a stale save (mtime lock)', async ({ admin }) => {
    const [stores] = await makeCsvSource(admin)
    const enc = encodeURIComponent(stores)
    const doc = (await admin.get(`/api/table/${enc}/1`)) as Record<string, unknown>
    // Another process (dbt, an editor) touches the file after our load.
    const file = path.join(dir, 'store_master.csv')
    const future = new Date(Date.now() + 5000)
    utimesSync(file, future, future)
    await expect(
      patchDoc(admin, `/api/table/${enc}/1`, { city: 'X', updated_at: doc.updated_at }),
    ).rejects.toMatchObject({ status: 409 })
  })

  test('a file without a trailing newline keeps that shape through an edit', async ({ admin }) => {
    const names = await makeCsvSource(admin)
    const notes = names.find((n) => n.includes('Notes'))!
    const enc = encodeURIComponent(notes)
    const doc = (await admin.get(`/api/table/${enc}/2`)) as Record<string, unknown>
    await patchDoc(admin, `/api/table/${enc}/2`, { note: 'edited', updated_at: doc.updated_at })
    const text = readFileSync(path.join(dir, 'finance', 'notes.csv'), 'utf8')
    expect(text).toBe('id,note\n1,"multi\nline note"\n2,edited')
  })

  test('a delete with no revision is refused outright (review finding 5)', async ({ admin }) => {
    const [stores] = await makeCsvSource(admin)
    const enc = encodeURIComponent(stores)
    const res = await admin.fetch(`/api/table/${enc}/2`, { method: 'DELETE' })
    expect(res.status).toBe(417)
    expect(readFileSync(path.join(dir, 'store_master.csv'), 'utf8')).toBe(STORES)
  })

  test('a stale delete conflicts instead of removing the shifted row', async ({ admin }) => {
    const [stores] = await makeCsvSource(admin)
    const enc = encodeURIComponent(stores)
    // The user opens row 2 (TVM)...
    const doc = (await admin.get(`/api/table/${enc}/2`)) as Record<string, unknown>
    expect(doc.store_code).toBe('TVM')
    // ...another process inserts a row above it, so position 2 now holds a
    // different record (review finding 5).
    const file = path.join(dir, 'store_master.csv')
    const shifted = STORES.replace(
      'KKL,"Karaikal, Main",Karaikal\n',
      'KKL,"Karaikal, Main",Karaikal\nNEW,Inserted,Nowhere\n',
    )
    writeFileSync(file, shifted)
    const res = await admin.fetch(
      `/api/table/${enc}/2?updated_at=${encodeURIComponent(String(doc.updated_at))}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(409)
    // Nothing removed — the inserted row is still there.
    expect(readFileSync(file, 'utf8')).toBe(shifted)
  })

  test('an appended row keeps a no-trailing-newline file unterminated', async ({ admin }) => {
    const names = await makeCsvSource(admin)
    const notes = names.find((n) => n.includes('Notes'))!
    const enc = encodeURIComponent(notes)
    await admin.post(`/api/table/${enc}`, { id: '3', note: 'appended' })
    const text = readFileSync(path.join(dir, 'finance', 'notes.csv'), 'utf8')
    expect(text).toBe('id,note\n1,"multi\nline note"\n2,plain\n3,appended')
  })

  test('a failed write never poisons the parse cache (round 3)', async ({ admin }) => {
    const [stores] = await makeCsvSource(admin)
    const enc = encodeURIComponent(stores)
    // Prime the cache.
    const before = (await admin.get(`/api/table/${enc}`)) as { total: number }
    expect(before.total).toBe(3)
    // Make the folder unwritable: the atomic tmp-file write must fail.
    chmodSync(dir, 0o555)
    try {
      const res = await admin.fetch(`/api/table/${enc}`, {
        method: 'POST',
        body: JSON.stringify({ store_code: 'ERR', store_name: 'Never lands', city: 'X' }),
      })
      expect(res.status).toBeGreaterThanOrEqual(500)
    } finally {
      chmodSync(dir, 0o755)
    }
    // The file is untouched — and so must be what the API serves. Before the
    // copy-on-write fix the cached model kept the phantom appended record
    // (file mtime/size unchanged = the poisoned entry keeps hitting).
    expect(readFileSync(path.join(dir, 'store_master.csv'), 'utf8')).toBe(STORES)
    const after = (await admin.get(`/api/table/${enc}`)) as { total: number }
    expect(after.total).toBe(3)
    await expect(admin.get(`/api/table/${enc}/4`)).rejects.toMatchObject({ status: 404 })
  })

  test('path traversal in external_table is rejected', async ({ admin }) => {
    await makeCsvSource(admin)
    const res = await admin.fetch('/api/table/Data%20Source/seed-fixture:reflect', {
      method: 'POST',
      body: JSON.stringify({ tables: ['../outside.csv'] }),
    })
    const body = (await res.json()) as { created: unknown[]; skipped: { reason: string }[] }
    expect(body.created).toEqual([])
    expect(body.skipped).toHaveLength(1)
  })
})
