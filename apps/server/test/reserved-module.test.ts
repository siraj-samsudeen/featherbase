// #1287: "System" is the platform's own module. No Table or view may be put in a module of that name, in any
// case or spacing, by any path that defines one, so the platform never makes a second "System" page.
import { expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { RESERVED_MODULE_MESSAGE, createTable, isReservedModule, updateTable } from '../src/table-engine'

const columns = [{ column_name: 'title', column_type: 'Data' }]
const refusal = { type: 'ValidationError', fields: { module: RESERVED_MODULE_MESSAGE } }

test('the name "System" is reserved in any case or spacing; other names are not', () => {
  for (const name of ['System', 'system', ' SYSTEM ', 'Sys tem', 'S y s t e m']) expect(isReservedModule(name), name).toBe(true)
  for (const name of ['Systems', 'System Tools', 'People', 'Core', 'Sistem']) expect(isReservedModule(name), name).toBe(false)
})

test('building a Table in module "System" is refused with a plain message, and no second System page appears', async ({ admin }) => {
  for (const module of ['System', ' system ', 'Sys tem']) {
    const res = await admin.fetch('/api/table_def', { method: 'POST', body: JSON.stringify({ name: 'Reserved Module 1287', module, columns }) })
    expect(res.status, module).toBe(417)
    expect(await res.json()).toMatchObject({ error: refusal })
  }
  expect(await sql`select 1 from table_def where name = 'Reserved Module 1287'`).toEqual([])
  expect(await sql`select row_id from home_page where label = 'System'`).toEqual([{ row_id: 'system' }])
  // Any other module is built as before, with its own page.
  const ok = await admin.fetch('/api/table_def', { method: 'POST', body: JSON.stringify({ name: 'Reserved Module 1287', module: 'System Tools', columns }) })
  expect(ok.status).toBe(201)
  expect(await sql`select row_id from home_page where module = 'System Tools'`).toHaveLength(1)
})

test('moving an existing Table into module "System" is refused, and its module stays', async () => {
  await createTable({ name: 'Reserved Move 1287', module: 'People', columns })
  await expect(updateTable('Reserved Move 1287', { name: 'Reserved Move 1287', module: 'SYSTEM', columns })).rejects.toMatchObject(refusal)
  expect((await sql`select module from table_def where name = 'Reserved Move 1287'`)[0].module).toBe('People')
})

test('an app Table and a view in module "System" are refused the same way', async () => {
  // As an app's install and its migrations create its Tables.
  await expect(createTable({ name: 'reservedapp.thing', module: 'System', columns }, 'reservedapp')).rejects.toMatchObject(refusal)
  await createTable({ name: 'Reserved Base 1287', module: 'People', columns })
  await expect(createTable({ name: 'Reserved View 1287', kind: 'view', module: 'system', view_of: 'Reserved Base 1287', view_filters: [] })).rejects.toMatchObject(refusal)
})
