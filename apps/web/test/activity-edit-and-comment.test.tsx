// UI-019: after an edit and a comment made on the row page, the Activity
// timeline shows both, in the order they happened, the edit with its diff.
// Moved from the Playwright timeline spec (#1080).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'

const DT = 'Aec Note'
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`)!

test('UI-019: an edit (with its diff) and then a comment show in the timeline in that order', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/save_row', {
    table: 'Metadata Override',
    row: { table_name: DT, property: 'enable_discussion', value: 'true' },
  })
  await admin.post('/api/save_row', { table: DT, row: { row_id: 'aec-1', title: 'original' } })
  const user = userEvent.setup()
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}/row/aec-1`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('title')).toHaveValue('original'))

  fireEvent.change(field('title'), { target: { value: 'revised title' } })
  await user.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))

  await user.click(screen.getByRole('tab', { name: 'Activity' }))
  const timeline = await screen.findByTestId('activity-timeline', {}, { timeout: 8000 })
  await waitFor(() => expect(within(timeline).getAllByTestId('activity-version')).toHaveLength(1))
  const diff = within(timeline).getByTestId('activity-diff')
  expect(diff).toHaveTextContent('title')
  expect(diff).toHaveTextContent('original')
  expect(diff).toHaveTextContent('revised title')

  await user.type(screen.getByTestId('comment-input'), 'looks good now')
  await user.click(screen.getByTestId('comment-submit'))
  await waitFor(() => expect(within(timeline).getAllByTestId('activity-comment')).toHaveLength(1))
  const kinds = [...timeline.querySelectorAll('[data-testid^="activity-version"], [data-testid^="activity-comment"]')]
    .map((el) => el.getAttribute('data-testid'))
  expect(kinds).toEqual(['activity-version', 'activity-comment'])
})
