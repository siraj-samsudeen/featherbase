// The component gallery (#380, /gallery.html on the dev server): the page
// renders every shared primitive, flips the theme, and raises both toasts.
// No e2e spec opens it — gallery.html is outside the app's routes — so this is
// its only test (ADR 0012 merged web coverage). Pure UI: no server, no data.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import { Gallery } from '../src/gallery/Gallery'
import { useState } from 'react'
import { Breadcrumbs, ContentTabs, SearchableList, TextInput } from '../src/components/ui'

afterEach(() => {
  delete document.documentElement.dataset.theme
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
  expect(screen.getByText('apps/web/src/components/ui/DataList.tsx')).toBeInTheDocument()
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
