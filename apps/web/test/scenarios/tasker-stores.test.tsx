// tasker-stores's scenarios (#1070): each test is one fenced scenario of
// openspec/specs/tasker-stores/spec.md, step by step, with Tasker's page
// rendered in jsdom against the real in-process server.
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect } from '../pg-test'
import { TaskerWorld, type TaskerPage, realTime } from './tasker'

const scenario = scenarioFor(test, 'tasker-stores')
afterEach(realTime)

async function openStores(page: TaskerPage) {
  await page.sidebarView(/^Stores/)
  return screen.findByRole('table', { name: 'Work by store' })
}

async function storeRow(name: string) {
  const table = await screen.findByRole('table', { name: 'Work by store' })
  const header = await within(table).findByRole('rowheader', { name })
  return header.closest('tr') as HTMLElement
}

/** A store's row: { total, ongoing, completed, overdue, scheduled }. */
async function storeCounts(name: string) {
  const row = await storeRow(name)
  const counts: Record<string, number> = {}
  for (const bucket of ['total', 'ongoing', 'completed', 'overdue', 'scheduled'])
    counts[bucket] = Number(row.querySelector(`td[data-bucket="${bucket}"]`)!.textContent!.trim())
  return counts
}

const storeChoice = (detail: HTMLElement) => within(detail).getByRole('combobox', { name: 'Task store' }) as HTMLSelectElement
const optionTexts = (select: HTMLSelectElement) => [...select.options].map(o => o.textContent)

describe('tasker-stores', () => {
  scenario('A new store', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('the store list has no "Keelkattalai Store"', async () => {
      expect(await tasker.storesNamed('Keelkattalai Store')).toEqual([])
    })
    await step('a member adds "Keelkattalai Store" as a store', async () => {
      const page = await tasker.as('a member')
      await openStores(page)
      await page.session
        .fillIn('New store', 'Keelkattalai Store')
        .step('store type: Store', ({ user }) => user.selectOptions(screen.getByRole('combobox', { name: 'Store type' }), 'Store'))
        .clickButton('Add store')
      await storeRow('Keelkattalai Store')
    })
    await step('every member can choose "Keelkattalai Store" for a task', async () => {
      for (const [who, title] of [['a member', 'Check the shelf labels'], ['another member', 'Count the trolleys']] as const) {
        const task = await tasker.task(title, { project: null }, await tasker.id(who))
        const page = await tasker.as(who)
        const detail = await page.openTask(task.row_id, title)
        await waitFor(() => expect(optionTexts(storeChoice(detail))).toContain('Keelkattalai Store'))
      }
    })
  })

  scenario('A task in a store', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('the user has a task "Reconcile stock variance"', async () => {
      await tasker.member('the user')
      await tasker.task('Reconcile stock variance')
    })
    await step('the user chooses "Keelkattalai Store" for it', async () => {
      const store = await tasker.store('Keelkattalai Store')
      const task = tasker.current!
      const page = await tasker.as('the user')
      const detail = await page.openTask(task.row_id, String(task.task_title))
      await within(storeChoice(detail)).findByRole('option', { name: 'Keelkattalai Store' })
      await page.user.selectOptions(storeChoice(detail), 'Keelkattalai Store')
      await waitFor(async () => expect((await tasker.fresh()).store).toBe(store.row_id))
    })
    await step('the task shows "Keelkattalai Store"', async () => {
      const page = await tasker.viewerPage()
      await page.openProject(tasker.projectOf())
      await page.expectRowShows(String(tasker.current!.task_title), 'Keelkattalai Store')
    })
  })

  scenario('A subtask follows its parent', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('the task "Reconcile stock variance" belongs to "Keelkattalai Store"', async () => {
      await tasker.member('the user')
      const store = await tasker.store('Keelkattalai Store')
      await tasker.task('Reconcile stock variance', { store: store.row_id })
    })
    const parent = tasker.current!
    await step('the user adds the subtask "Count the cold room"', async () => {
      const page = await tasker.as('the user')
      const detail = await page.openTask(parent.row_id, String(parent.task_title))
      const subtasks = within(detail).getByRole('region', { name: 'Subtasks' })
      await page.session.within('[aria-label="Subtasks"]', (region) => region
        .fillIn('New subtask', 'Count the cold room')
        .clickButton('Add subtask'))
      await within(subtasks).findByRole('button', { name: 'Count the cold room' })
    })
    await step('the subtask shows "Keelkattalai Store"', async () => {
      const page = await tasker.viewerPage()
      const detail = await page.openTask(parent.row_id, String(parent.task_title))
      await page.session.within('[aria-label="Subtasks"]', (region) => region.clickButton('Count the cold room'))
      const sub = page.detail()
      await within(sub).findByRole('heading', { name: 'Count the cold room' })
      await waitFor(() => expect(storeChoice(page.detail()).selectedOptions[0]?.textContent).toBe('Keelkattalai Store'))
    })
  })

  scenario("A store's counts", async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('today is 6 November 2026', () => tasker.setClock('2026-11-06T12:00:00Z'))
    await step('"Keelkattalai Store" has one done task, one overdue task, one scheduled task and two other open tasks', async () => {
      await tasker.member('the user')
      const store = (await tasker.store('Keelkattalai Store')).row_id
      await tasker.task('Close the cash counter', { store, task_state: 'Done' })
      await tasker.task('Reconcile stock variance', { store, due_date: tasker.daysFromToday(-2) })
      await tasker.task('Diwali display change-over', { store, start_date: tasker.daysFromToday(4) })
      await tasker.task('Refill the billing rolls', { store })
      await tasker.task('Check the fire exits', { store })
    })
    await step('it has one cancelled task', async () => {
      const store = (await tasker.store('Keelkattalai Store')).row_id
      await tasker.task('Dropped supplier visit', { store })
      const cancelled = await tasker.change('Dropped supplier visit', { task_state: 'Cancelled', change_reason: 'Supplier moved the visit online' })
      expect(cancelled.task_state).toBe('Cancelled')
    })
    await step('its row shows Total 5, Completed 1, Overdue 1, Scheduled 1 and Ongoing 2', async () => {
      const page = await tasker.as('the user')
      await openStores(page)
      await waitFor(async () => expect(await storeCounts('Keelkattalai Store')).toEqual({ total: 5, completed: 1, overdue: 1, scheduled: 1, ongoing: 2 }))
    })
  })

  scenario("Someone else's private task is not counted", async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('another member has a private task in "Keelkattalai Store"', async () => {
      await tasker.member('the user')
      const store = (await tasker.store('Keelkattalai Store')).row_id
      const task = await tasker.task('Recount the damaged stock', { project: null, store }, await tasker.id('another member'))
      expect(task.shared).toBe(false)
    })
    await step('the user\'s "Keelkattalai Store" row does not count it', async () => {
      // The task is counted for the member whose task it is …
      const theirs = await tasker.as('another member')
      await openStores(theirs)
      await waitFor(async () => expect((await storeCounts('Keelkattalai Store')).total).toBe(1))
      // … and not for the user.
      const page = await tasker.as('the user')
      await openStores(page)
      // Wait for the user's own tasks to have arrived: a row with nothing to count shows 0 either way.
      await screen.findByRole('rowheader', { name: 'Keelkattalai Store' })
      await waitFor(async () => expect((await storeCounts('Keelkattalai Store')).total).toBe(0))
    })
  })

  scenario('The late tasks in one store', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    let drill: HTMLElement
    const drilled = () => [...drill.querySelectorAll('.tasker-task-row')].map(row => ({
      title: row.querySelector('.tasker-task-copy > a')!.textContent!.trim(),
      store: row.querySelector('.tasker-task-copy .tasker-store-chip')?.textContent?.trim() ?? '',
    }))
    await step('"Keelkattalai Store" has the overdue task "Reconcile stock variance"', async () => {
      await tasker.member('the user')
      const store = (await tasker.store('Keelkattalai Store')).row_id
      // Late work in another store too, so the count has something to leave out.
      const elsewhere = (await tasker.store('Avadi Store')).row_id
      await tasker.task('Count the cold room', { store: elsewhere, due_date: tasker.daysFromToday(-3) })
      await tasker.task('Reconcile stock variance', { store, due_date: tasker.daysFromToday(-3) })
    })
    await step('the user opens its Overdue count', async () => {
      const page = await tasker.as('the user')
      await openStores(page)
      const row = await storeRow('Keelkattalai Store')
      await page.user.click(await within(row).findByRole('button', { name: /^Keelkattalai Store: \d+ overdue tasks?$/ }))
      drill = await screen.findByRole('region', { name: 'Keelkattalai Store · Overdue' })
    })
    await step('the user sees "Reconcile stock variance"', () =>
      waitFor(() => expect(drilled().map(t => t.title)).toContain('Reconcile stock variance')))
    await step('no task from another store', () => {
      expect(drilled().length).toBeGreaterThan(0)
      for (const task of drilled()) expect(task.store, `${task.title} is from ${task.store}`).toBe('Keelkattalai Store')
    })
  })

  scenario('Only one store\'s tasks', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    let page: TaskerPage
    const belongs = async (title: string, name: string) => {
      await tasker.member('the user')
      const store = await tasker.store(name)
      await tasker.task(title, { store: store.row_id })
    }
    await step('the task "Reconcile stock variance" belongs to "Keelkattalai Store"', () => belongs('Reconcile stock variance', 'Keelkattalai Store'))
    await step('the task "Diwali display change-over" belongs to "Avadi Store"', () => belongs('Diwali display change-over', 'Avadi Store'))
    await step('the user narrows the list to "Keelkattalai Store"', async () => {
      page = await tasker.as('the user')
      await page.openProject(tasker.projectOf())
      await page.expectListed('Diwali display change-over')
      await page.narrow('Store', 'Keelkattalai Store')
    })
    await step('the list shows "Reconcile stock variance"', () => page.expectListed('Reconcile stock variance'))
    await step('the list does not show "Diwali display change-over"', () => page.expectNotListed('Diwali display change-over'))
  })
})
