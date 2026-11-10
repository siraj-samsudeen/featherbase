// #910 D3: what the drill pane, map and tree show about a row, composed from
// reads the server already scopes by permission — the row's own Reference
// values, its counted backlinks, and the titles of the rows it points at.
import { describe, expect, test } from 'vitest'
import { backlinkGroups, forwardLinks, linkTitleState, shownCode } from '../src/lib/relations'
import type { ColumnDef, TableMeta } from '../src/lib/meta'
import type { Connection } from '../src/lib/connections'

function column(c: Partial<ColumnDef> & { column_name: string }): ColumnDef {
  return {
    row_id: c.column_name, parent: 'Site', position: 0, label: null, column_type: 'Data', reference_table: null,
    choices: null, row_table: null, reqd: false, unique: false, default_value: null, read_only: false, hidden: false,
    in_list_view: false, tier: 'basic', created_by: '', updated_by: '', created_at: '', updated_at: '', submission_status: '',
    ...c,
  }
}

function meta(columns: ColumnDef[], extra: Partial<TableMeta> = {}): TableMeta {
  return {
    name: 'Site', module: '', kind: 'table', is_submittable: false, id_pattern: 'prompt', title_column: 'site_name',
    sort_column: '', sort_order: 'desc', track_changes: false, description: null, custom: true, system: false,
    created_by: '', updated_by: '', created_at: '', updated_at: '', submission_status: '', position: 0, columns, ...extra,
  }
}

const SITE = meta([
  column({ column_name: 'site_name' }),
  column({ column_name: 'region', label: 'Region', column_type: 'Reference', reference_table: 'Region' }),
  column({ column_name: 'manager', label: 'Manager', column_type: 'Reference', reference_table: 'Person' }),
  column({ column_name: 'secret_owner', label: 'Owner', column_type: 'Reference', reference_table: 'Person', hidden: true }),
])

describe('forwardLinks', () => {
  test('lists each set link of the row with its column label, target table and row', () => {
    expect(forwardLinks(SITE, { site_name: 'Enchakkal', region: 'KL', manager: '' })).toEqual([
      { column: 'region', label: 'Region', table: 'Region', row_id: 'KL' },
    ])
  })

  test('names a link column stored with no label by its column name', () => {
    const bare = meta([column({ column_name: 'zone', column_type: 'Reference', reference_table: 'Zone' })])
    expect(forwardLinks(bare, { zone: 'Z-1' })).toEqual([{ column: 'zone', label: 'zone', table: 'Zone', row_id: 'Z-1' }])
  })

  test('leaves out a link column the caller may not see', () => {
    expect(forwardLinks(SITE, { secret_owner: 'psn_x' })).toEqual([])
  })

  test('a link to a row of any Table points into the Table its row names (#881)', () => {
    const decision = meta([
      column({ column_name: 'shapes_table', label: 'Shapes Table', column_type: 'Reference', reference_table: 'Table' }),
      column({ column_name: 'shapes', label: 'Shapes', column_type: 'Reference', table_column: 'shapes_table' }),
    ], { name: 'Decision' })
    expect(forwardLinks(decision, { shapes_table: 'Plant', shapes: '8151' })).toEqual([
      { column: 'shapes_table', label: 'Shapes Table', table: 'Table', row_id: 'Plant' },
      { column: 'shapes', label: 'Shapes', table: 'Plant', row_id: '8151' },
    ])
    // With no Table chosen there is nowhere to point.
    expect(forwardLinks(decision, { shapes: '8151' })).toEqual([])
  })

  test("a sub-table row points at its parent", () => {
    const line = meta([column({ column_name: 'qty', column_type: 'Int' })], { name: 'PO Line', kind: 'sub_table' })
    expect(forwardLinks(line, { parenttype: 'Purchase Order', parent: 'PO-1' })).toEqual([
      { column: 'parent', label: 'Parent', table: 'Purchase Order', row_id: 'PO-1' },
    ])
  })
})

describe('linkTitleState', () => {
  test('a title the lookup did not return is a row the viewer cannot read', () => {
    expect(linkTitleState({ isPending: false, data: null })).toEqual({ state: 'unreadable' })
  })

  test('a title still on its way is loading', () => {
    expect(linkTitleState({ isPending: true, data: undefined })).toEqual({ state: 'loading' })
  })

  test('a returned title is read', () => {
    expect(linkTitleState({ isPending: false, data: 'Kerala' })).toEqual({ state: 'read', title: 'Kerala' })
  })
})

const plantsOfSite: Connection = { table: 'Plant', column: 'site', via: null, count: 3, filters: [['site', '=', 's-1']] }

describe('backlinkGroups', () => {
  test('one group per connection, named by its table, with its count', () => {
    expect(backlinkGroups([plantsOfSite])).toEqual([
      { key: 'Plant|site|', label: 'Plant', count: 3, connection: plantsOfSite },
    ])
  })

  test('two links from the same table are told apart by their column', () => {
    const second: Connection = { ...plantsOfSite, column: 'backup_site', count: 1, filters: [['backup_site', '=', 's-1']] }
    expect(backlinkGroups([plantsOfSite, second]).map((g) => g.label)).toEqual(['Plant · site', 'Plant · backup_site'])
  })
})

// D5: a link reads by the linked row's name; the code follows only when the
// Table has a title column and its ids are codes people use.
describe('shownCode', () => {
  const PLANT = meta([column({ column_name: 'plant_name' }), column({ column_name: 'plant_code' })], { name: 'Plant', title_column: 'plant_name' })

  test.each(['prompt', 'field:plant_code', 'PLANT-{plant_code}'])('an id named by %s is a code people use', (id_pattern) => {
    expect(shownCode({ ...PLANT, id_pattern }, '1503', 'Enchakkal Supermarket')).toBe('1503')
  })

  test.each(['hash', 'integer', 'opaque:psn_', 'PL-.####'])('an id made up by %s never shows', (id_pattern) => {
    expect(shownCode({ ...PLANT, id_pattern }, 'a1b2c3', 'Enchakkal Supermarket')).toBeUndefined()
  })

  test("a connected Table's ids are its source's keys, which people use", () => {
    expect(shownCode({ ...PLANT, id_pattern: 'hash', data_source: 'erp' }, '1503', 'Enchakkal Supermarket')).toBe('1503')
  })

  test('a Table without a title column shows no code beside its stand-in title', () => {
    expect(shownCode({ ...PLANT, title_column: null }, '1503', '1503 · Supermarket')).toBeUndefined()
  })

  test('a code the name already says is not repeated', () => {
    expect(shownCode(PLANT, 'Kerala', 'Kerala')).toBeUndefined()
  })
})
