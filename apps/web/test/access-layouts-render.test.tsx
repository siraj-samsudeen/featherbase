// #1224's "What you can see", rendered: how a role's source is said, how a role with many Tables
// reads, the every-account line that folds away, the apps the person can open, and the chosen
// layout surviving a browser that blocks storage. Made-up roles and Tables only.
import { createElement } from 'react'
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GivenBy, ReachTable, RolesLayout, SummaryLayout, reachedTables, useAccessLayout, type RoleRow, type TableReach } from '../src/pages/AccessLayouts'

afterEach(() => vi.restoreAllMocks())
const role = (over: Partial<RoleRow> & { role: string }): RoleRow => ({ app: null, through: null, given_by: null, given_at: null, ...over })
const reach = (table: string, over: Partial<TableReach> = {}): TableReach => ({ table, own_rows: false, roles: ['Auditor'], ...over })

describe('where a role comes from (#1224)', () => {
  test('a role an app gives says which app and through what; a built-in one says every account has it', () => {
    render(createElement('div', null,
      createElement(GivenBy, { r: role({ role: 'Member', app: 'tasker', through: 'Staff' }), lead: true }),
      createElement(GivenBy, { r: role({ role: 'All', implicit: true }) })))
    expect(screen.getByText('From app tasker, through Staff')).toBeInTheDocument()
    expect(screen.getByText(/every signed-in account has these/)).toBeInTheDocument()
  })
})

describe('a role that reaches many Tables (#1224)', () => {
  test('is said by count and areas, naming at most three areas; an app\'s Tables group under its name', () => {
    const tables = reachedTables([
      reach('tasker.task', { app: 'tasker', label: 'Task' }), reach('Site', { module: 'Organisation' }), reach('Plant', { module: 'Organisation' }),
      reach('Subcategory', { module: 'Merchandising' }), reach('Glossary Term', { module: 'Core' }),
    ], [])
    render(createElement(RolesLayout, { roles: [role({ role: 'Auditor' })], tables, everyTable: false, self: true }))
    expect(screen.getByTestId('access-role-card')).toHaveTextContent('You can read 5 tables, in General, Merchandising, Organisation and 1 more areas.')
    expect(screen.getByTestId('access-role-card')).toHaveTextContent('Tasker')
  })
})

describe('a role that reaches many Tables in a few areas (#1224)', () => {
  test('names the areas with "and" before the last', () => {
    const tables = reachedTables(['Site', 'Plant', 'Section', 'Store Floor'].map((t) => reach(t, { module: 'Organisation' })).concat(reach('Subcategory', { module: 'Merchandising' })), [])
    render(createElement(RolesLayout, { roles: [role({ role: 'Auditor' })], tables, everyTable: false, self: false }))
    expect(screen.getByTestId('access-role-card')).toHaveTextContent('They can read 5 tables, in Merchandising and Organisation.')
  })
})

describe('Tables every account reaches (#1224)', () => {
  test('fold into one line that Show opens and Hide closes', () => {
    const tables = reachedTables([reach('Glossary Term', { roles: ['All'] }), reach('Site', { roles: ['All'] })], [])
    render(createElement(ReachTable, { tables, through: true }))
    const line = screen.getByTestId('access-every-account-line')
    expect(line).toHaveTextContent('Every account can read 2 tables here')
    fireEvent.click(within(line).getByRole('button', { name: 'Show' }))
    expect(within(screen.getByTestId('access-every-account-line')).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(screen.getByTestId('access-every-account-line')).getByRole('button', { name: 'Hide' }))
    expect(within(screen.getByTestId('access-every-account-line')).getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('the summary (#1224)', () => {
  test('lists the apps the person can open, each a link', () => {
    render(createElement(SummaryLayout, { roles: [], tables: [], everyTable: false, limits: 0, shares: 0, places: null, privateTables: [], notes: null, self: true,
      apps: [{ name: 'tasker', title: 'Tasker', href: '/tasker/' }, { name: 'dash', title: 'Dash', href: '/dash/' }] }))
    const apps = screen.getByTestId('access-apps')
    expect(apps).toHaveTextContent('Tasker, Dash')
    expect(within(apps).getByRole('link', { name: 'Dash' })).toHaveAttribute('href', '/dash/')
  })
})

describe('the chosen layout (#1224)', () => {
  test('a browser that blocks storage opens the summary', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(renderHook(() => useAccessLayout()).result.current[0]).toBe('summary')
  })
})
