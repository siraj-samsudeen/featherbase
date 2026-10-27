// #651: the table-engine paths an app upgrade runs. One engine: Admin and app
// migrations share these, so there is no second schema writer.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { provisionApp } from '../src/app-lifecycle'
import { changeColumnType, createTable, deleteTable, renameColumn, renameTable } from '../src/table-engine'
import { applyMigrations, describeLoss, countLosses, migrationSchema } from '../src/runtime-migrations'

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

// A second installed app, turned off, whose Table links to Tables and holds
// one link to shop.supplier.
async function ledgerOff() {
  await provisionApp('ledger', () => createTable({ name: 'ledger.log', label: 'Log',
    columns: [{ column_name: 'about', label: 'About', column_type: 'Reference', reference_table: 'Table' }] }, 'ledger'))
  await sql`insert into ledger.log (row_id, about) values ('g1', 'shop.supplier')`
  await sql`insert into installed_app (name, tables, enabled) values ('ledger', ${sql.json(['ledger.log'])}, false)`
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

  shopTest('a Table holding links to Tables can be renamed while empty', async () => {
    await createTable({ name: 'shop.audit', label: 'Audit', columns: [{ column_name: 'about', label: 'About', column_type: 'Reference', reference_table: 'Table' }] }, 'shop')
    await renameTable('shop.audit', 'shop.trail', 'shop')
    expect(await sql`select to_regclass('shop.trail') is not null as renamed`).toEqual([{ renamed: true }])
  })

  shopTest('a Table holding links to Tables keeps its rows, and a link to itself follows the rename', async () => {
    await createTable({ name: 'shop.audit', label: 'Audit', columns: [{ column_name: 'about', label: 'About', column_type: 'Reference', reference_table: 'Table' }] }, 'shop')
    await sql`insert into shop.audit (row_id, about) values ('a1', 'shop.audit'), ('a2', 'Person')`
    await renameTable('shop.audit', 'shop.trail', 'shop')
    expect(await sql`select row_id, about from shop.trail order by row_id`).toEqual([{ row_id: 'a1', about: 'shop.trail' }, { row_id: 'a2', about: 'Person' }])
  })

  shopTest('another app being disabled does not stop a rename, and its links to the Table follow', async () => {
    await shop()
    await ledgerOff()
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    expect(await sql`select about from ledger.log`).toEqual([{ about: 'shop.vendor' }])
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

describe('renameColumn', () => {
  shopTest('an Admin override on the column follows the rename', async () => {
    await shop()
    await sql`insert into metadata_override (row_id, table_name, column_name, property, value) values ('mo651', 'shop.supplier', 'rating', 'label', 'Stars')`
    await renameColumn('shop.supplier', 'rating', 'score')
    expect(await sql`select column_name from metadata_override where row_id = 'mo651'`).toEqual([{ column_name: 'score' }])
  })
})

const step = (operations: unknown[]) => migrationSchema.parse({ id: 'prune', fromVersion: '0.1.0', toVersion: '0.2.0', operations })
const lines = { column_name: 'lines', label: 'Lines', column_type: 'Sub-table', row_table: 'shop.line' }
// The shop Tables, registered as an installed app's, without shop.order.
async function registered() {
  await shop()
  await sql`delete from column_def where parent = 'shop.order'`
  await sql`delete from table_def where name = 'shop.order'`
  await sql`drop table shop."order"`
  await sql`insert into installed_app (name, tables) values ('shop', ${sql.json(['shop.line', 'shop.supplier'])})`
}
const run = (...operations: unknown[]) => applyMigrations([step(operations)], 'shop')
const choice = (column_name: string, extra: Record<string, unknown> = {}) =>
  ({ column_name, label: column_name, column_type: 'Choice', choices: 'A\nB\nC', ...extra })

describe('Sub-table losses', () => {

  shopTest('dropping a Sub-table column counts its child rows before anything runs', async () => {
    await registered()
    const losses = await countLosses('shop', [step([{ kind: 'dropColumn', table: 'shop.supplier', column: lines, destructive: true }])])
    expect(losses.map(describeLoss)).toEqual(['prune #1 dropColumn shop.supplier.lines: 1 value'])
  })

  shopTest('dropping a Sub-table column removes its child rows', async () => {
    await registered()
    await applyMigrations([step([{ kind: 'dropColumn', table: 'shop.supplier', column: lines, destructive: true }])], 'shop')
    expect(await sql`select row_id from shop.line`).toEqual([])
  })

  shopTest('dropping a Table counts the Sub-table rows that go with it', async () => {
    await registered()
    const losses = await countLosses('shop', [step([{ kind: 'dropTable', table: { ...supplier, columns: [...supplier.columns, lines] }, destructive: true }])])
    expect(losses.map(describeLoss)).toEqual(['prune #1 dropTable shop.supplier: 1 row and 1 Sub-table row'])
  })
})

describe('backfills keep the column\'s own rules', () => {
  shopTest('a backfill outside the column\'s choices is refused', async () => {
    await registered()
    await expect(run({ kind: 'addColumn', table: 'shop.supplier', column: choice('tier'), backfill: 'Other' }))
      .rejects.toThrow(/backfill "Other" is not a value shop.supplier.tier accepts/)
  })

  shopTest('a backfill among the column\'s choices fills the rows already there', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: choice('tier'), backfill: 'B' })
    expect(await sql`select tier from shop.supplier`).toEqual([{ tier: 'B' }])
  })

  shopTest('a link backfill naming a row the target does not hold is refused', async () => {
    await registered()
    const parent = { column_name: 'parent_supplier', label: 'Parent', column_type: 'Reference', reference_table: 'shop.supplier' }
    await expect(run({ kind: 'addColumn', table: 'shop.supplier', column: parent, backfill: 'nobody' }))
      .rejects.toThrow(/backfill "nobody" names no row of shop.supplier/)
  })

  shopTest('a link backfill naming a row the target holds fills the rows already there', async () => {
    await registered()
    const parent = { column_name: 'parent_supplier', label: 'Parent', column_type: 'Reference', reference_table: 'shop.supplier' }
    await run({ kind: 'addColumn', table: 'shop.supplier', column: parent, backfill: 's1' })
    expect(await sql`select parent_supplier from shop.supplier`).toEqual([{ parent_supplier: 's1' }])
  })

  shopTest('a required default outside the column\'s choices is refused', async () => {
    await registered()
    await expect(run({ kind: 'addColumn', table: 'shop.supplier', column: choice('tier', { reqd: true, default_value: 'Z' }) }))
      .rejects.toThrow(/backfill "Z" is not a value shop.supplier.tier accepts/)
  })
})

describe('a required column stays filled', () => {
  shopTest('narrowing a required Choice fills the cleared rows with its default', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: choice('grade', { reqd: true, default_value: 'A' }) })
    await sql`update shop.supplier set grade = 'C'`
    await run({ kind: 'alterColumn', table: 'shop.supplier', column: 'grade', destructive: true, from: { choices: 'A\nB\nC' }, to: { choices: 'A\nB' } })
    expect(await sql`select grade from shop.supplier`).toEqual([{ grade: 'A' }])
  })

  shopTest('narrowing a required Choice without a default is refused while a row would be left empty', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: choice('grade', { reqd: true }), backfill: 'C' })
    await expect(run({ kind: 'alterColumn', table: 'shop.supplier', column: 'grade', destructive: true, from: { choices: 'A\nB\nC' }, to: { choices: 'A\nB' } }))
      .rejects.toThrow(/1 row holds no value/)
  })

  shopTest('an empty text counts as no value for a required column', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: { column_name: 'note', label: 'Note', column_type: 'Data' } })
    await sql`update shop.supplier set note = ''`
    await expect(run({ kind: 'alterColumn', table: 'shop.supplier', column: 'note', from: { reqd: null }, to: { reqd: true } }))
      .rejects.toThrow(/1 row holds no value/)
  })
})

// #663: a description is display-only, so changing it touches the definition
// and nothing else.
describe('a description change is metadata-only', () => {
  const described = (from: string | null, to: string | null) =>
    ({ kind: 'alterColumn', table: 'shop.supplier', column: 'rating', from: { description: from }, to: { description: to } })
  const ratingDescription = () => sql`select description from column_def where parent = 'shop.supplier' and column_name = 'rating'`
  // Where each row and the table's storage sit: a rewritten row moves (ctid),
  // a rebuilt table gets new storage (relfilenode).
  const storage = async () => ({
    rows: await sql`select row_id, ctid::text as at, rating from shop.supplier order by row_id`,
    file: await sql`select relfilenode from pg_class where oid = 'shop.supplier'::regclass`,
  })

  shopTest('the column records the new description', async () => {
    await registered()
    await run(described(null, 'Stars out of five'))
    expect(await ratingDescription()).toEqual([{ description: 'Stars out of five' }])
  })

  shopTest('a null description removes it', async () => {
    await registered()
    await run(described(null, 'Stars out of five'))
    await run(described('Stars out of five', null))
    expect(await ratingDescription()).toEqual([{ description: null }])
  })

  shopTest('no row is rewritten and the table is not rebuilt', async () => {
    await registered()
    const before = await storage()
    await run(described(null, 'Stars out of five'))
    expect(await storage()).toEqual(before)
  })

  shopTest('it counts no losses', async () => {
    await registered()
    expect(await countLosses('shop', [step([described(null, 'Stars out of five')])])).toEqual([])
  })

  shopTest('it can travel with a type change', async () => {
    await registered()
    await run({ kind: 'alterColumn', table: 'shop.supplier', column: 'rating',
      from: { column_type: 'Int', description: null }, to: { column_type: 'Float', description: 'Average stars' } })
    expect(await sql`select column_type, description from column_def where parent = 'shop.supplier' and column_name = 'rating'`)
      .toEqual([{ column_type: 'Float', description: 'Average stars' }])
  })
})

// #663 review round 1: a required column can hold empty rows (written before
// it became required, or straight into storage). A step that changes only
// what people read leaves them as they are: no fill, no required-value check.
describe('a description change leaves a required column\'s rows alone', () => {
  const grade = (from: string | null, to: string | null) =>
    ({ kind: 'alterColumn', table: 'shop.supplier', column: 'grade', from: { description: from }, to: { description: to } })
  const rows = async () => ({
    rows: await sql`select row_id, ctid::text as at, grade from shop.supplier order by row_id`,
    file: await sql`select relfilenode from pg_class where oid = 'shop.supplier'::regclass`,
  })
  // shop.supplier with a required grade, s1 holding no value and s2 an empty text.
  async function emptyRequired(extra: Record<string, unknown>, backfill?: string) {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: choice('grade', { reqd: true, description: 'Material group grade', ...extra }),
      ...(backfill ? { backfill } : {}) })
    await sql`insert into shop.supplier (row_id, code, rating, grade) values ('s2', 'BOLT', 3, 'B')`
    await sql`update shop.supplier set grade = case row_id when 's1' then null else '' end`
  }

  shopTest('replacing the description of a required column with a default rewrites no row', async () => {
    await emptyRequired({ default_value: 'A' })
    const before = await rows()
    await run(grade('Material group grade', 'Subcategory grade'))
    expect(await rows()).toEqual(before)
  })

  shopTest('removing the description of a required column with a default rewrites no row', async () => {
    await emptyRequired({ default_value: 'A' })
    const before = await rows()
    await run(grade('Material group grade', null))
    expect(await rows()).toEqual(before)
  })

  shopTest('replacing the description of a required column with a default counts no losses', async () => {
    await emptyRequired({ default_value: 'A' })
    expect(await countLosses('shop', [step([grade('Material group grade', 'Subcategory grade')])])).toEqual([])
  })

  shopTest('replacing the description of a required column without a default succeeds and rewrites no row', async () => {
    await emptyRequired({}, 'C')
    const before = await rows()
    await run(grade('Material group grade', 'Subcategory grade'))
    expect(await rows()).toEqual(before)
  })

  shopTest('a type change that carries a description still fills the empty rows', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: { column_name: 'note', label: 'Note', column_type: 'Data' } })
    await run({ kind: 'alterColumn', table: 'shop.supplier', column: 'note', backfill: 'none',
      from: { column_type: 'Data', description: null }, to: { column_type: 'Text', description: 'Anything worth knowing' } })
    expect(await sql`select note from shop.supplier`).toEqual([{ note: 'none' }])
  })
})

describe('losses are counted after the steps before them', () => {
  shopTest('a widening after a marked narrowing loses nothing of its own', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: choice('grade') })
    await sql`update shop.supplier set grade = 'C'`
    const losses = await countLosses('shop', [step([
      { kind: 'alterColumn', table: 'shop.supplier', column: 'grade', destructive: true, from: { choices: 'A\nB\nC' }, to: { choices: 'A\nB' } },
      { kind: 'alterColumn', table: 'shop.supplier', column: 'grade', backfill: 'A', from: { choices: 'A\nB' }, to: { choices: 'A\nB\nD' } },
    ])])
    expect(losses.map(describeLoss)).toEqual(['prune #1 alterColumn shop.supplier.grade: 1 value', 'prune #2 alterColumn shop.supplier.grade: 0 values'])
  })

  shopTest('counting changes nothing', async () => {
    await registered()
    await countLosses('shop', [step([{ kind: 'dropColumn', table: 'shop.supplier', column: lines, destructive: true }])])
    expect(await sql`select row_id from shop.line`).toEqual([{ row_id: 'l1' }])
  })
})

describe('round 2: valid upgrades that used to fail', () => {
  shopTest('another app being disabled does not stop a drop', async () => {
    await registered()
    await ledgerOff()
    await run({ kind: 'dropTable', table: { ...supplier, columns: [...supplier.columns, lines] }, destructive: true })
    expect(await sql`select to_regclass('shop.supplier') as relation`).toEqual([{ relation: null }])
  })

  shopTest('a required Check with default 1 fills the rows already there with true', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: { column_name: 'active', label: 'Active', column_type: 'Check', reqd: true, default_value: '1' } })
    expect(await sql`select active from shop.supplier`).toEqual([{ active: true }])
  })

  shopTest('a required Check with default 0 fills the rows already there with false', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: { column_name: 'active', label: 'Active', column_type: 'Check', reqd: true, default_value: '0' } })
    expect(await sql`select active from shop.supplier`).toEqual([{ active: false }])
  })

  shopTest('turning unique off lets one backfill fill many rows', async () => {
    await registered()
    await sql`insert into shop.supplier (row_id, code) values ('s2', 'BOLT')`
    await run({ kind: 'addColumn', table: 'shop.supplier', column: { column_name: 'badge', label: 'Badge', column_type: 'Data', unique: true } })
    await run({ kind: 'alterColumn', table: 'shop.supplier', column: 'badge', backfill: 'none', from: { unique: true }, to: { unique: null } })
    expect(await sql`select badge from shop.supplier order by row_id`).toEqual([{ badge: 'none' }, { badge: 'none' }])
  })

  shopTest('turning unique on with one backfill for many rows is still refused', async () => {
    await registered()
    await sql`insert into shop.supplier (row_id, code) values ('s2', 'BOLT')`
    await run({ kind: 'addColumn', table: 'shop.supplier', column: { column_name: 'badge', label: 'Badge', column_type: 'Data' } })
    await expect(run({ kind: 'alterColumn', table: 'shop.supplier', column: 'badge', backfill: 'none', from: { unique: null }, to: { unique: true } }))
      .rejects.toThrow(/cannot repeat a value/)
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
