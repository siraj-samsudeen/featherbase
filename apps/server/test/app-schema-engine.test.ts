// #651: the table-engine paths an app upgrade runs. One engine: Admin and app
// migrations share these, so there is no second schema writer.
import { describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { test } from './pg-test'
import { sql } from '../src/db'
import { provisionApp } from '../src/app-lifecycle'
import { discoverPackages } from '../src/runtime-packages'
import { changeColumnType, createTable, deleteTable } from '../src/table-engine'
import { renameColumn, renameTable } from '../src/table-rename'
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
  shopTest('#855: the renamed Table carries on its row count', async () => {
    await shop()
    await sql`insert into series (name, current) values ('table:shop.supplier:', 41), ('table:shop.supplier:SUP-', 7)`
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    expect(await sql`select name, current from series where name like 'table:shop.%' order by name`).toEqual([
      { name: 'table:shop.vendor:', current: 41 },
      { name: 'table:shop.vendor:SUP-', current: 7 },
    ])
  })

  shopTest('#855: a rename onto the name of a deleted Table takes over its counts', async () => {
    await shop()
    await sql`insert into series (name, current) values ('table:shop.supplier:', 41), ('table:shop.vendor:', 9)`
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    expect(await sql`select name, current from series where name like 'table:shop.%' order by name`).toEqual([
      { name: 'table:shop.vendor:', current: 41 },
    ])
  })

  shopTest('rows are kept under the new name', async () => {
    await shop()
    await renameTable('shop.supplier', 'shop.vendor', 'shop')
    expect(await sql`select row_id, code, rating from shop.vendor`).toEqual([{ row_id: 's1', code: 'ACME', rating: 4 }])
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
    await sql`insert into permission (row_id, ref_table, role, operation, scope_mode) values ('p651', 'shop.supplier', 'Buyer', 'read', 'all')`
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
    expect(await sql`select row_id, on_hold from shop.flag order by row_id`).toEqual([{ row_id: 'f1', on_hold: 1 }, { row_id: 'f2', on_hold: 0 }])
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

  shopTest('several Sub-table rows that go with a Table are counted in the plural', async () => {
    await registered()
    await sql`insert into shop.line (row_id, parent, parenttype, parentfield, qty) values ('l2', 's1', 'shop.supplier', 'lines', 3)`
    const losses = await countLosses('shop', [step([{ kind: 'dropTable', table: { ...supplier, columns: [...supplier.columns, lines] }, destructive: true }])])
    expect(losses.map(describeLoss)).toEqual(['prune #1 dropTable shop.supplier: 1 row and 2 Sub-table rows'])
  })

  shopTest('a Sub-table column whose line Table is not the app\'s own counts and removes no lines', async () => {
    await registered()
    await sql`update table_def set owner_app = 'elsewhere' where name = 'shop.line'`
    const drop = step([{ kind: 'dropColumn', table: 'shop.supplier', column: lines, destructive: true }])
    expect((await countLosses('shop', [drop])).map(describeLoss)).toEqual(['prune #1 dropColumn shop.supplier.lines: 0 values'])
    await applyMigrations([drop], 'shop')
    expect(await sql`select row_id from shop.line`).toEqual([{ row_id: 'l1' }])
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

  shopTest('narrowing a Choice refuses while several values would be cleared, naming how many', async () => {
    await registered()
    await sql`insert into shop.supplier (row_id, code, rating) values ('s2', 'BETA', 2)`
    await run({ kind: 'addColumn', table: 'shop.supplier', column: choice('grade'), backfill: 'C' })
    await expect(run({ kind: 'alterColumn', table: 'shop.supplier', column: 'grade', from: { choices: 'A\nB\nC' }, to: { choices: 'A\nB' } }))
      .rejects.toThrow(/would clear 2 values outside its new choices/)
  })

  shopTest('narrowing a required Choice is refused while several rows would be left empty', async () => {
    await registered()
    await sql`insert into shop.supplier (row_id, code, rating) values ('s2', 'BETA', 2)`
    await run({ kind: 'addColumn', table: 'shop.supplier', column: choice('grade', { reqd: true }), backfill: 'C' })
    await expect(run({ kind: 'alterColumn', table: 'shop.supplier', column: 'grade', destructive: true, from: { choices: 'A\nB\nC' }, to: { choices: 'A\nB' } }))
      .rejects.toThrow(/2 rows hold no value/)
  })

  shopTest('a text column turned into a Choice with no choices is refused', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: { column_name: 'note', label: 'Note', column_type: 'Data' }, backfill: 'free text' })
    await expect(run({ kind: 'alterColumn', table: 'shop.supplier', column: 'note', destructive: true, from: { column_type: 'Data' }, to: { column_type: 'Choice' } }))
      .rejects.toThrow('Invalid Table definition')
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

  shopTest('turning unique on after a valid backfill enforces uniqueness on later writes', async () => {
    await registered()
    await run({ kind: 'addColumn', table: 'shop.supplier', column: { column_name: 'badge', label: 'Badge', column_type: 'Data' } })
    await run({ kind: 'alterColumn', table: 'shop.supplier', column: 'badge', backfill: 'first', from: { unique: null }, to: { unique: true } })
    expect(await sql`select badge from shop.supplier`).toEqual([{ badge: 'first' }])
    await expect(sql.begin(tx => tx`insert into shop.supplier (row_id, code, badge) values ('s2', 'BOLT', 'first')`))
      .rejects.toMatchObject({ code: '23505' })
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

describe('loss preview uses installed ownership', () => {
  test('a foreign Table aborts the preview without retaining earlier steps', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/fixtures/evolve-v1')])
    await admin.post('/api/install_app', { name: 'evolve' })
    await admin.post('/api/save_row', { table: 'evolve.item', row: { row_id: 'i1', title: 'Keep this item', qty: 3 } })
    const before = await sql`select tables, migration_ledger from installed_app where name = 'evolve'`
    const migration = step([
      { kind: 'addTable', table: { name: 'evolve.audit', label: 'Audit', columns: [{ column_name: 'note', label: 'Note', column_type: 'Text' }] } },
      { kind: 'dropTable', table: { name: 'Person', label: 'Person', columns: [{ column_name: 'full_name', column_type: 'Data' }] }, destructive: true },
    ])
    await expect(countLosses('evolve', [migration])).rejects.toMatchObject({
      type: 'ValidationError',
      message: "dropTable Person: Person is not one of evolve's Tables here; restore the app's metadata before retrying",
    })
    expect(await sql`select to_regclass('evolve.audit') as relation`).toEqual([{ relation: null }])
    expect(await sql`select name from table_def where name = 'evolve.audit'`).toEqual([])
    expect(await sql`select tables, migration_ledger from installed_app where name = 'evolve'`).toEqual(before)
    expect(await sql`select row_id, title, qty from evolve.item`).toEqual([{ row_id: 'i1', title: 'Keep this item', qty: 3 }])
  })

  test('a missing stored Table is refused before any drop is attempted', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/fixtures/evolve-v1')])
    await admin.post('/api/install_app', { name: 'evolve' })
    const before = await sql`select tables, migration_ledger from installed_app where name = 'evolve'`
    await expect(countLosses('evolve', [step([
      { kind: 'dropTable', table: { name: 'evolve.absent', label: 'Absent', columns: [{ column_name: 'note', column_type: 'Text' }] }, destructive: true },
    ])])).rejects.toMatchObject({
      type: 'ValidationError',
      message: "dropTable evolve.absent: evolve.absent is not one of evolve's Tables here; restore the app's metadata before retrying",
    })
    expect(await sql`select tables, migration_ledger from installed_app where name = 'evolve'`).toEqual(before)
  })

  test('an overflowing Currency backfill is reported without retaining its column', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/fixtures/evolve-v1')])
    await admin.post('/api/install_app', { name: 'evolve' })
    await admin.post('/api/save_row', { table: 'evolve.item', row: { row_id: 'i1', title: 'Keep this item', qty: 3 } })
    const before = await sql`select tables, migration_ledger from installed_app where name = 'evolve'`
    await expect(countLosses('evolve', [step([
      { kind: 'addColumn', table: 'evolve.item', column: { column_name: 'cost', label: 'Cost', column_type: 'Currency' }, backfill: 1e20 },
    ])])).rejects.toMatchObject({
      type: 'ValidationError', message: 'The upgrade would fail here: numeric field overflow',
    })
    expect(await sql`select column_name from column_def where parent = 'evolve.item' and column_name = 'cost'`).toEqual([])
    expect(await sql`select column_name from information_schema.columns where table_schema = 'evolve' and table_name = 'item' and column_name = 'cost'`).toEqual([])
    expect(await sql`select tables, migration_ledger from installed_app where name = 'evolve'`).toEqual(before)
    expect(await sql`select row_id, title, qty from evolve.item`).toEqual([{ row_id: 'i1', title: 'Keep this item', qty: 3 }])
  })

  test('dropping a layout column reports no stored values', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'test-apps/fixtures/evolve-v1')])
    await admin.post('/api/install_app', { name: 'evolve' })
    await admin.post('/api/save_row', { table: 'evolve.item', row: { row_id: 'i1', title: 'Keep this item', qty: 3 } })
    const section = { column_name: 'details', label: 'Details', column_type: 'Section Break' }
    const migration = step([
      { kind: 'addColumn', table: 'evolve.item', column: section },
      { kind: 'dropColumn', table: 'evolve.item', column: section, destructive: true },
    ])
    expect((await countLosses('evolve', [migration])).map(describeLoss))
      .toEqual(['prune #2 dropColumn evolve.item.details: 0 values'])
    expect(await sql`select column_name from column_def where parent = 'evolve.item' and column_name = 'details'`).toEqual([])
    expect(await sql`select row_id, title, qty from evolve.item`).toEqual([{ row_id: 'i1', title: 'Keep this item', qty: 3 }])
  })
})

// #911: an app version turns a code column into a link, in place.
describe('a text column becomes a link', () => {
  const linkCode = (to: Record<string, unknown> = { column_type: 'Reference', reference_table: 'Role' }) =>
    ({ kind: 'alterColumn', table: 'shop.supplier', column: 'code', from: { column_type: 'Data', reference_table: null }, to })

  shopTest('every code names a row, so the column becomes a link and keeps its values', async () => {
    await registered()
    await sql`insert into role (row_id) values ('ACME') on conflict do nothing`
    await run(linkCode())
    expect(await sql`select column_type, reference_table from column_def where parent = 'shop.supplier' and column_name = 'code'`)
      .toEqual([{ column_type: 'Reference', reference_table: 'Role' }])
    expect(await sql`select code from shop.supplier`).toEqual([{ code: 'ACME' }])
  })

  shopTest('a code with no row refuses the upgrade, naming it, and the column stays text', async () => {
    await registered()
    await expect(run(linkCode())).rejects.toThrow(/ACME names no Role row/)
    expect(await sql`select column_type, reference_table from column_def where parent = 'shop.supplier' and column_name = 'code'`)
      .toEqual([{ column_type: 'Data', reference_table: null }])
  })

  test('a link without the Table it links to is refused', () => {
    expect(() => step([linkCode({ column_type: 'Reference', reference_table: null })])).toThrow(/a link needs the Table it links to/)
  })

  test('a link turning into text names the Table it leaves, and keeps none', () => {
    const toText = (from: Record<string, unknown>, to: Record<string, unknown>) =>
      () => step([{ kind: 'alterColumn', table: 'shop.order', column: 'supplier', from, to }])
    expect(toText({ column_type: 'Reference' }, { column_type: 'Data' })).toThrow(/names the Table it links to and from/)
    expect(toText({ column_type: 'Reference', reference_table: 'shop.supplier' }, { column_type: 'Data', reference_table: 'shop.supplier' }))
      .toThrow(/text links to no Table/)
    expect(toText({ column_type: 'Reference', reference_table: 'shop.supplier' }, { column_type: 'Data', reference_table: null })).not.toThrow()
  })

  shopTest('a link to a row of any Table does not turn into text', async () => {
    await registered()
    await createTable({ name: 'shop.audit', label: 'Audit', columns: [
      { column_name: 'about_table', label: 'About Table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'about', label: 'About', column_type: 'Reference', table_column: 'about_table' },
    ] }, 'shop')
    await expect(changeColumnType('shop.audit', 'about', 'Data')).rejects.toThrow(/link to a row of any Table/)
  })

  shopTest('a link turns back into text and links to no Table', async () => {
    await shop()
    await changeColumnType('shop.order', 'supplier', 'Data')
    expect(await sql`select column_type, reference_table from column_def where parent = 'shop.order' and column_name = 'supplier'`)
      .toEqual([{ column_type: 'Data', reference_table: null }])
  })

  shopTest('the engine refuses a link with no Table', async () => {
    await shop()
    await expect(changeColumnType('shop.supplier', 'code', 'Reference')).rejects.toThrow(/a link needs the Table it links to/)
  })

  test("a link's Table cannot be swapped on its own", () => {
    expect(() => step([{ kind: 'alterColumn', table: 'shop.supplier', column: 'code', from: { reference_table: null }, to: { reference_table: 'Role' } }]))
      .toThrow(/changes only when a text column becomes a link/)
  })
})
