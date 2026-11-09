// #203/#205 (issue #197): "I imported one of the sheets and then there was an
// error in the second sheet", after which the finished import and the only
// link to the Import Log both became unreachable. The loop sat inside one
// try, so a throw on target 2 left targets 3..n unattempted and skipped the
// completion block that held the sole link to the log.
//
// Moved down from e2e/import-partial-failure.spec.ts (#1080). The e2e stubbed
// a 500 for the second target's create; here the server refuses it for real:
// its name is not a valid Table name, so the create call fails at the server
// and the other two targets are untouched.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]
const FIRST = 'Partial First'
const SECOND = 'Partial-Second' // refused by the server: not a valid Table name
const THIRD = 'Partial Third'
const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

function workbook() {
  const wb = XLSX.utils.book_new()
  for (const [name, header] of [['One', 'Pf One'], ['Two', 'Pf Two'], ['Three', 'Pf Three']] as const)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[header, 'Pf Note'], ['a', 'x'], ['b', 'y']]), name)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], 'partial failure.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

async function openWizard(admin: Admin) {
  clearSession()
  const user = userEvent.setup()
  const app = await renderApp('/featherbase/admin', admin)
  await user.click(await screen.findByTestId('import-data-link', {}, { timeout: 8000 }))
  return { user, app }
}

async function loadAll(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), { target: { files: [workbook()] } })
  await user.click(await screen.findByTestId('iw-ov-master', {}, { timeout: 8000 }))
  await user.click(screen.getByTestId('iw-ov-continue'))
}

async function rename(user: ReturnType<typeof userEvent.setup>, i: number, name: string) {
  const box = await screen.findByTestId(`iw-new-name-${i}`, {}, { timeout: 8000 })
  await user.clear(box)
  await user.type(box, name)
}

// #202: the column step walks one target at a time.
async function nameThree(user: ReturnType<typeof userEvent.setup>, names: [string, string, string]) {
  await rename(user, 0, names[0])
  await user.click(screen.getByTestId('iw-next'))
  await rename(user, 1, names[1])
  await user.click(screen.getByTestId('iw-next'))
  await rename(user, 2, names[2])
}

async function tableNames(admin: Admin) {
  return (await admin.get<{ data: { row_id: string }[] }>('/api/table/Table?limit_page_length=500')).data.map((t) => t.row_id)
}

test('a failing target does not abandon the rest of the run', async ({ admin }) => {
  const { user } = await openWizard(admin)
  await loadAll(user)
  await nameThree(user, [FIRST, SECOND, THIRD])
  await user.click(screen.getByTestId('iw-import'))

  // Target 1 imported, and its result survives the later failure.
  expect(await screen.findByTestId('iw-result-0', {}, { timeout: 15_000 })).toHaveTextContent('Imported 2 rows')
  // Target 2 failed, named, in its own place.
  expect(await screen.findByTestId('iw-failure-1', {}, { timeout: 15_000 })).toHaveTextContent(`${SECOND} failed`)
  // Target 3 was still attempted: the defect was that it never ran.
  expect(await screen.findByTestId('iw-result-2', {}, { timeout: 15_000 })).toHaveTextContent('Imported 2 rows')
  // The run reports all of it rather than vanishing.
  await waitFor(() => expect(screen.getByTestId('iw-done')).toHaveTextContent('1 failed'), { timeout: 8000 })

  const names = await tableNames(admin)
  expect(names).toContain(FIRST)
  expect(names).toContain(THIRD)
  expect(names).not.toContain(SECOND)
  clearSession()
}, 40_000)

test('the committed result stays revertable after a later failure', async ({ admin }) => {
  const { user } = await openWizard(admin)
  await loadAll(user)
  await nameThree(user, [FIRST, SECOND, THIRD])
  await user.click(screen.getByTestId('iw-import'))

  expect(await screen.findByTestId('iw-result-0', {}, { timeout: 15_000 })).toHaveTextContent('Imported 2 rows')
  await screen.findByTestId('iw-failure-1', {}, { timeout: 15_000 })
  // Undoing what did land stays possible: a failure elsewhere does not strand it.
  expect(await screen.findByTestId('iw-revert-open-0', {}, { timeout: 8000 })).toBeInTheDocument()
  clearSession()
}, 40_000)

test('the Import Log is reachable before a run, and after one fails', async ({ admin }) => {
  const { user, app } = await openWizard(admin)
  // #205: present immediately, not gated behind a clean run.
  expect(await screen.findByTestId('iw-history-link', {}, { timeout: 8000 })).toBeInTheDocument()

  await loadAll(user)
  // Every target refused: the exact case that used to hide the link.
  await nameThree(user, ['Partial-One', 'Partial-Two', 'Partial-Three'])
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-done')).toHaveTextContent('failed'), { timeout: 15_000 })
  await user.click(screen.getByTestId('iw-history-link'))
  await waitFor(() => expect(here(app)).toMatch(/^\/featherbase\/admin\/table\/import-log/), { timeout: 8000 })
  clearSession()
}, 40_000)
