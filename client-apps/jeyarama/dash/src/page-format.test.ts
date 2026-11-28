// Pure public formatting and wording contracts, moved unchanged from
// page.test.ts. No injected reads, API responses, timers or frame callbacks.
import { describe, expect, it } from 'vitest'
import { noAccessHelp, MADE_UP_DATA_COMMAND, headingTitle, periodLine, whyLine, shortDay } from './page.ts'

describe('how the page writes', () => {
  it('a day as DD-Mon-YYYY', () => {
    expect(shortDay('2026-10-05')).toBe('05-Oct-2026')
  })
})

// #4486: the "why" sentence under the period line. Made-up stores and sections; each test is one
// wording rule of the issue's checklist (items 3 to 6 and 8).
describe('the sentence that says why the reader sees the store', () => {
  const at = (reasons: { basis: string; sections: string[] }[], name: string | null = 'LKS') => whyLine({ name, reasons })

  // #1192: the role reaches every store; the sentence says so, whatever job sits beside it.
  it('says a holder of Dash All-Stores Reader sees every store because of the role', () => {
    expect([at([{ basis: 'all_stores_reader', sections: [] }]), at([{ basis: 'all_stores_reader', sections: [] }, { basis: 'store_manager', sections: [] }])])
      .toEqual(Array(2).fill('You see every store in your region because you hold Dash All-Stores Reader.'))
  })

  describe('one reason (item 3)', () => {
    it("names the store, not its sections, for a Store Manager", () => {
      expect(at([{ basis: 'store_manager', sections: ['Alpha', 'Beta', 'Gamma'] }])).toBe('You see LKS because you are its Store Manager.')
    })
    it("names the sections and the store for a Department Manager", () => {
      expect(at([{ basis: 'department_manager', sections: ['Alpha', 'Beta'] }])).toBe('You see Alpha and Beta at LKS because you are their Department Manager.')
    })
    it("names the sections and the store for a Team Leader", () => {
      expect(at([{ basis: 'team_leader', sections: ['Alpha'] }])).toBe('You see Alpha at LKS because you are their Team Leader.')
    })
    it('says the reader works in the sections for section staff', () => {
      expect(at([{ basis: 'section_staff', sections: ['Alpha', 'Beta'] }])).toBe('You see Alpha and Beta at LKS because you work in them.')
    })
    it('says the subcategories are assigned to the reader, naming no section', () => {
      expect(at([{ basis: 'assignment', sections: ['Alpha'] }])).toBe('You see these subcategories at LKS because they are assigned to you.')
    })
  })

  describe('several reasons for one store (item 4)', () => {
    it("joins them into one sentence, leadership first: the issue's example", () => {
      expect(at([{ basis: 'team_leader', sections: ['Alpha'] }, { basis: 'store_manager', sections: ['Alpha', 'Beta'] }]))
        .toBe('You see LKS because you are its Store Manager and Team Leader of Alpha.')
    })
    it('orders Department Manager before Team Leader before section staff before assigned subcategories, whatever order they arrive in', () => {
      expect(at([{ basis: 'assignment', sections: [] }, { basis: 'section_staff', sections: ['Gamma'] },
        { basis: 'team_leader', sections: ['Beta'] }, { basis: 'department_manager', sections: ['Alpha'] }]))
        .toBe('You see Alpha, Beta and Gamma at LKS because you are Department Manager of Alpha and Team Leader of Beta, work in Gamma and have other subcategories assigned to you.')
    })
    it('names each section once in what the reader sees', () => {
      expect(at([{ basis: 'team_leader', sections: ['Alpha'] }, { basis: 'section_staff', sections: ['Alpha', 'Beta'] }]))
        .toBe('You see Alpha and Beta at LKS because you are Team Leader of Alpha and work in Alpha and Beta.')
    })
    it('lists what the reader sees in the order the title does, whichever job names each section', () => {
      expect(at([{ basis: 'team_leader', sections: ['Gamma'] }, { basis: 'section_staff', sections: ['Alpha'] }]))
        .toBe('You see Alpha and Gamma at LKS because you are Team Leader of Gamma and work in Alpha.')
    })
    it("reads one basis given twice as one reason", () => {
      expect(at([{ basis: 'team_leader', sections: ['Alpha'] }, { basis: 'team_leader', sections: ['Beta'] }]))
        .toBe('You see Alpha and Beta at LKS because you are their Team Leader.')
    })
    it('does not repeat a section when the same reason names it twice', () => {
      expect(at([{ basis: 'team_leader', sections: ['Alpha'] }, { basis: 'team_leader', sections: ['Alpha', 'Beta'] }]))
        .toBe('You see Alpha and Beta at LKS because you are their Team Leader.')
    })
    it('uses subcategories rather than an empty section list when several jobs name none', () => {
      expect(at([{ basis: 'department_manager', sections: [] }, { basis: 'team_leader', sections: [] }]))
        .toBe('You see these subcategories at LKS because you are Department Manager of these subcategories and Team Leader of these subcategories.')
    })
    it('places a Store Manager\'s other jobs after it, and assigned subcategories last', () => {
      expect(at([{ basis: 'assignment', sections: ['Beta'] }, { basis: 'store_manager', sections: ['Alpha', 'Beta'] }]))
        .toBe('You see LKS because you are its Store Manager and have other subcategories assigned to you.')
    })
  })

  describe('how many sections are named (item 5)', () => {
    const tl = (sections: string[]) => at([{ basis: 'team_leader', sections }])
    it('names one, two or three sections', () => {
      expect([tl(['Alpha']), tl(['Alpha', 'Beta']), tl(['Alpha', 'Beta', 'Gamma'])]).toEqual([
        'You see Alpha at LKS because you are their Team Leader.',
        'You see Alpha and Beta at LKS because you are their Team Leader.',
        'You see Alpha, Beta and Gamma at LKS because you are their Team Leader.',
      ])
    })
    it('counts them from four on', () => {
      expect(tl(['Alpha', 'Beta', 'Gamma', 'Delta'])).toBe('You see 4 sections at LKS because you are their Team Leader.')
      expect(tl(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'])).toBe('You see 7 sections at LKS because you are their Team Leader.')
    })
    it('counts within a joined sentence too', () => {
      expect(at([{ basis: 'store_manager', sections: [] }, { basis: 'team_leader', sections: ['Alpha', 'Beta', 'Gamma', 'Delta'] }]))
        .toBe('You see LKS because you are its Store Manager and Team Leader of 4 sections.')
    })
    it("never names a Store Manager's sections, however many", () => {
      expect(at([{ basis: 'store_manager', sections: ['A1', 'A2', 'A3', 'A4', 'A5'] }])).toBe('You see LKS because you are its Store Manager.')
    })
  })

  describe('no reason known (item 6)', () => {
    it('leaves the sentence out when the store has no reason', () => {
      expect(at([])).toBeNull()
    })
    it('leaves it out when every basis is one the page does not know, rather than "because you are ."', () => {
      expect(at([{ basis: 'regional_auditor', sections: ['Alpha'] }, { basis: '', sections: [] }])).toBeNull()
    })
    it('drops an unknown basis beside a known one', () => {
      expect(at([{ basis: 'regional_auditor', sections: ['Beta'] }, { basis: 'team_leader', sections: ['Alpha'] }]))
        .toBe('You see Alpha at LKS because you are their Team Leader.')
    })
  })

  describe("the new org chart's reasons, in the same wording", () => {
    it("says Cluster Manager for a Cluster Manager, naming the store", () => {
      expect(at([{ basis: 'cluster_manager', sections: ['Alpha'] }])).toBe('You see LKS because you are its Cluster Manager.')
    })
    it('says Floor Manager for a Floor Manager, naming the sections', () => {
      expect(at([{ basis: 'floor_manager', sections: ['Alpha', 'Beta'] }])).toBe('You see Alpha and Beta at LKS because you are their Floor Manager.')
    })
    it('says "acting" before an acting job', () => {
      expect(at([{ basis: 'acting_team_leader', sections: ['Alpha'] }])).toBe('You see Alpha at LKS because you are their acting Team Leader.')
      expect(at([{ basis: 'acting_store_manager', sections: [] }])).toBe('You see LKS because you are its acting Store Manager.')
    })
    it('reads acting section staff as working in the section', () => {
      expect(at([{ basis: 'acting_section_staff', sections: ['Alpha'] }])).toBe('You see Alpha at LKS because you work in them.')
    })
    it('places an acting job after the same job held outright', () => {
      expect(at([{ basis: 'acting_team_leader', sections: ['Beta'] }, { basis: 'team_leader', sections: ['Alpha'] }]))
        .toBe('You see Alpha and Beta at LKS because you are Team Leader of Alpha and acting Team Leader of Beta.')
    })
  })

  describe('plain English (item 8)', () => {
    const every = [
      at([{ basis: 'store_manager', sections: ['Alpha'] }], null),
      at([{ basis: 'team_leader', sections: ['Alpha'] }], null),
      at([{ basis: 'assignment', sections: [] }], null),
      at([{ basis: 'store_manager', sections: [] }, { basis: 'section_staff', sections: ['Alpha'] }, { basis: 'assignment', sections: [] }]),
      at([{ basis: 'acting_department_manager', sections: [] }]),
    ]
    it('says "your store" when the store has no short name, as the title says "Your store", never its plant code', () => {
      expect(every.slice(0, 3)).toEqual([
        'You see your store because you are its Store Manager.',
        'You see Alpha at your store because you are their Team Leader.',
        'You see these subcategories at your store because they are assigned to you.',
      ])
    })
    it('says "these subcategories" when a job names no section', () => {
      expect(every[4]).toBe('You see these subcategories at LKS because you are their acting Department Manager.')
    })
    it.each(every.map(s => [s]))('never shows a code or a basis name: %s', (sentence) => {
      expect(sentence).not.toMatch(/_|\d{4}|material group/i)
      expect(sentence).not.toMatch(/\bstore_manager\b|\bassignment\b/)
    })
  })
})

describe("the page's header (#4486)", () => {
  it('titles the store by its short name and its sections, three at most', () => {
    expect(headingTitle({ name: 'LKS', sections: ['Alpha', 'Beta', 'Gamma'] })).toBe('LKS · Alpha · Beta · Gamma')
    expect(headingTitle({ name: 'LKS', sections: ['Alpha', 'Beta', 'Gamma', 'Delta'] })).toBe('LKS · 4 sections')
    expect(headingTitle({ name: 'LKS', sections: [] })).toBe('LKS')
  })
  it('titles a store with no short name "Your store", never by its plant code', () => {
    expect(headingTitle({ name: null, sections: ['Alpha'] })).toBe('Your store · Alpha')
  })
  it('gives the period as DD-Mon-YYYY to DD-Mon-YYYY', () => {
    expect(periodLine({ period_start: '2026-10-01', period_end: '2026-10-29' })).toBe('01-Oct-2026 to 29-Oct-2026')
  })
})

describe('noAccessHelp: why the report refused, for the person reading it', () => {
  it('a store reader keeps today\'s message, whatever the setup', () => {
    expect(noAccessHelp({ manages: false, local: false })).toEqual({ kind: 'reader' })
    expect(noAccessHelp({ manages: false, missing: ['secret X'], local: true })).toEqual({ kind: 'reader' })
  })
  it('a manager of an app not set up is told what it lacks; the command only on this machine', () => {
    expect(noAccessHelp({ manages: true, missing: ['secret X'], fix: 'Set it.', local: false }))
      .toEqual({ kind: 'not_set_up', missing: ['secret X'], fix: 'Set it.', command: null })
    expect(noAccessHelp({ manages: true, missing: ['secret X'], local: true }))
      .toEqual({ kind: 'not_set_up', missing: ['secret X'], fix: null, command: MADE_UP_DATA_COMMAND })
  })
  it('a manager of a set-up app is told it opens only for people who cover a store', () => {
    expect(noAccessHelp({ manages: true, missing: [], local: false })).toEqual({ kind: 'manager_no_store', command: null })
    expect(noAccessHelp({ manages: true, local: true })).toEqual({ kind: 'manager_no_store', command: MADE_UP_DATA_COMMAND })
  })
})
