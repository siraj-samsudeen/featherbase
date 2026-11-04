// #898: the sidebar's Recently opened and Frequent, and the command bar's
// empty-state Recent and Frequent groups, offer only rows that still exist.
// History outlives rows; a deleted row's link led to an error page. The
// Table's own Recent chips have skipped deleted rows since #741.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { recordAction } from '../src/lib/recents'
import { test, expect, renderApp } from './pg-test'

const TABLE = 'Sidebar Bin'
const path = `/featherbase/admin/table/${encodeURIComponent(tableSlug(TABLE))}`
const WAIT = { timeout: 15_000 }

type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: TABLE, title_column: 'bin_name', columns: [
    { column_name: 'bin_name', column_type: 'Data' },
  ] })
  const row = (bin_name: string) => admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(TABLE)}`, { bin_name })
  return { kept: await row('Kept bin'), gone: await row('Deleted bin') }
}

/** Visit a row `times` times, the last visit `ago` ms ago. Two visits or more
 *  make it Frequent as well as recent. */
function visit(rowId: string, ago: number, times = 1) {
  for (let i = times - 1; i >= 0; i--)
    recordAction('Administrator', {
      kind: 'row', key: `row:${TABLE}/${rowId}`, label: rowId, sub: TABLE, path: `${path}/row/${rowId}`,
    }, Date.now() - ago - i * 60_000)
}

const labels = (testid: string) => screen.queryAllByTestId(testid).map((el) => el.textContent ?? '')

test('#898 a deleted row leaves the sidebar and the command bar; the rows still there stay', async ({ admin }) => {
  const { kept, gone } = await seed(admin)
  visit(kept.row_id, 3000, 3)
  visit(gone.row_id, 1000, 3)
  await admin.delete(`/api/table/${encodeURIComponent(TABLE)}/${gone.row_id}`)

  await renderApp('/featherbase/admin', admin)
  await waitFor(() => expect(labels('sidebar-recent').join('|')).toContain('Kept bin'), WAIT)
  const links = [...screen.queryAllByTestId('sidebar-recent'), ...screen.queryAllByTestId('sidebar-frequent')]
  expect(links.filter((a) => a.getAttribute('href')?.endsWith(`/row/${gone.row_id}`))).toHaveLength(0)
  expect(links.map((a) => a.textContent).join('|')).not.toContain('Deleted bin')

  fireEvent.focus(screen.getByTestId('awesomebar').querySelector('input')!)
  await waitFor(() => expect(labels('awesomebar-recent').join('|')).toContain('Kept bin'), WAIT)
  expect(labels('awesomebar-recent').join('|')).not.toContain('Deleted bin')
  // The kept row is the only Sidebar Bin row offered, recent or frequent.
  expect(labels('awesomebar-recent').filter((l) => l.includes(TABLE))).toHaveLength(1)
}, 40_000)

test('#898 a row deleted from its form leaves the sidebar at once', async ({ admin }) => {
  const user = userEvent.setup()
  const { kept, gone } = await seed(admin)
  visit(kept.row_id, 3000)
  visit(gone.row_id, 2000)

  await renderApp(`${path}/row/${gone.row_id}`, admin)
  await waitFor(() => expect(labels('sidebar-recent').join('|')).toContain('Deleted bin'), WAIT)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId('form-delete', {}, WAIT))
  await user.click(within(screen.getByTestId('delete-row-dialog')).getByTestId('delete-row-confirm'))

  await screen.findByTestId('list-view', {}, WAIT)
  await waitFor(() => expect(labels('sidebar-recent').join('|')).not.toContain('Deleted bin'), WAIT)
  expect(labels('sidebar-recent').join('|')).toContain('Kept bin')
}, 40_000)
