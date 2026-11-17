// #1265: the command bar reads the search one line at a time.
import { describe, expect, it } from 'vitest'
import { applyLine, takeLines, type StreamedSearch } from '../src/lib/search-stream'

const start: StreamedSearch = { query: 'moh', groups: [], done: false, failed: false }

describe('takeLines', () => {
  it('keeps a line cut across two chunks until it is whole', () => {
    expect(takeLines('{"a":1}\n{"b"')).toEqual({ lines: ['{"a":1}'], rest: '{"b"' })
    expect(takeLines('{"b"' + ':2}\n')).toEqual({ lines: ['{"b":2}'], rest: '' })
  })
})

describe('applyLine', () => {
  it('announces the groups, fills each as its Table answers, and ends on done', () => {
    let s = applyLine(start, { groups: [{ table: 'Person', label: 'Person' }, { table: 'tickets.ticket', label: 'Ticket' }] })
    expect(s.groups.map((g) => g.hits)).toEqual([undefined, undefined])
    s = applyLine(s, { table: 'tickets.ticket', hits: [{ table: 'tickets.ticket', row_id: 't-1', title: 'Mohammad cannot log in' }] })
    expect(s.groups[1].hits).toHaveLength(1)
    expect(s.groups[0].hits).toBeUndefined()
    s = applyLine(s, { table: 'Person', hits: [] })
    expect(s.done).toBe(false)
    expect(applyLine(s, { done: true })).toMatchObject({ done: true, failed: false })
  })
  it('an error line ends the search as failed; anything unknown changes nothing', () => {
    expect(applyLine(start, { error: 'The search stopped before it finished' })).toMatchObject({ done: true, failed: true })
    expect(applyLine(start, { something: 'else' })).toBe(start)
  })
})
