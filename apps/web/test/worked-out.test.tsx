// #1282 C10–C11: the Lens's worked-out sections, drawn from the platform's checked answer. Made-up names.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorkedOutAnswer } from 'shared'

let answer: WorkedOutAnswer = { sections: [] }
vi.mock('../src/lib/api', () => ({ api: { get: vi.fn(async () => answer) } }))
const { WorkedOutCounts, WorkedOutSections } = await import('../src/components/WorkedOut')

afterEach(cleanup)

const SECTIONS: WorkedOutAnswer = { sections: [
  { heading: 'Apps They Can Open', note: 'worked out from their roles', empty: 'No apps from roles yet', rows: [
    { name: 'Tasker', app: 'tasker', detail: 'at level Manager', via: [{ name: 'Floor Manager', record: { table: 'dash.business_role', row: 'fm' } }],
      why: [{ name: 'Priya S.', record: { table: 'Person', row: 'p1' } }, { name: 'Floor Manager', record: { table: 'dash.business_role', row: 'fm' }, detailParts: [{ name: 'Store C', record: { table: 'Site', row: 'C' } }, { name: 'First floor' }] }, { name: 'Tasker · Manager' }] },
    { name: 'Dash', detail: 'at level Reader', via: [{ name: 'A row you cannot see' }] },
  ] },
  { heading: 'Reports They See', note: 'given to their roles', empty: 'No reports from roles yet', rows: [] },
] }

async function show(sections: WorkedOutAnswer, onOpen = vi.fn()) {
  answer = sections
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><WorkedOutSections table="Person" row="p1" onOpen={onOpen} /></QueryClientProvider>)
  return onOpen
}

describe('the Lens worked-out sections', () => {
  test('heads each section with its count and note, and keeps an empty one with its muted line', async () => {
    await show(SECTIONS)
    const [apps, reports] = await screen.findAllByTestId('worked-out-section')
    expect(within(apps!).getByRole('heading')).toHaveTextContent('Apps They Can Open 2 · worked out from their roles')
    expect([within(reports!).getByRole('heading').textContent, within(reports!).getByTestId('worked-out-empty').textContent])
      .toEqual(['Reports They See 0 · given to their roles', 'No reports from roles yet'])
  })

  test('each row: a locked tick saying where to change it, its name, its detail, and the role it comes via as a link', async () => {
    const onOpen = await show(SECTIONS)
    const [tasker, dash] = await screen.findAllByTestId('worked-out-row')
    expect(within(tasker!).getByTestId('worked-out-lock')).toHaveAttribute('title', 'Comes from a role; change it on the role')
    expect(tasker).toHaveTextContent('Tasker')
    expect(tasker).toHaveTextContent('at level Manager')
    const via = within(tasker!).getByTestId('worked-out-via')
    fireEvent.click(within(via).getByRole('link', { name: 'Floor Manager' }))
    expect(onOpen).toHaveBeenCalledWith({ table: 'dash.business_role', row: 'fm' })
    // The app's name opens the app; the level is words.
    expect(within(tasker!).getByRole('link', { name: 'Tasker' })).toHaveAttribute('href', '/tasker/')
    expect(within(tasker!).queryByRole('link', { name: /at level/ })).toBeNull()
    // A role the viewer may not read is plain words.
    expect(within(within(dash!).getByTestId('worked-out-via')).queryByRole('link')).toBeNull()
  })

  test('Why? opens the one-line chain, its records links, and only where the answer gives one', async () => {
    await show(SECTIONS)
    const [tasker, dash] = await screen.findAllByTestId('worked-out-row')
    expect(within(dash!).queryByTestId('worked-out-why')).toBeNull()
    fireEvent.click(within(tasker!).getByRole('button', { name: 'Why?' }))
    const chain = within(tasker!).getByTestId('worked-out-chain')
    expect(chain).toHaveTextContent('Priya S. → Floor Manager (Store C · First floor) → Tasker · Manager')
    expect(within(chain).getAllByRole('link').map((l) => l.textContent)).toEqual(['Priya S.', 'Floor Manager', 'Store C'])
    fireEvent.click(within(tasker!).getByRole('button', { name: 'Hide why' }))
    expect(within(tasker!).queryByTestId('worked-out-chain')).toBeNull()
  })

  test('draws nothing where nothing is worked out', async () => {
    await show({ sections: [] })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('worked-out-section')).toBeNull()
  })
})

describe("#1349: the worked-out sections in the count row (board 4b)", () => {
  test('a chip each, the number first; an empty section a quiet grey chip that leads nowhere', async () => {
    answer = SECTIONS
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onSection = vi.fn()
    render(<QueryClientProvider client={client}><WorkedOutCounts table="Person" row="p1" onSection={onSection} /></QueryClientProvider>)
    const apps = await screen.findByRole('button', { name: '2 Apps They Can Open' })
    fireEvent.click(apps)
    expect(onSection).toHaveBeenCalledWith('Apps They Can Open')
    expect(screen.getByText('Reports They See').closest('[data-empty]')).toHaveTextContent('0 Reports They See')
    expect(screen.queryByRole('button', { name: /Reports They See/ })).toBeNull()
  })
})
