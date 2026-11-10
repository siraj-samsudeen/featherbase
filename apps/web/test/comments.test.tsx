// UI-018: the comment box every row carries. Pushed down from
// e2e/comments.spec.ts (#223 batch 1) — nothing it asserted needed a real
// browser, and the spec paid for that with 20 lines of "delete the Comment
// rows an earlier run left behind" setup that rollback now does for free.
//
// Four independent claims, one test each: an empty thread says so, a posted
// comment persists, the @ token offers candidates and rewrites the draft, and
// a stored mention renders as its own highlighted node (not as plain text,
// which is what a broken renderContent would leave behind).

import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { vi } from 'vitest'
import type { Sql } from 'postgres'
import { test, expect, renderApp } from './pg-test'

const DT = 'Cmt Row'

type Admin = Parameters<typeof renderApp>[1]

async function seedRow(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
  await admin.post('/api/save_row', {
    table: 'Metadata Override',
    row: { table_name: DT, property: 'enable_discussion', value: 'true' },
  })
  const doc = (await admin.post('/api/save_row', {
    table: DT,
    row: { title: 'discuss me' },
  })) as { row_id: string }
  return doc.row_id
}

async function openRow(admin: Admin, rowId: string) {
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}/row/${rowId}`, admin)
  await screen.findByTestId('form-view')
  fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
  return screen.findByTestId('activity-timeline')
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

// #829: a row's activity always opens with who created it, so a row with no
// comments shows that line and no comment entries.
test('a row with no comments shows only who created it', async ({ admin }) => {
  const rowId = await seedRow(admin)
  const panel = await openRow(admin, rowId)
  await waitFor(() => expect(panel).toHaveTextContent('Administrator created this'))
  expect(panel).not.toHaveTextContent('No activity yet')
  expect(screen.queryAllByTestId('activity-comment')).toHaveLength(0)
})

test('a posted comment appears in the thread and is stored against the row', async ({ admin }) => {
  const rowId = await seedRow(admin)
  const panel = await openRow(admin, rowId)
  await waitFor(() => expect(panel).toHaveTextContent('Administrator created this'))

  await submit('First observation')

  await waitFor(() => expect(screen.getAllByTestId('activity-comment')).toHaveLength(1))
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

// person-rename: ids are opaque, so a mention names the person — `@username`,
// or `@[Full Name]` for someone without one. Built-in accounts are not offered.
async function people(admin: Admin) {
  await admin.post('/api/save_row', { table: 'Person', row: { username: 'asha.k', full_name: 'Asha Kumar' } })
  const ravi = (await admin.post('/api/save_row', { table: 'Person', row: { full_name: 'Ravi Menon' } })) as { row_id: string }
  return { ravi: ravi.row_id }
}

test('an @ token offers matching people by name and completes the draft with their handle', async ({ admin }) => {
  await people(admin)
  const rowId = await seedRow(admin)
  await openRow(admin, rowId)

  type('cc @ash')
  const option = await screen.findByTestId('mention-option')
  expect(option).toHaveTextContent('Asha Kumar · @asha.k')
  option.click()
  // The token is replaced whole, with a trailing space to carry on typing.
  await waitFor(() => expect(input()).toHaveValue('cc @asha.k '))

  // Someone without a username is mentioned by name.
  type('cc @rav')
  const byName = await screen.findByTestId('mention-option')
  expect(byName).toHaveTextContent('Ravi Menon')
  byName.click()
  await waitFor(() => expect(input()).toHaveValue('cc @[Ravi Menon] '))

  // The built-in Administrator is never offered.
  type('cc @Admin')
  await waitFor(() => expect(screen.queryAllByTestId('mention-option')).toHaveLength(0))
})

test('a stored mention renders as its own highlighted node, and notifies', async ({ admin }) => {
  const { ravi } = await people(admin)
  const rowId = await seedRow(admin)
  const panel = await openRow(admin, rowId)
  await waitFor(() => expect(panel).toHaveTextContent('Administrator created this'))

  await submit('cc @[Ravi Menon] please review')
  await waitFor(() => expect(screen.getAllByTestId('activity-comment')).toHaveLength(1))

  // The mention is a separate element, brand-coloured — not swallowed into
  // the surrounding sentence.
  const mention = within(screen.getByTestId('comment-content')).getByText('@[Ravi Menon]')
  expect(mention.tagName).toBe('SPAN')
  expect(mention.className).toContain('text-action')

  const notifs = (await admin.get(
    `/api/table/Notification%20Log?filters=${encodeURIComponent(
      JSON.stringify([
        ['for_user', '=', ravi],
        ['ref_table', '=', DT],
        ['ref_name', '=', rowId],
      ]),
    )}&fields=${encodeURIComponent(JSON.stringify(['subject']))}`,
  )) as { data: { subject: string }[] }
  expect(notifs.data).toHaveLength(1)
  expect(notifs.data[0].subject).toContain('mentioned you')
})

test('a person with neither a username nor a name is never offered, so a mention never carries an id (Codex review on #384)', async ({ admin }) => {
  await admin.post('/api/save_row', { table: 'Person', row: { email: 'nameless@example.com' } })
  await admin.post('/api/save_row', { table: 'Person', row: { username: 'named.one', full_name: 'Named One' } })
  const rowId = await seedRow(admin)
  await openRow(admin, rowId)
  type('cc @')
  await screen.findAllByTestId('mention-option')
  const shown = screen.getAllByTestId('mention-option').map((o) => o.textContent ?? '')
  expect(shown).toContain('Named One · @named.one')
  expect(shown.some((t) => /psn_|Unnamed/.test(t) || t.trim() === '')).toBe(false)
})

// #909: the box names the person writing by their name, never by an id.
test('the comment box says who is commenting by name', async ({ admin, createUser }) => {
  const rowId = await seedRow(admin)
  const priya = await createUser({ email: 'priya.cmt@example.com', fullName: 'Priya Commenter', roles: ['System Manager'] })
  expect(priya.user).toMatch(/^psn_/)
  await openRow(priya, rowId)
  await waitFor(() => expect(input().placeholder).toBe('Comment as Priya Commenter… use @ to mention'))
  expect(input().placeholder).not.toContain('psn_')
})

test('for a person with no name the comment box asks for a comment without naming them, and their comment shows no initials made from an id', async ({ admin, createUser, db }) => {
  const rowId = await seedRow(admin)
  const nameless = await createUser({ email: 'nameless.cmt@example.com', roles: ['System Manager'] })
  await (db as Sql)`update person set full_name = null, username = null, email = null where row_id = ${nameless.user}`
  await openRow(nameless, rowId)
  await waitFor(() => expect(input().placeholder).toBe('Write a comment… use @ to mention'))
  await submit('From nobody in particular')
  const timeline = screen.getByTestId('activity-timeline')
  await waitFor(() => expect(timeline).toHaveTextContent('From nobody in particular'))
  expect(within(timeline).getAllByTestId('comment-initials').at(-1)).toHaveTextContent('·')
})

test('Administrator, whose id is a name, comments under it', async ({ admin, db }) => {
  const rowId = await seedRow(admin)
  await (db as Sql)`update person set full_name = null where row_id = 'Administrator'`
  await openRow(admin, rowId)
  await waitFor(() => expect(input().placeholder).toBe('Comment as Administrator… use @ to mention'))
})

test('a mention by a name two people share warns that it will notify nobody', async ({ admin }) => {
  await admin.post('/api/save_row', { table: 'Person', row: { full_name: 'Devi Nair' } })
  await admin.post('/api/save_row', { table: 'Person', row: { full_name: 'Devi  Nair' } })
  const rowId = await seedRow(admin)
  await openRow(admin, rowId)
  type('cc @devi')
  await waitFor(() => expect(screen.getAllByTestId('mention-option')).toHaveLength(2))
  screen.getAllByTestId('mention-option')[0].click()
  await waitFor(() => expect(input().value).toMatch(/^cc @\[Devi +Nair\] $/))
  expect(screen.getByTestId('mention-warning')).toHaveTextContent(/^2 people are named Devi +Nair, so this mention will notify nobody\./)
})

test('a comment the network drops says the comment failed and keeps the draft', async ({ admin }) => {
  const rowId = await seedRow(admin)
  await openRow(admin, rowId)
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url) === '/api/save_row'
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
  await submit('lost words')
  expect(await screen.findByText('Comment failed')).toBeInTheDocument()
  expect(input()).toHaveValue('lost words')
})
