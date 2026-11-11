// The search bar of the Admin (openspec/specs/admin-ui-feedback, "The search
// bar opens what it finds"). Real Admin in jsdom against the in-process server.

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'


const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

async function seed(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', {
    name: 'Sb Gadget',
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Sb Home',
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }],
  })
  const row = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Sb Gadget',
    row: { row_id: 'Zebrafinch-widget', title: 'Zebrafinch widget' },
  })
  return row.row_id
}

async function openBar(admin: Parameters<typeof renderApp>[1]) {
  const app = await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('all-tables-link', {}, { timeout: 8000 })
  const bar = screen.getByLabelText('Search or type a command')
  return { app, bar }
}

test('The search bar opens what it finds: picking a matching record opens its form', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)

  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Zebrafinch' } })
  const hit = await screen.findByTestId('awesomebar-doc')
  expect(hit).toHaveTextContent('Zebrafinch-widget')
  expect(hit).toHaveTextContent('Sb Gadget')
  fireEvent.click(hit)

  await waitFor(() => expect(field('title')).toHaveValue('Zebrafinch widget'))
  expect(here(app)).toBe('/featherbase/admin/table/sb-gadget/row/Zebrafinch-widget')
  await waitFor(() => expect(screen.queryByTestId('awesomebar-results')).not.toBeInTheDocument())
})

test('The search bar opens what it finds: a matching Table offers its list and a way to start a new row', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)

  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Sb Gadget' } })
  const create = await screen.findByTestId('awesomebar-new')
  expect(create).toHaveTextContent('New Sb Gadget row')
  expect(await screen.findAllByTestId('awesomebar-table')).not.toHaveLength(0)
  fireEvent.click(create)

  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/table/sb-gadget/new'))
  await waitFor(() => expect(field('title')).toHaveValue(''))
  await waitFor(() => expect(screen.queryByTestId('awesomebar-results')).not.toBeInTheDocument())
})

test('Plain arrow keys choose typed results in displayed order', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Sb Gadget' } })
  await screen.findByTestId('awesomebar-doc')
  await screen.findByTestId('awesomebar-table')
  await screen.findByTestId('awesomebar-new')
  const results = screen.getByTestId('awesomebar-results')
  const choices = Array.from(results.querySelectorAll('a, button'))
  expect(choices.length).toBeGreaterThanOrEqual(3)
  for (const choice of choices) {
    fireEvent.keyDown(bar, { key: 'ArrowDown' })
    expect(choice).toHaveAttribute('aria-selected', 'true')
    expect(bar).toHaveAttribute('aria-activedescendant', choice.id)
  }
  fireEvent.keyDown(bar, { key: 'ArrowDown' })
  expect(choices[0]).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(bar, { key: 'ArrowUp' })
  expect(choices.at(-1)).toHaveAttribute('aria-selected', 'true')
  const create = within(results).getByTestId('awesomebar-new')
  for (let i = 0; i < choices.length && create.getAttribute('aria-selected') !== 'true'; i++) {
    fireEvent.keyDown(bar, { key: 'ArrowUp' })
  }
  expect(create).toHaveAttribute('aria-selected', 'true')
  fireEvent.submit(bar.closest('form') as HTMLFormElement)
  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/table/sb-gadget/new'))
  expect(screen.queryByTestId('awesomebar-results')).not.toBeInTheDocument()
})

test('ArrowUp with no result chosen chooses the last one', async ({ admin }) => {
  await seed(admin)
  const { bar } = await openBar(admin)
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Sb Gadget' } })
  await screen.findByTestId('awesomebar-doc')
  const create = await screen.findByTestId('awesomebar-new')
  fireEvent.keyDown(bar, { key: 'ArrowUp' })
  const choices = Array.from(screen.getByTestId('awesomebar-results').querySelectorAll('a, button'))
  expect(choices.at(-1)).toHaveAttribute('aria-selected', 'true')
  expect(create).toBeInTheDocument()
})

test('Replacing a query cannot activate its previous record during debounce', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Zebrafinch' } })
  await screen.findByTestId('awesomebar-doc')
  // The replacement is not an exact Table name: the old first record would
  // otherwise win before the ordinary 150ms typing debounce has elapsed.
  fireEvent.change(bar, { target: { value: 'Sb Hom' } })
  fireEvent.submit(bar.closest('form') as HTMLFormElement)
  await waitFor(() => expect(here(app)).not.toBe('/featherbase/admin/all-tables'))
  expect(here(app)).not.toContain('Zebrafinch-widget')
})

test('The search bar opens what it finds: Enter on an exact Table name opens that Table\'s list', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)

  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Sb Home' } })
  await screen.findAllByTestId('awesomebar-table')
  fireEvent.submit(bar.closest('form') as HTMLFormElement)

  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/table/sb-home'))
  expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('awesomebar-results')).not.toBeInTheDocument())
})

test('The search bar opens what it finds: results are grouped under headings, and a command can be run from it', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)

  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'go to' } })
  const heading = await screen.findByTestId('awesomebar-commands-heading')
  expect(heading).toHaveTextContent('Commands')
  const results = screen.getByTestId('awesomebar-results')
  fireEvent.click(within(results).getByTestId('awesomebar-cmd-home'))
  await waitFor(() => expect(here(app).startsWith('/featherbase/admin')).toBe(true))
  await waitFor(() => expect(here(app)).not.toContain('all-tables'))
  await waitFor(() => expect(screen.queryByTestId('awesomebar-results')).not.toBeInTheDocument())
})

// Paths the merged web coverage report (ADR 0012) showed untaken.
test('The search bar opens what it finds: Enter on a word that names a record, not a Table, opens the record', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Zebrafinch' } })
  await screen.findByTestId('awesomebar-doc')
  fireEvent.submit(bar.closest('form') as HTMLFormElement)
  await waitFor(() => expect(field('title')).toHaveValue('Zebrafinch widget'))
  expect(here(app)).toBe('/featherbase/admin/table/sb-gadget/row/Zebrafinch-widget')
  await waitFor(() => expect(screen.queryByTestId('awesomebar-results')).not.toBeInTheDocument())
})

test('The search bar runs the theme commands', async ({ admin }) => {
  await seed(admin)
  const { bar } = await openBar(admin)
  for (const [id, theme] of [['theme-dark', 'dark'], ['theme-light', 'light']] as const) {
    fireEvent.focus(bar)
    fireEvent.change(bar, { target: { value: 'theme' } })
    fireEvent.click(await screen.findByTestId(`awesomebar-cmd-${id}`))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe(theme))
    expect(bar).toHaveValue('')
  }
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'theme' } })
  fireEvent.click(await screen.findByTestId('awesomebar-cmd-theme-device'))
  // Following the device is a stored choice, not a fixed look.
  await waitFor(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('fc_theme:'))
    expect(key && localStorage.getItem(key)).toBe('device')
  })
})

test('A past search comes back in the empty bar: arrow keys choose it and Enter puts it back in the bar', async ({ admin }) => {
  await seed(admin)
  const { bar } = await openBar(admin)
  // Search once, for a word that opens nothing in particular.
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Zebrafinch' } })
  await screen.findByTestId('awesomebar-doc')
  fireEvent.submit(bar.closest('form') as HTMLFormElement)
  await waitFor(() => expect(field('title')).toHaveValue('Zebrafinch widget'))

  // The empty bar now offers it among the recents; walk to it and press Enter.
  fireEvent.change(bar, { target: { value: '' } })
  bar.blur()
  bar.focus()
  const recents = await screen.findByTestId('awesomebar-recents')
  const items = within(recents).getAllByRole('option')
  const at = items.findIndex((b) => b.textContent?.includes('Zebrafinch') && within(b).queryByRole('img', { name: 'Search' }))
  expect(at).toBeGreaterThanOrEqual(0)
  // ArrowUp from the top wraps to the bottom; ArrowDown walks forward again.
  fireEvent.keyDown(bar, { key: 'ArrowUp' })
  for (let i = 0; i < ((at + 1) % items.length); i++) fireEvent.keyDown(bar, { key: 'ArrowDown' })
  fireEvent.submit(bar.closest('form') as HTMLFormElement)
  await waitFor(() => expect(bar).toHaveValue('Zebrafinch'))

  // Escape leaves the bar.
  bar.focus()
  fireEvent.keyDown(bar, { key: 'Escape' })
  expect(document.activeElement).not.toBe(bar)
})

test('#737 reopening the command bar discovers Tables added in the same session', async ({ admin }) => {
  await seed(admin)
  const { bar } = await openBar(admin)
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Sb Gadget' } })
  await screen.findByTestId('awesomebar-table')
  fireEvent.keyDown(bar, { key: 'Escape' })

  await admin.post('/api/table_def', {
    name: 'Sb Added Later',
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Sb Added Later' } })
  await waitFor(() => {
    const tables = screen.getAllByTestId('awesomebar-table')
    expect(tables.map((t) => t.textContent)).toEqual([expect.stringContaining('Sb Added Later')])
  })
})

// Moved from the deleted e2e/recents.spec.ts (#827, #822, #101).
test('#827 an arrow key held with a modifier leaves the chosen result where it is', async ({ admin }) => {
  await seed(admin)
  const { bar } = await openBar(admin)
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Sb Gadget' } })
  await screen.findByTestId('awesomebar-new')
  fireEvent.keyDown(bar, { key: 'ArrowDown' })
  const chosen = screen.getByTestId('awesomebar-results').querySelector('[aria-selected="true"]')
  expect(chosen).not.toBeNull()
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
    fireEvent.keyDown(bar, { key: 'ArrowDown', ...modifier })
    fireEvent.keyDown(bar, { key: 'ArrowUp', ...modifier })
    expect(chosen).toHaveAttribute('aria-selected', 'true')
  }
})

test('#827 opening a result takes the cursor out of the search bar', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)
  bar.focus()
  fireEvent.change(bar, { target: { value: 'Zebrafinch' } })
  await screen.findByTestId('awesomebar-doc')
  fireEvent.submit(bar.closest('form') as HTMLFormElement)
  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/table/sb-gadget/row/Zebrafinch-widget'))
  expect(bar).not.toHaveFocus()
})

test('#101 a past search is offered while its beginning is typed, and choosing it puts it back in the bar', async ({ admin }) => {
  await seed(admin)
  const { bar } = await openBar(admin)
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Zebrafinch' } })
  await screen.findByTestId('awesomebar-doc')
  fireEvent.submit(bar.closest('form') as HTMLFormElement)
  await waitFor(() => expect(field('title')).toHaveValue('Zebrafinch widget'))

  bar.focus()
  fireEvent.change(bar, { target: { value: 'Zeb' } })
  const offered = await screen.findByTestId('awesomebar-recent-search')
  expect(offered).toHaveTextContent('Zebrafinch')
  fireEvent.click(offered)
  await waitFor(() => expect(bar).toHaveValue('Zebrafinch'))
  expect(bar).toHaveFocus()
})

// #822: however a Table result is activated, the list opens, the results close,
// the cursor leaves the bar, and reopening the bar offers that Table among
// the recents — also when that list was already the page being shown.
const tablePath = '/featherbase/admin/table/sb-gadget'
for (const activation of ['pointer', 'Enter', 'focused link'] as const) {
  for (const alreadyOpen of [false, true]) {
    test(`#822 ${activation} on a Table result${alreadyOpen ? ' already open' : ''} opens its list and offers it among the recents`, async ({ admin }) => {
      await seed(admin)
      const app = await renderApp(alreadyOpen ? tablePath : '/featherbase/admin/all-tables', admin)
      await screen.findByTestId('all-tables-link', {}, { timeout: 8000 })
      const user = userEvent.setup()
      const bar = screen.getByLabelText('Search or type a command')
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
      expect(bar).toHaveFocus()
      await user.type(bar, 'Sb Gadget')
      const destination = await waitFor(() => {
        const found = screen.getAllByTestId('awesomebar-table').find((t) => t.textContent?.includes('Sb Gadget'))
        expect(found).toBeDefined()
        return found!
      })
      if (activation === 'pointer') await user.click(destination)
      else if (activation === 'Enter') await user.keyboard('{Enter}')
      else {
        destination.focus()
        expect(destination).toHaveFocus()
        await user.keyboard('{Enter}')
      }
      await waitFor(() => expect(here(app)).toBe(tablePath))
      expect(await screen.findByTestId('table-page')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByTestId('awesomebar-results')).not.toBeInTheDocument())
      expect(bar).not.toHaveFocus()

      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
      expect(bar).toHaveFocus()
      const recents = await screen.findByTestId('awesomebar-recents')
      await waitFor(() => expect(within(recents).getAllByTestId('awesomebar-recent').some((r) => r.textContent?.includes('Sb Gadget'))).toBe(true))
    })
  }
}
