import { describe, expect, test } from 'vitest'
import { narrowLists, pickFilter, readPick, splitPicks, togglePick, type NarrowList } from '../src/lib/narrow'
import { parseChain } from '../src/lib/linked-filters'
import type { TableMeta } from '../src/lib/meta'

// #1289 option C, Click To Narrow: which lists a list's panel shows, and how
// a tick becomes the #1276 Linked to filter. Made-up store layout:
// Store ← Section → Floor; Section ← Section Subcategory → Subcategory → Category → Division.

type Col = Partial<TableMeta['columns'][number]> & { column_name: string; column_type: string }
const table = (name: string, columns: Col[], over: Partial<TableMeta> = {}): TableMeta => ({
  name, module: 'Test', kind: 'table', is_submittable: false, id_pattern: 'prompt', title_column: 'title',
  sort_column: 'updated_at', sort_order: 'desc', track_changes: false, description: null, custom: true, system: false,
  columns: [{ column_name: 'title', column_type: 'Data' }, ...columns].map((c) => ({ label: null, hidden: false, ...c })),
  ...over,
} as unknown as TableMeta)
const ref = (column_name: string, reference_table: string, label?: string): Col => ({ column_name, column_type: 'Reference', reference_table, label })

const DIVISION = table('Division', [])
const CATEGORY = table('Category', [ref('division', 'Division')])
const SUBCATEGORY = table('Subcategory', [ref('category', 'Category')])
const STORE = table('Store', [])
const FLOOR = table('Floor', [])
const SECTION = table('Section', [ref('store', 'Store'), ref('floor', 'Floor'), { column_name: 'kind', column_type: 'Choice', choices: 'Fashion\nGrocery', label: 'Kind' }])
const SECSUB = table('Section Subcategory', [ref('section', 'Section'), ref('subcategory', 'Subcategory')], { id_pattern: 'field:title' })
const SECRET = table('Secret', [])
const metas: Record<string, TableMeta | null> = Object.fromEntries(
  [DIVISION, CATEGORY, SUBCATEGORY, STORE, FLOOR, SECTION, SECSUB].map((m) => [m.name, m]))
metas.Secret = null // the viewer may not read it
const metaOf = (t: string) => metas[t]
const sectionBacklinks = [{ table: 'Section Subcategory', column: 'section', via: null }]

const view = (l: NarrowList) => [l.label, l.through ?? '', JSON.stringify(l.path)]

describe('narrowLists', () => {
  test('a link table lists every table its links reach, up to three links, each once, named by its table', () => {
    const { lists, missing } = narrowLists(SECSUB, [], metaOf)
    expect(missing).toEqual([])
    expect(lists.map(view)).toEqual([
      ['Section', '', '[{"column":"section"}]'],
      ['Subcategory', '', '[{"column":"subcategory"}]'],
      ['Store', 'Section', '[{"column":"section"},{"column":"store"}]'],
      ['Floor', 'Section', '[{"column":"section"},{"column":"floor"}]'],
      ['Category', 'Subcategory', '[{"column":"subcategory"},{"column":"category"}]'],
      ['Division', 'Subcategory', '[{"column":"subcategory"},{"column":"category"},{"column":"division"}]'],
    ])
  })

  test("a table also lists its own rows, the far side of a link table and beyond, and its Choice columns", () => {
    const { lists } = narrowLists(SECTION, sectionBacklinks, metaOf)
    expect(lists.map(view)).toEqual([
      ['Store', '', '[{"column":"store"}]'],
      ['Floor', '', '[{"column":"floor"}]'],
      ['Section', '', '[]'],
      ['Subcategory', 'Section Subcategory', '[{"from":"Section Subcategory","column":"section"},{"column":"subcategory"}]'],
      ['Category', 'Section Subcategory', '[{"from":"Section Subcategory","column":"section"},{"column":"subcategory"},{"column":"category"}]'],
      ['Kind', '', '[{"column":"kind"}]'],
    ])
  })

  test('a table whose metadata is still loading is waited for; one the viewer may not read is left out', () => {
    const withSecret = table('Audit', [ref('store', 'Store'), ref('secret', 'Secret'), ref('pending', 'Pending')])
    const { lists, missing } = narrowLists(withSecret, [], metaOf)
    expect(lists.map((l) => l.label)).toEqual(['Store', 'Audit'])
    expect(missing).toEqual(['Pending'])
  })
})

describe('a tick is a Linked to filter', () => {
  const lists = narrowLists(SECTION, sectionBacklinks, metaOf).lists
  const [store, , own, subcategory, category, kind] = lists

  test('a forward link picks rows of its table; a two-step path is a chain the chips already read', () => {
    expect(pickFilter(store, ['Bayside'])).toEqual(['store', 'related', { table: 'Store', filters: [['row_id', 'in', ['Bayside']]] }])
    const chain = parseChain(pickFilter(category, ['Staples'])!)
    expect(chain?.steps.map((s) => [s.table, s.link.kind, s.picked])).toEqual([['Subcategory', 'through', []], ['Category', 'forward', ['Staples']]])
  })

  test('"Not linked" is the Not linked to filter; own rows and Choice values are plain filters', () => {
    expect(pickFilter(store, 'none')).toEqual(['store', 'not related', { table: 'Store', filters: [] }])
    expect(pickFilter(own, ['Grocery'])).toEqual(['row_id', 'in', ['Grocery']])
    expect(pickFilter(kind, ['Fashion'])).toEqual(['kind', 'in', ['Fashion']])
    expect(pickFilter(kind, 'none')).toEqual(['kind', 'is blank', null])
    expect(pickFilter(store, [])).toBeNull()
  })

  test('every pick reads back as its list, and a filter of another shape belongs to none', () => {
    for (const [list, picked] of [[store, ['Bayside']], [store, 'none'], [own, ['Grocery']], [subcategory, ['Rava', 'Churidar']], [category, 'none'], [kind, 'none']] as const)
      expect(readPick(list, pickFilter(list, picked as string[] | 'none')!)).toEqual(picked)
    expect(readPick(store, ['store', '=', 'Bayside'])).toBeNull()
    expect(readPick(subcategory, pickFilter(category, ['Staples'])!)).toBeNull()
  })

  test("splitPicks separates the panel's picks from the list's other filters", () => {
    const other = ['title', 'like', '%wear%'] as [string, string, unknown]
    const { base, picks } = splitPicks(lists, [other, pickFilter(store, ['Bayside'])!, pickFilter(kind, 'none')!])
    expect(base).toEqual([other])
    expect(picks).toEqual([['Bayside'], null, null, null, null, 'none'])
  })

  test('a tick adds and removes a value; "Not linked" replaces the other picks of its list and the reverse', () => {
    let filters = togglePick(lists, [], 0, 'Bayside')
    filters = togglePick(lists, filters, 0, 'Northgate')
    expect(splitPicks(lists, filters).picks[0]).toEqual(['Bayside', 'Northgate'])
    filters = togglePick(lists, filters, 0, null)
    expect(splitPicks(lists, filters).picks[0]).toEqual('none')
    filters = togglePick(lists, filters, 0, 'Bayside')
    expect(splitPicks(lists, filters).picks[0]).toEqual(['Bayside'])
    expect(togglePick(lists, filters, 0, 'Bayside')).toEqual([])
  })
})
