import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getDoc, saveDoc } from '../src/document'
import { getList } from '../src/query'
import { createTable } from '../src/doctype-engine'

// SET-001: Settings Tables (kind: 'settings') store one instance in the EAV
// store, apply defaults, and never create a table.

const DT = 'Set Srv Single'

async function setup() {
  await createTable({
    name: DT,
    kind: 'settings',
    columns: [
      { column_name: 'title', column_type: 'Data', default_value: 'Default Title' },
      { column_name: 'count', column_type: 'Int', default_value: '5' },
      { column_name: 'active', column_type: 'Check', default_value: '0' },
    ],
  })
}

describe('SET-001: settings tables', () => {
  test('creates no table for a settings Table', async () => {
    await setup()
    const [t] = await sql`select to_regclass('set_srv_single') as t`
    expect(t.t).toBeNull()
  })

  test('reads defaults before anything is saved', async () => {
    await setup()
    const doc = await getDoc(DT, DT, 'Administrator')
    expect(doc.name).toBe(DT)
    expect(doc.title).toBe('Default Title')
    expect(doc.count).toBe(5)
    expect(doc.active).toBe(false)
  })

  test('persists saved values (typed round-trip) with exactly one instance', async () => {
    await setup()
    await saveDoc(DT, { title: 'Configured', count: 42, active: true }, 'Administrator')
    const doc = await getDoc(DT, DT, 'Administrator')
    expect(doc.title).toBe('Configured')
    expect(doc.count).toBe(42)
    expect(doc.active).toBe(true)

    // Saving again updates in place — no second record.
    await saveDoc(DT, { title: 'Reconfigured' }, 'Administrator')
    const doc2 = await getDoc(DT, DT, 'Administrator')
    expect(doc2.title).toBe('Reconfigured')
    expect(doc2.count).toBe(42) // untouched field retained

    const [{ n }] = await sql`select count(distinct table_name)::int as n from single_value where table_name = ${DT}`
    expect(n).toBe(1)
  })

  test('rejects listing a settings Table with a clean validation error (never a 500)', async () => {
    await setup()
    await expect(getList(DT, {}, 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })
})
