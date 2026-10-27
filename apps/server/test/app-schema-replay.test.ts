// #651: the replay contract for every app migration operation. The final
// declaration of an app version equals its baseline plus the replayed
// history; these are the pure (no database) halves of that contract.
import { describe, expect, test } from 'vitest'
import { migrationSchema, replayForward, validateMigrations } from '../src/runtime-migrations'
import type { TableDef } from '../src/table-engine'

const item = (columns: TableDef['columns'] = [{ column_name: 'title', label: 'Title', column_type: 'Data' }]): TableDef =>
  ({ name: 'shop.item', label: 'Item', columns })
const step = (operations: unknown[], fromVersion = '0.1.0', toVersion = '0.2.0', id = 'step_one') =>
  migrationSchema.parse({ id, fromVersion, toVersion, operations })
const refusal = (fn: () => unknown) => { try { fn() } catch (error) { return (error as Error).message } return 'not refused' }

const supplier: TableDef = { name: 'shop.supplier', label: 'Supplier', columns: [{ column_name: 'supplier_name', label: 'Name', column_type: 'Data' }] }

describe('addTable', () => {
  test('a history that adds a Table replays to the declaration that holds it', () => {
    expect(() => validateMigrations('shop', '0.2.0', [item(), supplier], [step([{ kind: 'addTable', table: supplier }])])).not.toThrow()
  })

  test('the added Table must match its final declaration', () => {
    const declared = { ...supplier, label: 'Vendor' }
    expect(refusal(() => validateMigrations('shop', '0.2.0', [item(), declared], [step([{ kind: 'addTable', table: supplier }])])))
      .toMatch(/shop\.supplier/)
  })

  test('an added Table outside the app is refused', () => {
    const foreign = { ...supplier, name: 'other.supplier' }
    expect(refusal(() => replayForward('shop', [item()], [{ kind: 'addTable', table: foreign }])))
      .toMatch(/only its own Tables/)
  })

  test('an added Table may be a Sub-table that a later column holds', () => {
    const line: TableDef = { name: 'shop.line', label: 'Line', kind: 'sub_table', columns: [{ column_name: 'qty', label: 'Qty', column_type: 'Int' }] }
    const lines = { column_name: 'lines', label: 'Lines', column_type: 'Sub-table' as const, row_table: 'shop.line' }
    const tables = replayForward('shop', [item()], [
      { kind: 'addTable', table: line },
      { kind: 'addColumn', table: 'shop.item', column: lines },
    ])
    expect(tables.find(t => t.name === 'shop.item')!.columns.at(-1)).toEqual(lines)
  })

  test('a Sub-table column naming a Table the app has not added is refused', () => {
    const lines = { column_name: 'lines', label: 'Lines', column_type: 'Sub-table' as const, row_table: 'shop.line' }
    expect(refusal(() => replayForward('shop', [item()], [{ kind: 'addColumn', table: 'shop.item', column: lines }])))
      .toMatch(/shop\.line/)
  })
})

describe('dropTable', () => {
  test('dropping a Table without destructive: true is refused', () => {
    expect(refusal(() => replayForward('shop', [item(), supplier], [{ kind: 'dropTable', table: supplier }])))
      .toMatch(/destructive: true/)
  })

  test('a destructive drop replays to a declaration without the Table', () => {
    expect(() => validateMigrations('shop', '0.2.0', [item()], [step([{ kind: 'dropTable', table: supplier, destructive: true }])])).not.toThrow()
  })

  test('a Table another Table still links to cannot be dropped', () => {
    const linked = item([...item().columns, { column_name: 'supplier', label: 'Supplier', column_type: 'Reference', reference_table: 'shop.supplier' }])
    expect(refusal(() => replayForward('shop', [linked, supplier], [{ kind: 'dropTable', table: supplier, destructive: true }])))
      .toMatch(/shop\.item\.supplier/)
  })

  test('the dropped Table must be declared as it stood', () => {
    expect(refusal(() => replayForward('shop', [item(), supplier], [{ kind: 'dropTable', table: { ...supplier, label: 'Vendor' }, destructive: true }])))
      .toMatch(/as it stood/)
  })
})

describe('addColumn', () => {
  const grade = { column_name: 'grade', label: 'Grade', column_type: 'Choice' as const, choices: 'A\nB' }
  test('a column inserted at a declared position lands there', () => {
    const tables = replayForward('shop', [item()], [{ kind: 'addColumn', table: 'shop.item', column: grade, position: 1 }])
    expect(tables[0].columns.map(c => c.column_name)).toEqual(['grade', 'title'])
  })

  test('history with a positioned column replays back to its baseline', () => {
    const final = item([grade, ...item().columns])
    expect(() => validateMigrations('shop', '0.2.0', [final], [step([{ kind: 'addColumn', table: 'shop.item', column: grade, position: 1 }])])).not.toThrow()
  })

  test('a required column with neither a default nor a backfill is refused', () => {
    expect(refusal(() => replayForward('shop', [item()], [{ kind: 'addColumn', table: 'shop.item', column: { ...grade, reqd: true } }])))
      .toMatch(/default_value or a backfill/)
  })

  test('a required column with a backfill is accepted', () => {
    expect(() => replayForward('shop', [item()], [{ kind: 'addColumn', table: 'shop.item', column: { ...grade, reqd: true }, backfill: 'A' }])).not.toThrow()
  })

  test('a link column may name a platform Table', () => {
    const owner = { column_name: 'owner', label: 'Owner', column_type: 'Reference' as const, reference_table: 'Person' }
    expect(() => replayForward('shop', [item()], [{ kind: 'addColumn', table: 'shop.item', column: owner }])).not.toThrow()
  })

  test('a column on a platform Table is refused', () => {
    expect(refusal(() => replayForward('shop', [item()], [{ kind: 'addColumn', table: 'Person', column: grade }])))
      .toMatch(/only its own Tables/)
  })

  test('a unique column cannot be backfilled with one value', () => {
    expect(refusal(() => replayForward('shop', [item()], [{ kind: 'addColumn', table: 'shop.item', column: { ...grade, unique: true }, backfill: 'A' }])))
      .toMatch(/unique/)
  })
})

describe('alterColumn', () => {
  const qty = { column_name: 'qty', label: 'Qty', column_type: 'Int' as const }
  test('a safe type change replays both ways', () => {
    const final = item([{ ...qty, column_type: 'Float' }])
    expect(() => validateMigrations('shop', '0.2.0', [final], [step([{ kind: 'alterColumn', table: 'shop.item', column: 'qty',
      from: { column_type: 'Int' }, to: { column_type: 'Float' } }])])).not.toThrow()
  })

  test('a type change outside the safe list is refused', () => {
    expect(refusal(() => replayForward('shop', [item([qty])], [{ kind: 'alterColumn', table: 'shop.item', column: 'qty',
      from: { column_type: 'Int' }, to: { column_type: 'Date' } }])))
      .toMatch(/Int to Date is not a safe conversion/)
  })

  test('the from values must be what the column holds', () => {
    expect(refusal(() => replayForward('shop', [item([qty])], [{ kind: 'alterColumn', table: 'shop.item', column: 'qty',
      from: { label: 'Quantity' }, to: { label: 'Count' } }])))
      .toMatch(/does not hold/)
  })

  test('from and to name the same properties', () => {
    expect(() => step([{ kind: 'alterColumn', table: 'shop.item', column: 'qty', from: { label: 'Qty' }, to: { hidden: true } }])).toThrow()
  })

  test('a description change replays both ways', () => {
    const final = item([{ ...qty, description: 'Units per subcategory' }])
    expect(() => validateMigrations('shop', '0.2.0', [final], [step([{ kind: 'alterColumn', table: 'shop.item', column: 'qty',
      from: { description: 'Units per material group' }, to: { description: 'Units per subcategory' } }])])).not.toThrow()
  })

  test('a description that is not text is refused', () => {
    const parsed = migrationSchema.safeParse({ id: 'step_one', fromVersion: '0.1.0', toVersion: '0.2.0',
      operations: [{ kind: 'alterColumn', table: 'shop.item', column: 'qty', from: { description: null }, to: { description: 5 } }] })
    expect(parsed.error?.issues).toEqual([expect.objectContaining({ path: ['operations', 0, 'to', 'description'], message: expect.stringMatching(/expected string/i) })])
  })

  test('a step that changes only what people read takes no backfill', () => {
    const parsed = migrationSchema.safeParse({ id: 'step_one', fromVersion: '0.1.0', toVersion: '0.2.0',
      operations: [{ kind: 'alterColumn', table: 'shop.item', column: 'qty', backfill: 1,
        from: { label: 'Qty', description: null }, to: { label: 'Quantity', description: 'Units counted' } }] })
    expect(parsed.error?.issues).toEqual([expect.objectContaining({ path: ['operations', 0, 'backfill'],
      message: 'alterColumn changes only what people read (label, description, hidden), so it takes no backfill' })])
  })

  test('a null in to removes the property', () => {
    const tables = replayForward('shop', [item([{ ...qty, default_value: '1' }])], [{ kind: 'alterColumn', table: 'shop.item', column: 'qty',
      from: { default_value: '1' }, to: { default_value: null } }])
    expect(tables[0].columns[0]).toEqual(qty)
  })
})

describe('renameColumn', () => {
  test('a rename replays to the renamed column', () => {
    const final = item([{ column_name: 'heading', label: 'Title', column_type: 'Data' }])
    expect(() => validateMigrations('shop', '0.2.0', [final], [step([{ kind: 'renameColumn', table: 'shop.item', from: 'title', to: 'heading' }])])).not.toThrow()
  })

  test('the Table title column follows the rename', () => {
    const tables = replayForward('shop', [{ ...item(), title_column: 'title' }], [{ kind: 'renameColumn', table: 'shop.item', from: 'title', to: 'heading' }])
    expect(tables[0].title_column).toBe('heading')
  })

  test('renaming onto an existing column is refused', () => {
    const two = item([...item().columns, { column_name: 'heading', label: 'H', column_type: 'Data' }])
    expect(refusal(() => replayForward('shop', [two], [{ kind: 'renameColumn', table: 'shop.item', from: 'title', to: 'heading' }])))
      .toMatch(/already has/)
  })
})

describe('dropColumn', () => {
  const notes = { column_name: 'notes', label: 'Notes', column_type: 'Text' as const }
  test('dropping a column without destructive: true is refused', () => {
    expect(refusal(() => replayForward('shop', [item([...item().columns, notes])], [{ kind: 'dropColumn', table: 'shop.item', column: notes }])))
      .toMatch(/destructive: true/)
  })

  test('a positioned drop replays back to its baseline', () => {
    expect(() => validateMigrations('shop', '0.2.0', [item()], [step([{ kind: 'dropColumn', table: 'shop.item', column: notes, position: 1, destructive: true }])])).not.toThrow()
  })

  test('the dropped column must be declared as it stood', () => {
    expect(refusal(() => replayForward('shop', [item([...item().columns, notes])], [{ kind: 'dropColumn', table: 'shop.item',
      column: { ...notes, label: 'Remarks' }, destructive: true }])))
      .toMatch(/as it stood/)
  })

  test('the Table title column cannot be dropped', () => {
    expect(refusal(() => replayForward('shop', [{ ...item([...item().columns, notes]), title_column: 'notes' }], [{ kind: 'dropColumn', table: 'shop.item', column: notes, destructive: true }])))
      .toMatch(/title/)
  })
})

describe('renameTable', () => {
  test('links to a renamed Table follow it', () => {
    const linked = item([...item().columns, { column_name: 'supplier', label: 'Supplier', column_type: 'Reference', reference_table: 'shop.supplier' }])
    const tables = replayForward('shop', [linked, supplier], [{ kind: 'renameTable', from: 'shop.supplier', to: 'shop.vendor' }])
    expect(tables.find(t => t.name === 'shop.item')!.columns[1].reference_table).toBe('shop.vendor')
  })

  test('a rename replays both ways', () => {
    expect(() => validateMigrations('shop', '0.2.0', [item(), { ...supplier, name: 'shop.vendor' }],
      [step([{ kind: 'renameTable', from: 'shop.supplier', to: 'shop.vendor' }])])).not.toThrow()
  })

  test('renaming to a name outside the app is refused', () => {
    expect(refusal(() => replayForward('shop', [item(), supplier], [{ kind: 'renameTable', from: 'shop.supplier', to: 'other.vendor' }])))
      .toMatch(/only its own Tables/)
  })

  test('the scope mark travels with the renamed Table', () => {
    const tables = replayForward('shop', [{ ...supplier, decides_scope: true }], [{ kind: 'renameTable', from: 'shop.supplier', to: 'shop.vendor' }])
    expect(tables[0]).toMatchObject({ name: 'shop.vendor', decides_scope: true })
  })
})

describe('history', () => {
  test('a history that stops short of the version is refused', () => {
    expect(refusal(() => validateMigrations('shop', '0.3.0', [item()], [step([])])))
      .toMatch(/does not reach/)
  })

  test('the unchanged addColumn checksum of an installed history', () => {
    // A ledger recorded before #651 must still match: parsing adds nothing.
    const legacy = { id: 'add_notes', fromVersion: '0.0.1', toVersion: '2.0.0',
      operations: [{ kind: 'addColumn', table: 'other.task', column: { column_name: 'notes', label: 'Notes', column_type: 'Text' } }] }
    expect(migrationSchema.parse(legacy)).toEqual(legacy)
  })
})
