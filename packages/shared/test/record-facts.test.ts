// #1340: the one shape an app's record facts and an action's preview must have; anything else is refused whole.
import { describe, expect, it } from 'vitest'
import { actionDoneSchema, actionPreviewSchema, recordFactsSchema } from '../src/record-facts'

const ok = (answer: unknown) => recordFactsSchema.safeParse(answer).success

describe('record facts', () => {
  it('takes columns, facts, a header, groups and actions', () => {
    expect(ok({ version: 1, columns: [{ key: 'people', label: 'People' }],
      rows: { r1: { facts: { people: { text: '25', tone: 'quiet' } }, header: 'Business role · 25 people', groups: [
        { key: 'can', heading: 'What They Can Do', table: 'app.permission', rows: { p1: { parts: ['Can ', { chip: 'Area' }] } }, notes: { x: 'Also given to two' } },
        { key: 'people', heading: 'People', count: 25, lines: [{ parts: [{ record: { table: 'Person', row: 'p', name: 'A' } }], chip: { label: 'from HR' } }],
          all: { label: 'Show all', href: '/x' }, links: [{ label: 'Open as grid', href: '/grid' }] },
      ] } },
      actions: [{ key: 'run', label: 'Run It', explain: 'Runs it.', run: 'do_it' }, { key: 'page', label: 'Open It', explain: 'Opens it.', href: '/page' }] })).toBe(true)
  })

  it.each([
    ['a group that stands for a link group and has its own lines', { version: 1, rows: { r: { groups: [{ key: 'g', heading: 'G', table: 't', lines: [{ parts: ['a'] }] }] } } }],
    ['an action that neither runs nor opens a page', { version: 1, rows: {}, actions: [{ key: 'a', label: 'A', explain: 'A.' }] }],
    ['an action that both runs and opens a page', { version: 1, rows: {}, actions: [{ key: 'a', label: 'A', explain: 'A.', run: 'x', href: '/x' }] }],
    ['a link off this site', { version: 1, rows: { r: { groups: [{ key: 'g', heading: 'G', all: { label: 'All', href: 'https://elsewhere.example' } }] } } }],
    ['a tone that is not one', { version: 1, rows: { r: { facts: { a: { text: 'x', tone: 'red' } } } } }],
    ['another version', { version: 2, rows: {} }],
  ])('refuses %s', (_name, answer) => {
    expect(ok(answer)).toBe(false)
  })
})

describe('an action preview', () => {
  const preview = { version: 1, title: 'Give Old Grants', status: 'Preview', sentence: ['Gives 3.'], runLabel: 'Run', filters: [{ key: 'add', label: 'Will be added' }],
    columns: [{ key: 'report', label: 'Report' }], rows: [{ filter: 'add', cells: { report: { parts: ['Sales'] }, what: { text: 'Will be added', tone: 'neutral' } } }] }
  it('takes a sentence, filters, columns and rows', () => {
    expect(actionPreviewSchema.safeParse(preview).success).toBe(true)
  })
  it('takes a column kept on one line', () => {
    expect(actionPreviewSchema.safeParse({ ...preview, columns: [{ key: 'report', label: 'Report', nowrap: true }] }).success).toBe(true)
  })
  it('refuses one with no columns', () => {
    expect(actionPreviewSchema.safeParse({ ...preview, columns: [] }).success).toBe(false)
  })
})

// #1340 (verifier round 3): what a run did, said by the app after it, with the record that keeps it.
describe('what an action did', () => {
  it('takes a sentence, a record in it, and leaves the rest of the answer alone', () => {
    expect(actionDoneSchema.safeParse({ said: ['9 added. ', { record: { table: 'dash.setup_run', row: 'r1', name: 'Open the Setup Run' } }], run: 'r1' }).success).toBe(true)
  })
  it('refuses an answer that says nothing', () => {
    expect([actionDoneSchema.safeParse({ tidied: true }).success, actionDoneSchema.safeParse({ said: [] }).success]).toEqual([false, false])
  })
})
