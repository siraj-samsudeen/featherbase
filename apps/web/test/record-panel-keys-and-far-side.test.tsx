// The record panel's keys and links, and a link table's far side opened in the panel (#1259,
// #1218 slice 1). Only Escape closes the panel; a modified click on Edit is the browser's (a new
// tab), not a move of this page; a row named by what it points to opens that record in the panel.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

const COURSE = 'Kp Course'
const STUDENT = 'Kp Student'
const ENROL = 'Kp Enrolment'

async function seed(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', { name: COURSE, id_pattern: 'prompt', title_column: 'course_name',
    columns: [{ column_name: 'course_name', column_type: 'Data', label: 'Course name', in_list_view: true }] })
  await admin.post('/api/table_def', { name: STUDENT, id_pattern: 'prompt', title_column: 'student_name',
    columns: [{ column_name: 'student_name', column_type: 'Data', label: 'Student name', in_list_view: true }] })
  // A link table: its title is its own id, so its rows read by what they link to.
  await admin.post('/api/table_def', { name: ENROL, id_pattern: 'field:enrolment_id', title_column: 'enrolment_id',
    columns: [
      { column_name: 'enrolment_id', column_type: 'Data', label: 'Enrolment', in_list_view: true },
      { column_name: 'course', column_type: 'Reference', reference_table: COURSE, label: 'Course', in_list_view: true },
      { column_name: 'student', column_type: 'Reference', reference_table: STUDENT, label: 'Student', in_list_view: true },
    ] })
  await admin.post('/api/save_row', { table: COURSE, row: { row_id: 'C1', course_name: 'Weaving' } })
  await admin.post('/api/save_row', { table: STUDENT, row: { row_id: 'S1', student_name: 'Meena Weaver' } })
  await admin.post('/api/save_row', { table: ENROL, row: { enrolment_id: 'E1', course: 'C1', student: 'S1' } })
}

/** #1273 (D3): the group's chip under the title jumps to its section on the Links tab. */
async function enrolmentsOnLinks() {
  const chips = await screen.findByRole('region', { name: 'Connections' })
  fireEvent.click(await within(chips).findByRole('button', { name: new RegExp(`^${ENROL}`) }))
  return screen.findByTestId('record-links')
}

test("a link table's row reads as its far side, and that name opens the student in the panel", async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(COURSE)}/row/C1`, admin)
  const links = await enrolmentsOnLinks()
  fireEvent.click(await within(links).findByRole('link', { name: 'Meena Weaver' }))
  expect(await screen.findByRole('complementary', { name: /Meena Weaver/ })).toBeInTheDocument()
})

test('only Escape closes the record panel, and a modified click on Edit leaves this page where it is', async ({ admin }) => {
  await seed(admin)
  const { router } = await renderApp(`${tableHref(COURSE)}/row/C1`, admin)
  fireEvent.click(await within(await enrolmentsOnLinks()).findByRole('link', { name: 'Meena Weaver' }))
  const panel = await screen.findByTestId('record-panel')
  fireEvent.keyDown(panel, { key: 'a' })
  expect(screen.getByTestId('record-panel')).toBeInTheDocument()
  const here = () => (router.state as { location: { href: string } }).location.href
  const before = here()
  const edit = await within(panel).findByRole('link', { name: 'Edit' })
  fireEvent.click(edit, { ctrlKey: true })
  expect(here()).toBe(before)
  fireEvent.keyDown(panel, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument())
})
