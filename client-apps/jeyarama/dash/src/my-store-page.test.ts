// #1223: the words a manager's move is told in, to the manager and to the reviewer.
import { describe, expect, it } from 'vitest'
import { movedLine } from './my-store-page'
import { askedOfApprover } from './sections-page'

describe('a manager moving someone', () => {
  it('tells the manager what happened, as the approval mode made it happen, and who looks at it', () => {
    expect(movedLine('Asha Leader', 'Silk', 'Not yet reviewed', 'Mani Manager')).toBe('Moved Asha Leader to Silk. Mani Manager reviews it.')
    expect(movedLine('Asha Leader', 'Silk', 'Pending', 'Mani Manager')).toBe('Asked to move Asha Leader to Silk. Mani Manager decides.')
    expect(movedLine('Asha Leader', 'Silk', 'Pending', null)).toBe('Asked to move Asha Leader to Silk. The master data team decides.')
    expect(movedLine('Asha Leader', 'Silk', 'Not yet reviewed', 'the master data team')).toBe('Moved Asha Leader to Silk. The master data team reviews it.')
  })

  it('names the person moved on the reviewer\'s card; a person\'s own change reads as before', () => {
    expect(askedOfApprover({ kind: 'section', what: 'Asha Leader, Team Leader at Lakeside', from: 'Sarees', to: 'Silk', moved: 'Asha Leader' })).toBe('Move Asha Leader from Sarees to Silk')
    expect(askedOfApprover({ kind: 'section', what: 'Team Leader at Lakeside', from: 'Sarees', to: 'Silk' })).toBe('Change their section from Sarees to Silk')
  })
})

describe('the reviewer\'s card title', () => {
  it('names who a manager moved', async () => {
    const { approvalTitle } = await import('./sections-page')
    expect(approvalTitle({ kind: 'section', what: 'Asha Leader, Team Leader at Lakeside', from: { section: 'Sarees', holder: null }, to: { section: 'Silk', holder: null }, moved: 'Asha Leader' } as never))
      .toBe('Move Asha Leader from Sarees to Silk')
  })
})

describe('what someone covers, line by line', () => {
  it('counts subcategories and names an empty or closed section as a gap', async () => {
    const { coverLine, coverageAddress } = await import('./coverage-page')
    expect(coverLine({ subcategories: 4, active: true })).toBe('4 subcategories')
    expect(coverLine({ subcategories: 1, active: true })).toBe('1 subcategory')
    expect(coverLine({ subcategories: 0, active: true })).toBe('no subcategories')
    expect(coverLine({ subcategories: 0, active: false })).toBe('closed · no subcategories')
    expect(coverageAddress({ employee: 'KL-RR 9' })).toBe('?view=coverage&employee=KL-RR%209')
    expect(coverageAddress({ department: 'LKS-Kids' })).toBe('?view=coverage&department=LKS-Kids')
  })
})

describe('the coverage page heading', () => {
  it('names whose coverage it is', async () => {
    const { titleOf } = await import('./coverage-page')
    const person = { state: 'ok' as const, kind: 'employee' as const, employee: { code: '2012', name: 'Arun', status: 'Current' }, jobs: [], merchandise: [], gaps: [], nothing: false }
    expect(titleOf({ ...person, own: false })).toBe('What Arun covers')
    expect(titleOf({ ...person, own: true })).toBe('What you cover')
    expect(titleOf({ state: 'ok', kind: 'department', department: { id: 'D', name: 'Kids', store: 'Lakeside', manager: null, sections: [], gaps: [] } })).toBe('Kids · Lakeside')
    expect(titleOf(undefined)).toBe('What they cover')
  })
})

describe('Your store staff, one row per person (#1223 spec item 6)', () => {
  it('folds a person with several jobs in the area into one row, keeping each job', async () => {
    const { peopleOf } = await import('./my-store-page')
    const job = (job_id: string, section: string) => ({ code: '3008', name: 'Faiz Four-Sections', job_id, job: 'Team Leader', section, section_id: section, reports_to: null, movable: true })
    const people = peopleOf([job('JA-1', 'Bags'), job('JA-2', 'Footwear'), { ...job('JA-3', 'Bags'), code: '3001', name: 'Asha' }])
    expect(people.map(p => [p.code, p.jobs.map(j => j.job_id)])).toEqual([['3008', ['JA-1', 'JA-2']], ['3001', ['JA-3']]])
  })
})

describe('record links follow what the viewer may open (#1223, Codex)', () => {
  it('asks once per Table: a refusal or a failure is "may not open", an answer is "may"', async () => {
    const { canOpenTable } = await import('./record-link')
    const seen: string[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url))
      if (String(url).includes('Section')) return new Response('{}', { status: 200 })
      if (String(url).includes('Employee')) return new Response('{}', { status: 403 })
      throw new Error('offline')
    }) as typeof fetch
    try {
      expect(await canOpenTable('Section')).toBe(true)
      expect(await canOpenTable('Employee')).toBe(false)
      expect(await canOpenTable('Site')).toBe(false)
      await canOpenTable('Section')
      expect(seen.filter(u => u.includes('Section'))).toHaveLength(1)
    } finally { globalThis.fetch = real }
  })

  it('draws a record as plain text until it is known the viewer may open it', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { RecordLink } = await import('./record-link')
    const html = renderToStaticMarkup(createElement(RecordLink, { table: 'Employee', id: '2001', children: 'Asha Leader' }))
    expect(html).toContain('data-record-link="text"')
    expect(html).not.toContain('<a ')
    expect(html).toContain('Asha Leader')
  })
})
