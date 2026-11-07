// #919: an app's `administration` declaration is checked on load: every name
// it uses is the app's own, and has the shape the enforcement reads.
import { describe, expect, test } from 'vitest'
import { validateAdministration, type AdministrationDeclaration } from '../src/administration'

const person = (column_name: string) => ({ column_name, column_type: 'Reference', reference_table: 'Person' })
const data = (column_name: string) => ({ column_name, column_type: 'Data' })

const manifest = () => ({
  name: 'shop',
  roles: ['Manager', 'Helper', 'Viewer'],
  tables: [
    { name: 'shop.job', decides_scope: true, columns: [person('person'), data('job'), data('store'), data('starts_on'), data('ends_on')] },
    { name: 'shop.shelf', columns: [data('store')] },
    { name: 'shop.staff', columns: [person('person'), data('phone')] },
    { name: 'shop.contract', columns: [{ column_name: 'staff', column_type: 'Reference', reference_table: 'shop.staff' }, data('terms')] },
  ],
  permissions: [{ table: 'shop.shelf', role: 'Manager', scope_mode: 'reach' }, { table: 'shop.shelf', role: 'Viewer' }],
})

const declaration = (): AdministrationDeclaration => ({
  provider: 'stores',
  tables: ['shop.job'],
  jobRoles: ['Manager'],
  targets: {
    'shop.shelf': { column: 'store' },
    'shop.job': { column: 'store', protect: { column: 'job', values: ['Manager'] } },
    'shop.staff': { person: 'person' },
    'shop.contract': { person: 'staff.person' },
  },
  memberships: { table: 'shop.job', person: 'person', column: 'store', startsOn: 'starts_on', endsOn: 'ends_on' },
  delegation: [{ authority: 'Manager', grants: ['Helper'] }],
})

describe('the administration declaration', () => {
  test('accepts a declaration naming only the app\'s own roles, Tables and Columns', () => {
    expect(() => validateAdministration(manifest(), declaration())).not.toThrow()
  })

  test('is optional, unless a permission is limited to reach', () => {
    const m = manifest()
    expect(() => validateAdministration(m, undefined)).toThrow(/needs the app's administration declaration/)
    m.permissions = m.permissions.filter(p => !p.scope_mode)
    expect(() => validateAdministration(m, undefined)).not.toThrow()
  })

  test.each<[string, (d: AdministrationDeclaration, m: ReturnType<typeof manifest>) => void, RegExp]>([
    ['a job role not among the roles', d => { d.jobRoles = ['Owner'] }, /Job role Owner is not one of the app's roles/],
    ['a giver that is not a job role', d => { d.delegation = [{ authority: 'Helper', grants: ['Viewer'] }] }, /Only a job role gives roles/],
    ['a given role not among the roles', d => { d.delegation = [{ authority: 'Manager', grants: ['Owner'] }] }, /Given role Owner/],
    ['a job role given', d => { d.delegation = [{ authority: 'Manager', grants: ['Manager'] }] }, /A job role cannot be given/],
    ['memberships on another app\'s Table', d => { d.memberships.table = 'other.job' }, /Memberships must be one of the app's Tables/],
    ['a membership person that is not a Person', d => { d.memberships.person = 'store' }, /membership's person is a Reference to Person/],
    ['a membership column missing', d => { d.memberships.endsOn = 'left_on' }, /Memberships have no column left_on/],
    ['a target that is not the app\'s', d => { d.targets['other.shelf'] = { column: 'store' } }, /other.shelf is not one of the app's Tables/],
    ['a target column missing', d => { d.targets['shop.shelf'] = { column: 'plant' } }, /shop.shelf has no column plant/],
    ['a protected column missing', d => { d.targets['shop.job'] = { column: 'store', protect: { column: 'grade', values: ['A'] } } }, /shop.job has no column grade/],
    ['a person target that is not a Person', d => { d.targets['shop.staff'] = { person: 'phone' } }, /shop.staff.phone is not a Reference to Person/],
    ['a person path that leads nowhere', d => { d.targets['shop.contract'] = { person: 'staff.phone' } }, /shop.contract.staff.phone does not lead to a Person/],
    ['a person path through a non-Reference', d => { d.targets['shop.contract'] = { person: 'terms.person' } }, /does not lead to a Person/],
    ['a provider read of an unmarked Table', d => { d.tables = ['shop.job', 'shop.shelf'] }, /reads only Tables marked decides_scope/],
    ['a reach permission on a Table that is no target', (_d, m) => { m.permissions.push({ table: 'shop.job', role: 'Manager', scope_mode: 'reach' }); delete _d.targets['shop.job'] }, /needs it among the administration targets/],
    ['a reach permission for another role', (_d, m) => { m.permissions.push({ table: 'shop.shelf', role: 'Viewer', scope_mode: 'reach' }) }, /Viewer is neither/],
  ])('refuses %s', (_name, change, message) => {
    const m = manifest()
    const d = declaration()
    change(d, m)
    expect(() => validateAdministration(m, d)).toThrow(message)
  })

  test('lets the provider read Tables that are not the app\'s, such as the instance\'s masters', () => {
    const d = declaration()
    d.tables = ['shop.job', 'Plant']
    expect(() => validateAdministration(manifest(), d)).not.toThrow()
  })
})
