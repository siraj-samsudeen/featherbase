// #910 D1/D2: the navigation path — every drill and filter is a step, kept in
// one address parameter as identities only (row ids, column names, never
// names). The address is user input, so decoding discards what is malformed
// and never throws.
import { describe, expect, it } from 'vitest'
import {
  EMPTY_PATH,
  MAX_RECENT,
  MAX_STEPS,
  back,
  decodePath,
  decodeRecent,
  encodePath,
  forward,
  go,
  push,
  rememberPath,
  replace,
  rememberWalk,
  stepKind,
  stepRefs,
  type NavPath,
  type NavStep,
} from '../src/lib/nav-path'

const sites: NavStep = { screen: 'list', table: 'Site' }
const kerala: NavStep = { screen: 'list', table: 'Site', filters: [['state', '=', 'KL']] }
const enchakkal: NavStep = {
  ...kerala,
  pane: { table: 'Site', row: 'site-1', group: { table: 'Plant', column: 'site', via: null } },
}
const supermarket: NavStep = { ...kerala, pane: { table: 'Plant', row: 'plant-7' } }
const listStep = (n: number): NavStep => ({ screen: 'list', table: `T${n}` })

const walk = (...steps: NavStep[]): NavPath => steps.reduce(push, EMPTY_PATH)

describe('push', () => {
  it('appends a step and makes it current', () => {
    const path = walk(sites, kerala)
    expect(path.steps).toEqual([sites, kerala])
    expect(path.at).toBe(1)
  })

  it('drops the steps after the current one before appending', () => {
    const path = push(back(walk(sites, kerala, enchakkal)), supermarket)
    expect(path.steps).toEqual([sites, kerala, supermarket])
    expect(path.at).toBe(2)
  })

  it('ignores a step equal to the current one', () => {
    const path = walk(sites, kerala)
    expect(push(path, { table: 'Site', filters: [['state', '=', 'KL']], screen: 'list' })).toEqual(path)
  })

  it('a step showing the same row as the current one takes its place, so no name shows twice in a row', () => {
    const page: NavStep = { screen: 'row', table: 'Site', row: 'site-1' }
    const withGroup: NavStep = { ...page, pane: { table: 'Site', row: 'site-1', group: { table: 'Plant', column: 'site' } } }
    expect(push(walk(sites, page), withGroup).steps).toEqual([sites, withGroup])
  })

  it('centring the page on the row in the pane takes the place of the step that showed it there', () => {
    const page: NavStep = { screen: 'row', table: 'Site', row: 'site-1' }
    const inPane: NavStep = { ...page, pane: { table: 'State', row: 'KL' } }
    const centred: NavStep = { screen: 'row', table: 'State', row: 'KL' }
    expect(push(walk(page, inPane), centred).steps).toEqual([page, centred])
  })

  it('a filter after selecting a row is a new step after it', () => {
    const selected: NavStep = { ...sites, pane: { table: 'Site', row: 'site-1' } }
    const filtered: NavStep = { ...selected, filters: [['state', '=', 'KL']] }
    expect(push(walk(sites, selected), filtered).steps).toEqual([sites, selected, filtered])
  })

  it(`keeps only the last ${MAX_STEPS} steps`, () => {
    const path = walk(...Array.from({ length: MAX_STEPS + 3 }, (_, i) => listStep(i)))
    expect(path.steps).toHaveLength(MAX_STEPS)
    expect(path.steps[0]).toEqual(listStep(3))
    expect(path.at).toBe(MAX_STEPS - 1)
  })
})

describe('go, back and forward', () => {
  const path = walk(sites, kerala, enchakkal)

  it('go moves to the chosen step without losing later ones', () => {
    expect(go(path, 0)).toEqual({ steps: path.steps, at: 0 })
  })

  it('go clamps an index past either end', () => {
    expect(go(path, -5).at).toBe(0)
    expect(go(path, 99).at).toBe(2)
  })

  it('back stops at the first step', () => {
    expect(back(back(back(back(path)))).at).toBe(0)
  })

  it('forward stops at the last step', () => {
    expect(forward(forward(go(path, 1))).at).toBe(2)
  })

  it('leaves an empty path empty', () => {
    expect(back(EMPTY_PATH)).toEqual(EMPTY_PATH)
    expect(forward(EMPTY_PATH)).toEqual(EMPTY_PATH)
  })
})

describe('encodePath / decodePath', () => {
  it('round-trips every field of a step', () => {
    const full: NavStep = {
      screen: 'row',
      table: 'Site',
      row: 'site-1',
      filters: [['state', 'in', ['KL', 'TN']], ['open', '=', true]],
      pane: { table: 'Plant', row: 'plant-7', group: { table: 'Machine', column: 'plant', via: 'lines' }, tab: 'fields' },
      view: 'tree',
      expanded: ['site-1', 'plant-7'],
      place: 'bottom',
      compact: true,
    }
    const path = go(walk(sites, kerala, full), 1)
    expect(decodePath(encodePath(path))).toEqual(path)
  })

  it("round-trips a group's relationship filter through a sub-table", () => {
    // The :connections filter for a backlink through a sub-table (row-connections.ts).
    const contains: NavStep = {
      screen: 'list',
      table: 'Purchase Order',
      filters: [['row_id', 'related', { via: 'PO Line', column: 'item', table: 'Item', filters: [['row_id', '=', 'item-3']] }]],
    }
    const path = walk(sites, contains)
    expect(decodePath(encodePath(path))).toEqual(path)
  })

  it('accepts the already-parsed value a router hands over', () => {
    const path = walk(sites, kerala)
    expect(decodePath(JSON.parse(encodePath(path)))).toEqual(path)
  })

  it.each([
    ['nothing', undefined],
    ['an empty string', ''],
    ['invalid JSON', '{nope'],
    ['a number', 42],
    ['an array', '[]'],
    ['steps that are not an array', JSON.stringify({ steps: 'Site', at: 0 })],
    ['no valid step', JSON.stringify({ steps: [{ screen: 'list' }], at: 0 })],
    ['a huge string', 'x'.repeat(100_000)],
  ])('returns null for %s', (_, raw) => {
    expect(decodePath(raw)).toBeNull()
  })

  it.each<[string, unknown]>([
    ['an unknown screen', { screen: 'peek', table: 'Site' }],
    ['a table that is not a string', { screen: 'list', table: 7 }],
    ['an empty table', { screen: 'list', table: '' }],
    ['a row page without its row', { screen: 'row', table: 'Site' }],
    ['a list with a row page centre', { screen: 'list', table: 'Site', row: 'site-1' }],
    ['filters that are not triples', { screen: 'list', table: 'Site', filters: [['state', '=']] }],
    ['a filter value that is an object', { screen: 'list', table: 'Site', filters: [['state', '=', { a: 1 }]] }],
    ['a relationship filter on an ordinary operator', { screen: 'list', table: 'PO', filters: [['row_id', '=', { table: 'Item' }]] }],
    ['a relationship filter without its table', { screen: 'list', table: 'PO', filters: [['row_id', 'related', { via: 'PO Line', column: 'item' }]] }],
    ['a relationship filter with an unknown key', { screen: 'list', table: 'PO', filters: [['row_id', 'related', { table: 'Item', title: 'Widget' }]] }],
    ['a relationship filter with via but no column', { screen: 'list', table: 'PO', filters: [['row_id', 'related', { table: 'Item', via: 'PO Line' }]] }],
    ['a relationship filter whose via is not a name', { screen: 'list', table: 'PO', filters: [['row_id', 'related', { table: 'Item', via: 7, column: 'item' }]] }],
    ['a relationship filter with a sub-table field but no via', { screen: 'list', table: 'PO', filters: [['row_id', 'related', { table: 'Item', parentfield: 'lines' }]] }],
    ['more filters than a step keeps', { screen: 'list', table: 'Site', filters: Array.from({ length: 51 }, (_, i) => [`c${i}`, '=', i]) }],
    ['a group that is not an object', { screen: 'list', table: 'Site', pane: { table: 'Site', row: 'r', group: 'Plant' } }],
    ['a group whose via is not a name', { screen: 'list', table: 'Site', pane: { table: 'Site', row: 'r', group: { table: 'Plant', column: 'site', via: 7 } } }],
    ['a relationship filter with malformed inner filters', { screen: 'list', table: 'PO', filters: [['row_id', 'related', { table: 'Item', filters: [['row_id', '=']] }]] }],
    ['a relationship filter nested too deep', { screen: 'list', table: 'PO', filters: [['a', 'related', { table: 'B', filters: [['b', 'related', { table: 'C', filters: [['c', 'related', { table: 'D', filters: [['d', 'related', { table: 'E' }]] }]] }]] }]] }],
    ['a pane without its row', { screen: 'list', table: 'Site', pane: { table: 'Site' } }],
    ['a group without its column', { screen: 'list', table: 'Site', pane: { table: 'Site', row: 'r', group: { table: 'Plant' } } }],
    ['an unknown pane tab', { screen: 'list', table: 'Site', pane: { table: 'Site', row: 'r', tab: 'map' } }],
    ['an unknown view', { screen: 'row', table: 'Site', row: 'r', view: 'graph' }],
    ['expanded ids that are not strings', { screen: 'row', table: 'Site', row: 'r', expanded: [1] }],
    ['an unknown place', { screen: 'list', table: 'Site', place: 'left' }],
    ['compact that is not a boolean', { screen: 'list', table: 'Site', compact: 'yes' }],
    ['an extra field', { screen: 'list', table: 'Site', colour: 'red' }],
    ['a name stored beside the ids', { screen: 'row', table: 'Site', row: 'site-1', name: 'Enchakkal' }],
    ['a title stored in the pane', { screen: 'list', table: 'Site', pane: { table: 'Site', row: 'site-1', title: 'Enchakkal' } }],
    ['a string over the length limit', { screen: 'list', table: 'S'.repeat(500) }],
  ])('drops a step with %s', (_, bad) => {
    const decoded = decodePath(JSON.stringify({ steps: [sites, bad, kerala], at: 2 }))
    expect(decoded).toEqual({ steps: [sites, kerala], at: 1 })
  })

  it('points at the step before a dropped current step', () => {
    const decoded = decodePath(JSON.stringify({ steps: [sites, { screen: 'x' }, kerala], at: 1 }))
    expect(decoded).toEqual({ steps: [sites, kerala], at: 0 })
  })

  it('clamps an out-of-range current step', () => {
    expect(decodePath(JSON.stringify({ steps: [sites, kerala], at: 9 }))?.at).toBe(1)
    expect(decodePath(JSON.stringify({ steps: [sites, kerala], at: -3 }))?.at).toBe(0)
  })

  it('makes the last step current when the current step is not a whole number', () => {
    expect(decodePath(JSON.stringify({ steps: [sites, kerala], at: 'one' }))?.at).toBe(1)
  })

  it(`keeps only the last ${MAX_STEPS} steps of a long address`, () => {
    const steps = Array.from({ length: 20 }, (_, i) => listStep(i))
    const decoded = decodePath(JSON.stringify({ steps, at: 19 }))
    expect(decoded?.steps).toEqual(steps.slice(-MAX_STEPS))
    expect(decoded?.at).toBe(MAX_STEPS - 1)
  })
})

describe('stepKind', () => {
  it.each<[string, NavStep, string]>([
    ['a plain list', sites, 'list'],
    ['a narrowed list', kerala, 'filter'],
    ['a row page', { screen: 'row', table: 'Site', row: 'site-1' }, 'row'],
    ['an open pane', supermarket, 'pane'],
    ['an open group in the pane', enchakkal, 'group'],
  ])('names %s', (_, step, kind) => {
    expect(stepKind(step)).toBe(kind)
  })
})

describe('stepRefs', () => {
  it('lists the rows the step shows, for the title lookup', () => {
    const step: NavStep = { screen: 'row', table: 'Site', row: 'site-1', pane: { table: 'Plant', row: 'plant-7' } }
    expect(stepRefs(step)).toEqual([
      { table: 'Site', row_id: 'site-1' },
      { table: 'Plant', row_id: 'plant-7' },
    ])
  })

  it('lists a row once when the pane shows the row page centre', () => {
    const step: NavStep = { screen: 'row', table: 'Site', row: 'site-1', pane: { table: 'Site', row: 'site-1' } }
    expect(stepRefs(step)).toEqual([{ table: 'Site', row_id: 'site-1' }])
  })

  it('lists nothing for a list without a pane', () => {
    expect(stepRefs(kerala)).toEqual([])
  })
})

describe('replace', () => {
  it('changes the current step in place', () => {
    expect(replace(walk(sites, enchakkal), supermarket)).toEqual(walk(sites, supermarket))
  })

  it('a step that comes to show what the step before it shows merges into it', () => {
    const selected: NavStep = { ...sites, pane: { table: 'Site', row: 'site-1' } }
    expect(replace(walk(sites, selected), sites)).toEqual(walk(sites))
  })
})

describe('recent paths', () => {
  const a = walk(sites)
  const b = walk(sites, kerala)

  it('puts the newest path first', () => {
    expect(rememberPath([a], b)).toEqual([b, a])
  })

  it('moves a path already remembered to the front instead of repeating it', () => {
    expect(rememberPath([a, b], walk(sites))).toEqual([a, b])
    expect(rememberPath([b, a], walk(sites))).toEqual([a, b])
  })

  it(`keeps only the last ${MAX_RECENT}`, () => {
    let list: NavPath[] = []
    for (let i = 0; i < MAX_RECENT + 4; i++) list = rememberPath(list, walk(listStep(i)))
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]).toEqual(walk(listStep(MAX_RECENT + 3)))
  })

  it('a walk that goes on replaces the shorter walk it extends', () => {
    expect(rememberWalk([a], b)).toEqual([b])
  })

  it('a walk that branches off keeps the walk it left', () => {
    const c = walk(sites, { ...sites, filters: [['state', '=', 'TN']] })
    expect(rememberWalk([b], c)).toEqual([c, b])
  })

  it('going back along a remembered walk remembers nothing new', () => {
    const c = walk(sites, kerala, enchakkal)
    expect(rememberWalk([c], back(c))).toEqual([c])
  })

  it('a walk whose step only opened another group still replaces the walk it extends', () => {
    const opened = walk(sites, { ...kerala, compact: true }, supermarket)
    expect(rememberWalk([b], opened)).toEqual([opened])
  })

  it('a path of one step is not a walk worth remembering', () => {
    expect(rememberWalk([b], a)).toEqual([b])
  })

  it('decodes stored paths, dropping the malformed ones', () => {
    expect(decodeRecent([JSON.parse(encodePath(a)), 'junk', 7, encodePath(b)])).toEqual([a, b])
  })

  it('dedupes and caps stored paths', () => {
    const stored = [a, a, ...Array.from({ length: 15 }, (_, i) => walk(listStep(i)))]
    const decoded = decodeRecent(stored)
    expect(decoded).toHaveLength(MAX_RECENT)
    expect(decoded.slice(0, 2)).toEqual([a, walk(listStep(0))])
  })

  it.each([undefined, null, 'x', { a: 1 }])('reads %s as no recent paths', (raw) => {
    expect(decodeRecent(raw)).toEqual([])
  })
})
