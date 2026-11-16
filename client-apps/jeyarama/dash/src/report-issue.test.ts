// #1240: what "Report an issue" sends to Tickets, from what the server and the page know. Made-up people and stores.
import { describe, expect, it } from 'vitest'
import { PROBLEMS, submissionFor, filtersFromMessage, filtersText, reachText, subcategoryText, ticketPayload, viewPath, type FeedbackContext } from './report-issue'
import { reportFeedbackDetails } from '../../../../example-apps/tickets/src/report-feedback.ts'

const CONTEXT: FeedbackContext = {
  state: 'ok', report: { key: 'sales', name: 'Sales versus target' }, person: 'Asha Leader',
  jobs: ['Team Leader job assignment, since 01-Apr-2026'],
  reach: [
    { store: '9901', name: 'Lakeside', whole: false, sections: ['Sarees', 'Silk'], subcategories: ['010101001', '010101002'] },
    { store: '9902', name: null, whole: true, sections: [], subcategories: [] },
  ],
}
const NOW = new Date('2026-11-16T14:43:00.000Z')

describe('the ticket "Report an issue" raises', () => {
  it('carries the report, the view, the store and month on show, the Dive\'s filters, the reach, the job and the time', () => {
    const payload = ticketPayload(CONTEXT, { path: '/dash/?report=sales&store=9901&month=last', store: '9901', month: 'last', diveFilters: { store: '9901', month: '2026-10' } },
      { problem: 'Target too high or too low', about: '  Kanchipuram silk target ', note: '₹18 L is double last November.' }, NOW)
    expect(payload).toEqual({
      title: 'Target too high or too low: Sales versus target',
      original: '₹18 L is double last November.',
      kind: 'report_feedback',
      details: {
        problem: 'Target too high or too low', about: 'Kanchipuram silk target', report: 'Sales versus target', report_key: 'sales',
        view: '/dash/?report=sales&store=9901&month=last', app: 'Dash', store: 'Lakeside (9901)', month: 'Last month',
        filters: 'month: 2026-10 · store: 9901',
        reach: 'Lakeside (9901): Sarees, Silk (2 subcategories); 9902: whole store',
        subcategories: '9901: 010101001, 010101002',
        job: 'Team Leader job assignment, since 01-Apr-2026',
        seen_at: '2026-11-16T14:43:00.000Z',
      },
    })
  })

  it('needs no note: the pick and the item stand in for it, and the title never carries the reader\'s words', () => {
    const payload = ticketPayload(CONTEXT, { path: '/dash/?report=sales' }, { problem: 'Stock missing', about: 'Soft silk 6 yards', note: ' ' }, NOW)
    expect(payload.original).toBe('Stock missing: Soft silk 6 yards')
    expect(payload.title).toBe('Stock missing: Sales versus target')
    expect(payload.details).not.toHaveProperty('store')
    expect(payload.details).not.toHaveProperty('filters')
    expect(ticketPayload(CONTEXT, { path: '/dash/' }, { problem: 'Something else', about: '', note: '' }, NOW).original).toBe('Something else')
  })

  it('cuts a long reach to what Tickets keeps, and says how many stores there are', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ store: `P${i}`, name: `Store number ${i}`, whole: true, sections: [], subcategories: [] }))
    const text = reachText(many)
    expect(text.startsWith('300 stores. Store number 0 (P0): whole store')).toBe(true)
    expect(text.length).toBe(4000)
    expect(text.endsWith('…')).toBe(true)
    expect(reachText([])).toBe('No store')
    expect(subcategoryText(many)).toBe('')
  })

  it('passes Tickets\' own check for every quick pick, at the longest lengths Tickets keeps', () => {
    const long = Array.from({ length: 400 }, (_, i) => ({ store: `P${i}`, name: 'x'.repeat(300), whole: false, sections: ['Sarees'], subcategories: ['0'.repeat(30)] }))
    for (const problem of PROBLEMS) {
      const { details } = ticketPayload({ ...CONTEXT, reach: long, jobs: ['j'.repeat(900)] },
        { path: '/dash/?report=sales', store: 'P1', month: 'this', diveFilters: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'v'.repeat(200)])) },
        { problem, about: 'a'.repeat(500), note: '' }, NOW)
      expect(reportFeedbackDetails(details, message => { throw new Error(message) })).toEqual(details)
    }
  })
})

describe('the filters a Dive reports', () => {
  it('reads plain values from its filters message or its ready message, and nothing else', () => {
    expect(filtersFromMessage({ type: 'dash:dive-filters', filters: { store: 'P101', month: '2026-11', top: 20, codes: ['A', 'B'] } }))
      .toEqual({ store: 'P101', month: '2026-11', top: '20', codes: 'A, B' })
    expect(filtersFromMessage({ type: 'dash:dive-ready', filters: { store: 'P101' } })).toEqual({ store: 'P101' })
    expect(filtersFromMessage({ type: 'dash:dive-ready' })).toBeNull()
    expect(filtersFromMessage({ type: 'something-else', filters: { store: 'P101' } })).toBeNull()
    expect(filtersFromMessage({ type: 'dash:dive-filters', filters: { '<b>': 'x', nested: { a: 1 }, ok: 'y' } })).toEqual({ ok: 'y' })
    expect(filtersFromMessage('dash:dive-filters')).toBeNull()
  })

  it('writes them in key order', () => {
    expect(filtersText({ store: 'P101', month: '2026-11' })).toBe('month: 2026-11 · store: P101')
    expect(filtersText(undefined)).toBe('')
  })
})

describe('the link back to the view', () => {
  it('is Dash\'s own path and query, always naming the report', () => {
    expect(viewPath({ pathname: '/dash/', search: '?report=sales&store=9901' }, 'sales')).toBe('/dash/?report=sales&store=9901')
    expect(viewPath({ pathname: '/dash/', search: '?store=9901&month=this' }, 'sales')).toBe('/dash/?store=9901&month=this&report=sales')
    expect(viewPath({ pathname: '/', search: '' }, 'sales')).toBe('/dash/?report=sales')
  })

  it('names the report alone for a Dive with its own pickers, whose store and month the address does not follow', () => {
    expect(viewPath({ pathname: '/dash/', search: '?report=sales&store=9901&month=last' }, 'sales', { pickersInDive: true, store: '9901' })).toBe('/dash/?report=sales')
  })

  it('names the store and month on show when the page knows them, as over a cached view', () => {
    expect(viewPath({ pathname: '/dash/', search: '?report=sales' }, 'sales', { store: '9902', month: 'last' })).toBe('/dash/?report=sales&store=9902&month=last')
  })
})

describe('a retried submission', () => {
  const view = { path: '/dash/?report=sales', store: '9901' }
  const answer = { problem: 'Stock missing' as const, about: 'Soft silk', note: '' }
  let n = 0
  const key = () => `key-${++n}`

  it('keeps its key and its payload, time included, while the reader changes nothing', () => {
    const first = submissionFor(null, CONTEXT, view, answer, NOW, key)
    const again = submissionFor(first, CONTEXT, view, answer, new Date('2026-11-16T15:00:00.000Z'), key)
    expect(again).toBe(first)
    expect(again.payload.details.seen_at).toBe('2026-11-16T14:43:00.000Z')
  })

  it('keeps the view it was made on when the page updates under it, as a late Dive message does', () => {
    const first = submissionFor(null, CONTEXT, view, answer, NOW, key)
    const later = submissionFor(first, CONTEXT, { ...view, diveFilters: { month: '2026-11', store: '9901' } }, answer, NOW, key)
    expect(later).toBe(first)
    expect(later.payload.details).not.toHaveProperty('filters')
  })

  it('is a new submission once the reader changes what they send', () => {
    const first = submissionFor(null, CONTEXT, view, answer, NOW, key)
    const changed = submissionFor(first, CONTEXT, view, { ...answer, note: 'Since Monday' }, NOW, key)
    expect(changed.key).not.toBe(first.key)
    expect(changed.payload.original).toBe('Since Monday')
  })
})
