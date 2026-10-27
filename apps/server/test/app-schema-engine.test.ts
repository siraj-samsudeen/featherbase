// #651: the table-engine paths an app upgrade runs. One engine: Admin and app
// migrations share these, so there is no second schema writer.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { provisionApp } from '../src/app-lifecycle'
import { changeColumnType, createTable, deleteTable, renameTable } from '../src/table-engine'

// App Tables answer only while their app is provisioning or active.
const shopTest = (name: string, body: () => Promise<void>) => test(name, () => provisionApp('shop', body))

const supplier = {
  name: 'shop.supplier', label: 'Supplier',
  columns: [{ column_name: 'code', label: 'Code', column_type: 'Data', unique: true }, { column_name: 'rating', label: 'Rating', column_type: 'Int' }],
}
const line = { name: 'shop.line', label: 'Line', kind: 'sub_table', columns: [{ column_name: 'qty', label: 'Qty', column_type: 'Int' }] }

async function shop() {
  await createTable(line, 'shop')
  await createTable({ ...supplier, columns: [...supplier.columns, { column_name: 'lines', label: 'Lines', column_type: 'Sub-table', row_table: 'shop.line' }] }, 'shop')
  await createTable({ name: 'shop.order', label: 'Order', columns: [{ column_name: 'supplier', label: 'Supplier', column_type: 'Reference', reference_table: 'shop.supplier' }] }, 'shop')
  await sql`insert into shop.supplier (row_id, code, rating) values ('s1', 'ACME', 4)`
  await sql`insert into shop.line (row_id, parent, parenttype, parentfield, qty) values ('l1', 's1', 'shop.supplier', 'lines', 7)`
}

describe('renameTable', () => {
  shopTest('rows are kept under the new name', async () => {
    await shop()
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    expect(await sql`select row_id, code, rating from shop.vendor`).toEqual([{ row_id: 's1', code: 'ACME', rating: '4' }])
  })

  shopTest('links from other Tables follow the rename', async () => {
    await shop()
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    expect(await sql`select reference_table from column_def where parent = 'shop.order' and column_name = 'supplier'`).toEqual([{ reference_table: 'shop.vendor' }])
  })

  shopTest('child rows stay attached to their renamed parent', async () => {
    await shop()
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    expect(await sql`select parenttype from shop.line where row_id = 'l1'`).toEqual([{ parenttype: 'shop.vendor' }])
  })

  shopTest('history and grants that name the Table follow it', async () => {
    await shop()
    await sql`insert into comment (row_id, ref_table, ref_name, content) values ('c651', 'shop.supplier', 's1', 'checked')`
    await sql`insert into role (row_id) values ('Buyer') on conflict do nothing`
    await sql`insert into permission (row_id, ref_table, role, can_read) values ('p651', 'shop.supplier', 'Buyer', true)`
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    expect(await sql`select ref_table from comment where row_id = 'c651'`).toEqual([{ ref_table: 'shop.vendor' }])
    expect(await sql`select ref_table from permission where row_id = 'p651'`).toEqual([{ ref_table: 'shop.vendor' }])
  })

  shopTest('constraints, indexes and the read policy carry the new name', async () => {
    await shop()
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    await renameTable('shop.line', 'shop.item_line', 'shop')
    expect((await sql`select conname from pg_constraint where conrelid = 'shop.vendor'::regclass and contype = 'u'`).map(r => r.conname))
      .toEqual(['shop.vendor_code_uq'])
    expect((await sql`select indexname from pg_indexes where schemaname = 'shop' and tablename = 'item_line' and indexname like '%parent_idx'`).map(r => r.indexname))
      .toEqual(['shop.item_line_parent_idx'])
    expect(await sql`select qual from pg_policies where schemaname = 'shop' and tablename = 'vendor'`)
      .toEqual([{ qual: expect.stringContaining("'shop.vendor'") }])
  })

  shopTest('the scope mark stays on the renamed Table', async () => {
    await createTable({ ...supplier, decides_scope: true }, 'shop')
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    expect(await sql`select decides_scope from table_def where name = 'shop.vendor'`).toEqual([{ decides_scope: true }])
  })

  shopTest('a Table the app does not own is refused', async () => {
    await shop()
    await expect(renameTable('shop.supplier', 'shop.vendor', 'other')).rejects.toThrow(/belongs to shop/)
  })

  shopTest('an existing target name is refused', async () => {
    await shop()
    await expect(renameTable('shop.supplier', 'shop.order', 'shop')).rejects.toThrow(/already exists/)
  })
})

describe('changeColumnType', () => {
  shopTest('Int to Float keeps every value', async () => {
    await shop()
    await changeColumnType('shop.supplier', 'rating', 'Float')
    expect(await sql`select rating from shop.supplier`).toEqual([{ rating: 4 }])
  })

  shopTest('Check to Int stores true as 1', async () => {
    await createTable({ name: 'shop.flag', label: 'Flag', columns: [{ column_name: 'on_hold', label: 'On hold', column_type: 'Check' }] }, 'shop')
    await sql`insert into shop.flag (row_id, on_hold) values ('f1', true), ('f2', false)`
    await changeColumnType('shop.flag', 'on_hold', 'Int')
    expect(await sql`select row_id, on_hold from shop.flag order by row_id`).toEqual([{ row_id: 'f1', on_hold: '1' }, { row_id: 'f2', on_hold: '0' }])
  })

  shopTest('the column definition records the new type', async () => {
    await shop()
    await changeColumnType('shop.supplier', 'rating', 'Float')
    expect(await sql`select column_type from column_def where parent = 'shop.supplier' and column_name = 'rating'`).toEqual([{ column_type: 'Float' }])
  })

  shopTest('a change outside the safe list is refused', async () => {
    await shop()
    await expect(changeColumnType('shop.supplier', 'rating', 'Date')).rejects.toThrow(/Int to Date is not a safe conversion/)
  })
})

describe('deleteTable for the owning app', () => {
  shopTest('an installed app may drop its own Table', async () => {
    await shop()
    await sql`insert into installed_app (name, tables) values ('shop', ${sql.json(['shop.supplier', 'shop.line', 'shop.order'])})`
    await sql`delete from column_def where parent = 'shop.order'`
    await sql`delete from table_def where name = 'shop.order'`
    await sql`drop table shop."order"`
    await deleteTable('shop.supplier', 'Administrator', { ownerApp: 'shop' })
    expect(await sql`select to_regclass('shop.supplier') as relation`).toEqual([{ relation: null }])
  })

  shopTest('another app still may not drop it', async () => {
    await shop()
    await sql`insert into installed_app (name, tables) values ('shop', ${sql.json(['shop.supplier', 'shop.line', 'shop.order'])})`
    await expect(deleteTable('shop.order', 'Administrator', { ownerApp: 'other' })).rejects.toThrow(/belongs to shop/)
  })
})
