// tasker-due-dates's scenarios (#1070): each test is one fenced scenario of
// openspec/specs/tasker-due-dates/spec.md, step by step, with Tasker's page
// rendered in jsdom against the real in-process server. "Today is" sets the
// clock both the server and the page read.
import { waitFor, within } from '@testing-library/react'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect } from '../pg-test'
import { TaskerWorld, type TaskerPage, realTime } from './tasker'

const scenario = scenarioFor(test, 'tasker-due-dates')
afterEach(realTime)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "4 November 2026" -> '2026-11-04'. */
function day(text: string) {
  const [d, month, year] = text.split(' ')
  return `${year}-${String(MONTHS.indexOf(month!) + 1).padStart(2, '0')}-${d!.padStart(2, '0')}`
}

/** "Today is 6 November 2026": midday UTC is the same calendar day for the server and the page. */
const todayIs = (tasker: TaskerWorld, text: string) => tasker.setClock(`${day(text)}T12:00:00Z`)

/** A task with these dates: the scenario's own if it has one by that title, else a new one. */
async function dated(tasker: TaskerWorld, title: string, values: Record<string, unknown>) {
  await tasker.member('the user')
  return tasker.tasks.has(title) ? tasker.change(title, values) : tasker.task(title, values)
}

const DETAIL = '[aria-label="Task detail content"]'

/** The user sets the current task's due date in its details, and the change reaches the server. */
async function setDueDate(tasker: TaskerWorld, value: string) {
  const task = tasker.current!
  const page = await tasker.as('the user')
  const detail = await page.openTask(task.row_id, String(task.task_title))
  // Enabled once the page has the task: the DSL has no verb for a field being enabled.
  await waitFor(() => expect(within(detail).getByLabelText('Due date')).toBeEnabled())
  await page.session.within(DETAIL, (details) => details.fillIn('Due date', value))
  return { page, detail }
}

/** The due date the current task's details show, opened afresh by whoever last looked. */
async function dueDateShown(tasker: TaskerWorld, value: string) {
  const task = tasker.current!
  const page = await tasker.viewerPage()
  await page.openTask(task.row_id, String(task.task_title))
  await page.session.within(DETAIL, (details) => details.assertValue('Due date', value))
}

// The row is found by its title, which no selector names.
async function rowMarked(tasker: TaskerWorld, mark: 'overdue' | 'scheduled', word: RegExp) {
  const task = tasker.current!
  const page = await tasker.viewerPage()
  await page.openProject(tasker.projectOf(task))
  await page.expectDueMark(String(task.task_title), mark)
  expect((await page.dueMark(String(task.task_title)))!.text).toMatch(word)
}

describe('tasker-due-dates', () => {
  scenario('A task with a due date', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('the user has a task "Reconcile stock variance"', async () => {
      await tasker.member('the user')
      await tasker.task('Reconcile stock variance')
    })
    await step('the user sets its due date to 4 November 2026', async () => {
      await setDueDate(tasker, day('4 November 2026'))
      await waitFor(async () => expect(String((await tasker.fresh()).due_date).slice(0, 10)).toBe('2026-11-04'))
    })
    await step('the task shows it is due on 4 November 2026', () => dueDateShown(tasker, '2026-11-04'))
  })

  scenario('A due date before the start date', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    let detail: HTMLElement
    await step('the task "Reconcile stock variance" starts on 10 November 2026', () =>
      dated(tasker, 'Reconcile stock variance', { start_date: day('10 November 2026') }))
    await step('the user sets its due date to 4 November 2026', async () => {
      ;({ detail } = await setDueDate(tasker, day('4 November 2026')))
    })
    await step("the due date is refused, saying it can't be before the start date", async () => {
      // A pattern, for either apostrophe: the DSL's text verbs match literal text only.
      expect(await within(detail).findByRole('alert')).toHaveTextContent(/due date can[’']t be before the start date/i)
      await dueDateShown(tasker, '')
      expect((await tasker.fresh()).due_date).toBeNull()
    })
  })

  scenario('A late task', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('today is 6 November 2026', () => todayIs(tasker, '6 November 2026'))
    await step('the task "Reconcile stock variance" is due on 4 November 2026 and is not done', async () => {
      const task = await dated(tasker, 'Reconcile stock variance', { due_date: day('4 November 2026') })
      expect(task.task_state).not.toBe('Done')
    })
    await step('the task is marked Overdue', () => rowMarked(tasker, 'overdue', /^Overdue\b/))
  })

  scenario('A task not started yet', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('today is 6 November 2026', () => todayIs(tasker, '6 November 2026'))
    await step('the task "Reconcile stock variance" starts on 10 November 2026', () =>
      dated(tasker, 'Reconcile stock variance', { start_date: day('10 November 2026') }))
    await step('the task is marked Scheduled', () => rowMarked(tasker, 'scheduled', /^Scheduled\b/))
  })

  scenario('A finished task is never late', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('today is 6 November 2026', () => todayIs(tasker, '6 November 2026'))
    await step('the task "Reconcile stock variance" is due on 4 November 2026', () =>
      dated(tasker, 'Reconcile stock variance', { due_date: day('4 November 2026') }))
    await step('the user marks it done', async () => {
      const task = tasker.current!
      const page = await tasker.as('the user')
      await page.openProject(tasker.projectOf(task))
      await page.row(String(task.task_title))
      await page.session.check(page.doneBox(String(task.task_title)))
      await waitFor(async () => expect((await tasker.fresh()).is_done).toBe(true))
    })
    await step('the task is not marked Overdue', async () => {
      const task = tasker.current!
      const page = await tasker.viewerPage()
      await page.openProject(tasker.projectOf(task))
      await page.row(String(task.task_title))
      await page.session.assertChecked(page.doneBox(String(task.task_title)))
      expect((await page.dueMark(String(task.task_title)))?.mark).not.toBe('overdue')
    })
  })

  scenario('Only the late work', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    let page: TaskerPage
    await step('today is 6 November 2026', () => todayIs(tasker, '6 November 2026'))
    await step('the task "Reconcile stock variance" is overdue', () =>
      dated(tasker, 'Reconcile stock variance', { due_date: tasker.daysFromToday(-2) }))
    await step('the task "Diwali display change-over" is scheduled', () =>
      dated(tasker, 'Diwali display change-over', { start_date: tasker.daysFromToday(4) }))
    await step('the user narrows the list to overdue tasks', async () => {
      page = await tasker.as('the user')
      await page.openProject(tasker.projectOf())
      await page.expectListed('Diwali display change-over')
      await page.narrow('Due', 'Overdue')
    })
    await step('the list shows "Reconcile stock variance"', () => page.expectListed('Reconcile stock variance'))
    await step('the list does not show "Diwali display change-over"', () => page.expectNotListed('Diwali display change-over'))
  })
})
