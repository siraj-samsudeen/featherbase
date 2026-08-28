// UI-018: the comment box every row carries. Pushed down from
// e2e/comments.spec.ts (#223 batch 1) — nothing it asserted needed a real
// browser, and the spec paid for that with 20 lines of "delete the Comment
// rows an earlier run left behind" setup that rollback now does for free.
//
// Four independent claims, one test each: an empty thread says so, a posted
// comment persists, the @ token offers candidates and rewrites the draft, and
// a stored mention renders as its own highlighted node (not as plain text,
// which is what a broken renderContent would leave behind).

import { screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { test, expect, renderApp } from './pg-test'

const DT = 'Cmt Row'

type Admin = Parameters<typeof renderApp>[1]

async function seedRow(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
  const doc = (await admin.post('/api/save_row', {
    table: DT,
    row: { title: 'discuss me' },
  })) as { row_id: string }
  return doc.row_id
}

async function openRow(admin: Admin, rowId: string) {
  await renderApp(`/admin/${encodeURIComponent(DT)}/${rowId}`, admin)
  await screen.findByTestId('form-view')
  return screen.findByTestId('comments-panel')
}

const input = () => screen.getByTestId('comment-input') as HTMLTextAreaElement

function type(text: string) {
  const el = input()
  fireEvent.change(el, { target: { value: text, selectionStart: text.length } })
}

async function submit(text: string) {
  type(text)
  await waitFor(() => expect(screen.getByTestId('comment-submit')).toBeEnabled())
  screen.getByTestId('comment-submit').click()
}

test('a row with no comments says so rather than rendering an empty list', async ({ admin }) => {
  const rowId = await seedRow(admin)
  const panel = await openRow(admin, rowId)
  await waitFor(() => expect(panel).toHaveTextContent('No comments yet'))
  expect(screen.queryAllByTestId('comment-item')).toHaveLength(0)
})

test('a posted comment appears in the thread and is stored against the row', async ({ admin }) => {
  const rowId = await seedRow(admin)
  const panel = await openRow(admin, rowId)
  await waitFor(() => expect(panel).toHaveTextContent('No comments yet'))

  await submit('First observation')

  await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1))
  expect(screen.getByTestId('comment-content')).toHaveTextContent('First observation')
  // The draft clears, so the next comment starts from empty.
  await waitFor(() => expect(input()).toHaveValue(''))

  const stored = (await admin.get(
    `/api/table/Comment?filters=${encodeURIComponent(
      JSON.stringify([
        ['ref_table', '=', DT],
        ['ref_name', '=', rowId],
      ]),
    )}&fields=${encodeURIComponent(JSON.stringify(['content', 'created_by']))}`,
  )) as { data: { content: string; created_by: string }[] }
  expect(stored.data).toEqual([{ content: 'First observation', created_by: 'Administrator' }])
})

test('an @ token offers matching users and completes the draft on pick', async ({ admin }) => {
  const rowId = await seedRow(admin)
  await openRow(admin, rowId)

  type('cc @Admin')
  const option = await screen.findByTestId('mention-option')
  expect(option).toHaveTextContent('Administrator')

  option.click()
  // The token is replaced whole — '@Admin' becomes '@Administrator ', with the
  // text before it untouched and a trailing space to carry on typing.
  await waitFor(() => expect(input()).toHaveValue('cc @Administrator '))
})

test('a stored mention renders as its own highlighted node, and notifies', async ({ admin }) => {
  const rowId = await seedRow(admin)
  const panel = await openRow(admin, rowId)
  await waitFor(() => expect(panel).toHaveTextContent('No comments yet'))

  await submit('cc @Administrator please review')
  await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1))

  // The mention is a separate element, brand-coloured — not swallowed into
  // the surrounding sentence.
  const mention = within(screen.getByTestId('comment-content')).getByText('@Administrator')
  expect(mention.tagName).toBe('SPAN')
  expect(mention.className).toContain('--color-brand')

  const notifs = (await admin.get(
    `/api/table/Notification%20Log?filters=${encodeURIComponent(
      JSON.stringify([
        ['for_user', '=', 'Administrator'],
        ['ref_table', '=', DT],
        ['ref_name', '=', rowId],
      ]),
    )}&fields=${encodeURIComponent(JSON.stringify(['subject']))}`,
  )) as { data: { subject: string }[] }
  expect(notifs.data).toHaveLength(1)
  expect(notifs.data[0].subject).toContain('mentioned you')
})
