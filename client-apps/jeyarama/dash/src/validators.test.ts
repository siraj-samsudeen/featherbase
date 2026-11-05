import { describe, expect, it } from 'vitest'
import { validators } from './validators.ts'

type Row = Record<string, unknown>
class Refused extends Error {
  constructor(message: string, readonly fields?: Record<string, string>) { super(message) }
}

/** Runs a Table's validator as the platform does on save, and returns the row it leaves. */
function save(table: string, row: Row, old?: Row): Row {
  const copy = { ...row }
  validators[table]({ row: copy, old, user: 'admin@example.test', isNew: !old,
    reject(message: string, fields?: Record<string, string>): never { throw new Refused(message, fields) } })
  return copy
}

const STORE_TABLES: [string, Row][] = [
  ['dash.store_floor', { floor_name: 'Ground' }],
  ['dash.department', { department_key: 'dm-P-107' }],
  ['dash.section', { section_name: 'Sarees', team_leaders_allowed: 1 }],
  ['dash.section_subcategory', { subcategory: '010101001', section: 's1', starts_on: '2026-08-01' }],
  ['dash.display_location', { subcategory: '010101001', location_name: 'Billing counter', starts_on: '2026-08-01' }],
  ['dash.job_assignment', { person: 'psn_101', job: 'Store Manager', assignment_type: 'Primary', percentage: 100, starts_on: '2026-08-01' }],
  ['dash.section_alias', { source: 'hr', alias: 'Saree', section: 's1' }],
  ['dash.floor_alias', { source: 'hr', alias: 'GF', floor: 'f1' }],
]

describe('every Table with a store', () => {
  it.each(STORE_TABLES)('%s refuses a store code that is not four digits', (table, row) => {
    expect(() => save(table, { ...row, store: 'LKS' })).toThrow(/four digits/)
  })
})

describe('canonical codes, refused rather than rewritten', () => {
  it.each([...STORE_TABLES, ['dash.store_rollout', { live_since: '2026-10-01' }] as [string, Row]])(
    '%s refuses a store code padded with spaces', (table, row) => {
      expect(() => save(table, { ...row, store: ' 9901 ' })).toThrow(/exactly four digits, with no spaces/)
    })

  it.each([['dash.section_subcategory', { store: '9901', section: 's1', starts_on: '2026-08-01' }],
    ['dash.display_location', { store: '9901', location_name: 'Counter', starts_on: '2026-08-01' }]] as [string, Row][])(
    '%s refuses a subcategory padded with spaces', (table, row) => {
      expect(() => save(table, { ...row, subcategory: ' 010101001 ' })).toThrow('A subcategory code is exactly nine digits, with no spaces')
    })
})

describe('store_floor', () => {
  it('keys a floor by its store and its name, trimmed and case-folded', () => {
    expect(save('dash.store_floor', { store: '9901', floor_name: ' Ground  Floor ' }).floor_key).toBe('9901/ground floor')
  })
})

describe('department', () => {
  const department = { store: '9901', department_key: 'dm-P-107' }

  it('keys a department by its store and its department_key', () => {
    expect(save('dash.department', department).department_store_key).toBe('9901/dm-P-107')
  })

  it('keys a named department by its store and its name', () => {
    expect(save('dash.department', { ...department, name: 'Ladies  Ethnic' }).name_store_key).toBe('9901/ladies ethnic')
  })

  it('leaves the name key empty while the name is blank, so unnamed departments never collide', () => {
    expect(save('dash.department', { ...department, name: '  ' }).name_store_key).toBeNull()
  })

  it('shows the key while the name is blank', () => {
    expect(save('dash.department', department).display_name).toBe('dm-P-107')
  })

  it('shows the name once it is given', () => {
    expect(save('dash.department', { ...department, name: 'Ladies Ethnic' }).display_name).toBe('Ladies Ethnic')
  })

  it('refuses a change to department_key', () => {
    expect(() => save('dash.department', { ...department, department_key: 'dm-P-200' }, department)).toThrow(/never changes/)
  })
})

describe('section', () => {
  it('keys a section by its store and its name, trimmed and case-folded', () => {
    expect(save('dash.section', { store: '9901', section_name: 'Women Tops ', team_leaders_allowed: 1 }).section_key).toBe('9901/women tops')
  })

  it('refuses fewer than one Team Leader allowed', () => {
    expect(() => save('dash.section', { store: '9901', section_name: 'Tops', team_leaders_allowed: 0 })).toThrow(/at least 1/)
  })
})

describe('section_subcategory', () => {
  const placement = { store: '9901', subcategory: '010101001', section: 's1', starts_on: '2026-08-01' }

  it('keys a placement by its store, subcategory and start', () => {
    expect(save('dash.section_subcategory', placement).placement_key).toBe('9901/010101001/2026-08-01')
  })

  it('keys a placement by its start day when the start arrives as a timestamp', () => {
    expect(save('dash.section_subcategory', { ...placement, starts_on: '2026-08-01T00:00:00.000Z' }).placement_key).toBe('9901/010101001/2026-08-01')
  })

  it('refuses a subcategory that is not nine digits', () => {
    expect(() => save('dash.section_subcategory', { ...placement, subcategory: '1010' })).toThrow(/nine digits/)
  })

  it('refuses an end on or before the start', () => {
    expect(() => save('dash.section_subcategory', { ...placement, ends_on: '2026-08-01' })).toThrow(/after starts_on/)
  })
})

describe('display_location', () => {
  it('refuses a subcategory that is not nine digits', () => {
    expect(() => save('dash.display_location', { store: '9901', subcategory: 'scarf', location_name: 'Counter', starts_on: '2026-08-01' })).toThrow(/nine digits/)
  })

  it('refuses an end before the start', () => {
    expect(() => save('dash.display_location', { store: '9901', subcategory: '010101001', location_name: 'Counter', starts_on: '2026-08-02', ends_on: '2026-08-01' })).toThrow(/after starts_on/)
  })
})

describe('job_assignment', () => {
  const base = { person: 'psn_101', store: '9901', assignment_type: 'Primary', percentage: 100, starts_on: '2026-08-01' }

  it.each([
    ['Director', {}],
    ['Chief Operating Officer', {}],
    ['Store Manager', {}],
    ['Cluster Manager', { cluster: 'CL-NORTH' }],
    ['Floor Manager', { floor: 'f1' }],
    ['Department Manager', { department: 'd1' }],
    ['Team Leader', { section: 's1' }],
    ['Staff', { section: 's1' }],
  ])('accepts a %s naming only its own level of the layout', (job, place) => {
    expect(() => save('dash.job_assignment', { ...base, job, ...place })).not.toThrow()
  })

  it.each([
    ['Team Leader', {}, /Team Leader needs a section/],
    ['Staff', {}, /Staff needs a section/],
    ['Floor Manager', {}, /Floor Manager needs a floor/],
    ['Department Manager', {}, /Department Manager needs a department/],
    ['Floor Manager', { floor: 'f1', section: 's1' }, /Floor Manager names no section/],
    ['Team Leader', { section: 's1', department: 'd1' }, /Team Leader names no department/],
    ['Store Manager', { floor: 'f1' }, /Store Manager names no floor/],
    ['Cluster Manager', { cluster: 'CL-NORTH', section: 's1' }, /Cluster Manager names no section/],
    ['Cluster Manager', {}, /Cluster Manager needs the cluster/],
    ['Cluster Manager', { cluster: ' CL-NORTH' }, /no spaces/],
    ['Store Manager', { cluster: 'CL-NORTH' }, /Store Manager names no cluster/],
    ['Store Manager', { assignment_type: 'Deputation' }, /Primary, Secondary or a Temporary deployment/],
    ['Store Manager', { percentage: 0 }, /more than 0 and at most 100/],
    ['Store Manager', { percentage: 120 }, /more than 0 and at most 100/],
    ['Store Manager', { percentage: null }, /more than 0 and at most 100/],
  ])('refuses a %s of the wrong shape (%o)', (job, place, message) => {
    expect(() => save('dash.job_assignment', { ...base, job, ...place })).toThrow(message)
  })

  it('refuses an end on or before the start', () => {
    expect(() => save('dash.job_assignment', { ...base, job: 'Store Manager', ends_on: '2026-07-01' })).toThrow(/after starts_on/)
  })
})

describe('people', () => {
  it('refuses an approved headcount that is not a whole number', () => {
    expect(() => save('dash.section', { store: '9901', section_name: 'Sarees', team_leaders_allowed: 1, approved_headcount_min: 2.5 })).toThrow(/whole number/)
    expect(() => save('dash.section', { store: '9901', section_name: 'Sarees', team_leaders_allowed: 1, approved_headcount_max: -1 })).toThrow(/whole number/)
  })

  it('refuses an employment code padded with spaces, before reading any other row', () => {
    expect(() => save('dash.employment', { employee: 'e1', legal_company: ' DEMO-CO', employee_number: 'DEMO-0101', joined_on: '2026-01-01' })).toThrow(/no spaces/)
    expect(() => save('dash.employment', { employee: 'e1', legal_company: 'DEMO-CO', employee_number: 'DEMO-0101', joined_on: '2026-01-01' })).not.toThrow()
  })

  it('reads every page of a person\'s stints before deciding', async () => {
    const pages: Row[][] = [Array.from({ length: 500 }, (_, i) => ({ row_id: `x${i}`, employee: 'e1', legal_company: 'OTHER-CO', employee_number: `N${i}`, joined_on: '2020-01-01' })),
      [{ row_id: 'last', employee: 'e1', legal_company: 'DEMO-CO', employee_number: 'DEMO-0101', joined_on: '2025-01-01' }], []]
    const calls: unknown[] = []
    const documents = { get: async () => ({}), list: async (_table: string, args: unknown) => { calls.push(args); return pages.shift() ?? [] } }
    const row = { employee: 'e1', legal_company: 'DEMO-CO', employee_number: 'DEMO-0101', joined_on: '2026-01-01' }
    await expect(Promise.resolve(validators['dash.employment']({ row, user: 'admin@example.test', isNew: true, documents,
      reject(message: string): never { throw new Refused(message) } }))).rejects.toThrow(/overlaps/)
    expect(calls).toHaveLength(3)
  })

  it('keys a designation by its folded title, and an alias by its source and alias', () => {
    expect(save('dash.designation', { title: ' Assistant  Manager ' }).title_key).toBe('assistant manager')
    expect(save('dash.designation_alias', { source: 'hr', alias: 'ASST MGR', designation: 'd1' }).alias_key).toBe('hr/asst mgr')
  })
})

describe('aliases', () => {
  it('keys a section alias by its store, source and alias', () => {
    expect(save('dash.section_alias', { store: '9901', source: 'hr', alias: ' Saree ', section: 's1' }).alias_key).toBe('9901/hr/saree')
  })

  it('keys a floor alias by its store, source and alias', () => {
    expect(save('dash.floor_alias', { store: '9901', source: 'hr', alias: 'Ground floor', floor: 'f1' }).alias_key).toBe('9901/hr/ground floor')
  })

  it('keys a job alias by its source and the whole designation', () => {
    expect(save('dash.job_alias', { source: 'stylehr', alias: 'Warehouse - Team Leader', job: 'Team Leader' }).alias_key).toBe('stylehr/warehouse - team leader')
  })
})
