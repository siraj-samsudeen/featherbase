// The gallery renders shared primitives; the prototype starter retains drafts
// while switching to an actual metadata-driven list.
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import { createRootRoute } from '@tanstack/react-router'
import { renderApp } from 'feather-testing-postgres/react'
import { test as databaseTest } from './pg-test'
import { Gallery } from '../src/gallery/Gallery'
import { initialLabRows } from '../src/gallery/fixtures'
import { PrototypeLibrary } from '../src/gallery/PrototypeLibrary'
import { useState } from 'react'
import { Breadcrumbs, ContentTabs, SearchableList, TextInput } from '@featherbase/shop-floor'

afterEach(() => {
  delete document.documentElement.dataset.theme
})

databaseTest('screen starter retains its search and draft while the native list remembers its filter', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Lab Project',
    columns: [{ column_name: 'region', column_type: 'Data', label: 'Region', in_list_view: true }],
  })
  const user = userEvent.setup()
  const originalLocation = window.location.href
  window.history.replaceState(null, '', '/prototype.html')
  try {
    await renderApp('/prototype.html', {
      routeTree: createRootRoute({ component: PrototypeLibrary }),
      token: admin.token,
      user: { row_id: admin.user! },
    })
    await user.type(await screen.findByRole('textbox', { name: 'Note for Project records' }), 'Retain this plan')
    await user.type(screen.getByRole('searchbox', { name: 'Search screen starters' }), 'Project')
    expect(screen.queryByRole('link', { name: 'Related tasks' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Project records' })).toHaveAttribute('href', '/featherbase/admin/table/lab-project')

    await user.click(screen.getByRole('tab', { name: 'Native Table list' }))
    await screen.findByTestId('list-view')
    await user.type(screen.getByRole('searchbox', { name: 'Search Lab Project names' }), 'South')
    const location = new URL(window.location.href)
    expect(location.searchParams.get('labTab')).toBe('records')
    expect(JSON.parse(location.searchParams.get('labFilters')!)).toEqual([['name', 'like', '%South%']])

    await user.click(screen.getByRole('tab', { name: 'Component gallery' }))
    expect(screen.getByRole('heading', { name: 'Components' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Screen starter' }))
    expect(screen.getByRole('searchbox', { name: 'Search screen starters' })).toHaveValue('Project')
    expect(screen.getByRole('textbox', { name: 'Note for Project records' })).toHaveValue('Retain this plan')
    await user.click(screen.getByRole('tab', { name: 'Native Table list' }))
    expect(screen.getByRole('searchbox', { name: 'Search Lab Project names' })).toHaveValue('South')
  } finally {
    window.history.replaceState(null, '', originalLocation)
  }
})

test('content tabs retain drafts and expose keyboard navigation and the current breadcrumb', async () => {
  function Example() {
    const [tab, setTab] = useState('edit')
    return <><Breadcrumbs items={[{ label: 'Catalog', href: '/catalog?search=North' }, { label: 'Mapping' }]} />
      <ContentTabs label="Example sections" value={tab} onChange={setTab} tabs={[
        { id: 'edit', label: 'Mapping', content: <TextInput aria-label="Destination column" /> },
        { id: 'preview', label: 'Preview', content: <p>Preview rows</p> },
        { id: 'help', label: 'Help', content: <p>Reuse locations</p> },
      ]} /></>
  }
  const user = userEvent.setup()
  render(<Example />)
  expect(screen.getByRole('link', { name: 'Catalog' })).toHaveAttribute('href', '/catalog?search=North')
  expect(screen.getByText('Mapping', { selector: '[aria-current="page"]' })).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Destination column' }), 'customer_code')
  await user.click(screen.getByRole('tab', { name: 'Mapping' }))
  await user.keyboard('{ArrowLeft}')
  expect(screen.getByRole('tab', { name: 'Help' })).toHaveFocus()
  expect(screen.queryByRole('textbox', { name: 'Destination column' })).not.toBeInTheDocument()
  await user.keyboard('{Home}')
  expect(screen.getByRole('textbox', { name: 'Destination column' })).toHaveValue('customer_code')
  await user.keyboard('{End}{ArrowLeft}')
  expect(screen.getByRole('tab', { name: 'Preview' })).toHaveFocus()
})

test('searchable collections match the complete supplied list and can clear no-results', async () => {
  function Example() {
    const [query, setQuery] = useState('')
    return <SearchableList label="Search sources" placeholder="Search" items={['South studio', 'North workshop']} query={query} onQueryChange={setQuery} getSearchText={(row) => row}>
      {(rows) => <ul>{rows.map((row) => <li key={row}>{row}</li>)}</ul>}
    </SearchableList>
  }
  const user = userEvent.setup()
  render(<Example />)
  expect(screen.getByRole('searchbox', { name: 'Search sources' })).toHaveAttribute('placeholder', 'Search')
  await user.type(screen.getByRole('searchbox', { name: 'Search sources' }), ' NORTH ')
  expect(screen.getByText('North workshop')).toBeInTheDocument()
  expect(screen.queryByText('South studio')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('1 of 2')
  await user.type(screen.getByRole('searchbox', { name: 'Search sources' }), 'missing')
  expect(screen.getByRole('status')).toHaveTextContent('0 of 2')
  await user.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByText('South studio')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('2 of 2')
})

test('filters component examples by purpose', async () => {
  const user = userEvent.setup()
  render(<Gallery />)
  await user.type(screen.getByRole('searchbox', { name: 'Search components' }), 'list')
  expect(screen.getByRole('heading', { name: 'List (a table when wide, cards on a phone)' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Buttons' })).not.toBeInTheDocument()
  expect(screen.getByText('packages/shop-floor/src/DataList.tsx')).toBeInTheDocument()
})

test('Clear search brings every component example back', async () => {
  const user = userEvent.setup()
  render(<Gallery />)
  await user.type(screen.getByRole('searchbox', { name: 'Search components' }), 'list')
  await user.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByRole('searchbox', { name: 'Search components' })).toHaveValue('')
  expect(screen.getByRole('heading', { name: 'Buttons' })).toBeInTheDocument()
})

test('the gallery page draws the components on its own root', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  await act(() => import('../src/gallery/main'))
  expect(await screen.findByRole('heading', { level: 1, name: 'Components' })).toBeInTheDocument()
})

test('the synthetic lab starts with two projects and their two tasks', () => {
  const rows = initialLabRows()
  expect(rows['Lab Project'].map((row) => row.name)).toEqual(['North workshop', 'South studio'])
  expect(rows['Lab Task'].map((row) => row.project)).toEqual(['lab-north', 'lab-north'])
})

test('shows every section, flips light and dark, and raises both toasts', async () => {
  const user = userEvent.setup()
  render(<Gallery />)
  expect(screen.getByRole('heading', { level: 1, name: 'Components' })).toBeInTheDocument()
  for (const title of ['Buttons', 'Fields', 'Status, in words', 'Notices', 'Report headline', 'Tab bar (phone only)', 'Toasts'])
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
  expect(screen.getByText('Enter a number of 1 or more')).toBeInTheDocument()
  expect(screen.getAllByText('Men Casual Shirt').length).toBeGreaterThan(0)
  // The tab bar's specimen is drawn in place at any width, the open tab marked.
  const tabs = screen.getByRole('navigation', { name: 'Example app' })
  expect(tabs.className).not.toMatch(/\bsm:hidden\b/)
  expect(screen.getByRole('link', { name: 'Targets' })).toHaveAttribute('aria-current', 'page')

  await user.click(screen.getByRole('button', { name: 'Dark' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  await user.click(screen.getByRole('button', { name: 'Light' }))
  expect(document.documentElement.dataset.theme).toBe('light')

  await user.click(screen.getByRole('button', { name: 'Show a confirmation' }))
  expect(await screen.findByText('Checklist saved')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Show a failure' }))
  expect(await screen.findByText('Could not save. Check your connection and try again.')).toBeInTheDocument()
})
