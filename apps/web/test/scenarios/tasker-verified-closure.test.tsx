// tasker-verified-closure's scenarios (#1070): each test is one fenced
// scenario of openspec/specs/tasker-verified-closure/spec.md, step by step,
// with Tasker's page rendered in jsdom against the real in-process server.
// Where the page doesn't offer a refused change at all (a disabled Done box,
// a reason form that can't be confirmed empty, an assignee left out of the
// verifier choices), the step tries it on the page and also sends the same
// change to the server as that member, so the refusal is the app's, not only
// the screen's.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect } from '../pg-test'
import { TaskerWorld, type TaskerPage, realTime } from './tasker'

const scenario = scenarioFor(test, 'tasker-verified-closure')
afterEach(realTime)

const TITLE = 'Fix the billing counter lights'
const SUBMITTED = 'Submitted for verification'
type Answer = Awaited<ReturnType<TaskerWorld['attempt']>>

/** A shared task in a project, assigned and verified as the scenario says. */
async function sharedTask(tasker: TaskerWorld, title: string, { assignee, verifier, ...values }: { assignee?: string; verifier?: string; [field: string]: unknown } = {}) {
  return tasker.task(title, {
    ...(assignee ? { assigned_to: await tasker.id(assignee) } : {}),
    ...(verifier ? { verifier: await tasker.id(verifier) } : {}),
    ...values,
  })
}

/** The current task, opened in its details by this member. */
async function openedBy(tasker: TaskerWorld, who: string) {
  const task = tasker.current!
  const page = await tasker.as(who)
  const detail = await page.openTask(task.row_id, String(task.task_title))
  return { page, detail }
}

const verification = (detail: HTMLElement) => within(detail).getByRole('region', { name: 'Verification' })

/** Submits the open task for verification with this note ('' for none). */
async function submitForVerification(page: TaskerPage, detail: HTMLElement, note: string) {
  const submit = await within(verification(detail)).findByRole('button', { name: 'Submit for verification' })
  await waitFor(() => expect(submit).toBeEnabled())
  await page.user.click(submit)
  if (note) await page.user.type(within(verification(detail)).getByRole('textbox', { name: 'What was done' }), note)
  await page.user.click(within(verification(detail)).getByRole('button', { name: 'Submit' }))
}

/** The reason form the details ask for before a change, and whether its action can be taken yet. */
async function reasonAsked(detail: HTMLElement, label: string, action: string) {
  const field = await within(detail).findByRole('textbox', { name: label }) as HTMLInputElement
  return { asked: label, value: field.value, canConfirm: !(within(detail).getByRole('button', { name: action }) as HTMLButtonElement).disabled }
}

/** The task's row in its project, seen by whoever last looked. */
async function rowShows(tasker: TaskerWorld, text: string) {
  const page = await tasker.viewerPage()
  await page.openProject(tasker.projectOf())
  await page.expectRowShows(String(tasker.current!.task_title), text)
  return page
}

async function chooseDueDate(detail: HTMLElement, value: string) {
  const field = within(detail).getByLabelText('Due date')
  await waitFor(() => expect(field).toBeEnabled())
  fireEvent.change(field, { target: { value } })
}

describe('tasker-verified-closure', () => {
  scenario("A project's default verifier", async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('the project "Diwali readiness" has Meena as its default verifier', async () => {
      await tasker.project('Diwali readiness', { default_verifier: await tasker.id('Meena') })
    })
    await step('Ravi adds the task "Fix the billing counter lights" to it', async () => {
      const page = await tasker.as('Ravi')
      await page.openProject('Diwali readiness')
      await page.user.type(screen.getByLabelText('Add task to project'), `${TITLE}{Enter}`)
      await page.row(TITLE)
      await waitFor(() => tasker.findTask(TITLE))
    })
    await step("the task's verifier is Meena", async () => {
      const { detail } = await openedBy(tasker, tasker.viewer)
      const choice = within(detail).getByRole('combobox', { name: 'Task verifier' }) as HTMLSelectElement
      await waitFor(() => expect(choice.selectedOptions[0]?.textContent).toBe('Meena'))
      expect((await tasker.fresh()).verifier).toBe(await tasker.id('Meena'))
    })
  })

  scenario('The assignee cannot verify', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    let offered: string[] = []
    let answer: Answer
    await step('the task "Fix the billing counter lights" is assigned to Ravi', () => sharedTask(tasker, TITLE, { assignee: 'Ravi' }))
    await step('someone makes Ravi its verifier', async () => {
      const ravi = await tasker.id('Ravi')
      const { detail } = await openedBy(tasker, 'a member')
      const choice = within(detail).getByRole('combobox', { name: 'Task verifier' }) as HTMLSelectElement
      // The members' names have arrived once someone other than the assignee is offered.
      await waitFor(() => expect([...choice.options].some(o => o.textContent === 'Bala')).toBe(true))
      offered = [...choice.options].map(o => o.value)
      answer = await tasker.attempt('tasker.task', { row_id: tasker.current!.row_id, verifier: ravi }, 'a member')
    })
    await step("the change is refused, saying the verifier can't be the person doing the task", async () => {
      const assignee = String((await tasker.fresh()).assigned_to)
      expect(offered, 'the assignee is offered as the verifier').not.toContain(assignee)
      expect(answer.ok, 'the server accepted the assignee as verifier').toBe(false)
      expect(answer.message).toMatch(/verifier can[’']t be the person doing the task/)
      expect((await tasker.fresh()).verifier).toBeNull()
    })
  })

  scenario('A new assignment', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('Meena assigns "Fix the billing counter lights" to Ravi', async () => {
      await sharedTask(tasker, TITLE)
      const ravi = await tasker.id('Ravi')
      const { page, detail } = await openedBy(tasker, 'Meena')
      const responsibility = within(detail).getByRole('combobox', { name: 'Task responsibility' })
      await within(responsibility).findByRole('option', { name: 'Ravi' })
      await page.user.selectOptions(responsibility, ravi)
      await waitFor(async () => expect((await tasker.fresh()).assigned_to).toBe(ravi))
    })
    await step('the task shows "Not acknowledged by Ravi"', () => rowShows(tasker, 'Not acknowledged by Ravi'))
    await step('Ravi acknowledges it', async () => {
      const { page, detail } = await openedBy(tasker, 'Ravi')
      await page.user.click(await within(verification(detail)).findByRole('button', { name: 'Acknowledge' }))
      await waitFor(() => expect(within(verification(detail)).queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument())
    })
    await step('the task no longer shows it is not acknowledged', async () => {
      const page = await tasker.viewerPage()
      await page.openProject(tasker.projectOf())
      await page.expectRowLacks(TITLE, 'Not acknowledged by')
    })
  })

  scenario('Submit and accept', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    let doneBox: { enabled: boolean; says: string }
    let answer: Answer
    await step('"Fix the billing counter lights" is assigned to Ravi and Meena verifies it', () =>
      sharedTask(tasker, TITLE, { assignee: 'Ravi', verifier: 'Meena' }))
    await step('Ravi marks it Done', async () => {
      const page = await tasker.as('Ravi')
      await page.openProject(tasker.projectOf())
      await page.row(TITLE)
      const box = page.doneBox(TITLE)
      doneBox = { enabled: !box.disabled, says: box.title }
      if (doneBox.enabled) await page.user.click(box)
      answer = await tasker.attempt('tasker.task', { row_id: tasker.current!.row_id, is_done: true }, 'Ravi')
    })
    await step('it is refused, saying to submit it for verification', async () => {
      expect(doneBox.enabled, 'the Done box could be ticked').toBe(false)
      expect(doneBox.says).toMatch(/Submit it from the task details/)
      expect(answer.ok, 'the server marked it Done').toBe(false)
      expect(answer.message).toMatch(/Submit this task for verification/)
      expect((await tasker.fresh()).task_state).not.toBe('Done')
    })
    await step('Ravi submits it with the note "Replaced both tube lights"', async () => {
      const { page, detail } = await openedBy(tasker, 'Ravi')
      await submitForVerification(page, detail, 'Replaced both tube lights')
      await waitFor(() => expect(verification(detail).querySelector('.tasker-evidence')).not.toBeNull())
      await waitFor(async () => expect((await tasker.fresh()).task_state).toBe(SUBMITTED))
    })
    await step('it shows "Waiting for Meena to verify"', () => rowShows(tasker, 'Waiting for Meena to verify'))
    await step('it is on Meena\'s "To verify" page', async () => {
      const page = await tasker.as('Meena')
      await page.sidebarView(/^To verify/)
      await within(await screen.findByRole('region', { name: 'To verify' })).findByRole('link', { name: TITLE })
    })
    await step('Meena accepts it', async () => {
      const page = await tasker.as('Meena')
      await page.sidebarView(/^To verify/)
      await page.user.click(await within(await screen.findByRole('region', { name: 'To verify' })).findByRole('link', { name: TITLE }))
      const detail = await screen.findByRole('region', { name: 'Task detail content' })
      await within(detail).findByRole('heading', { name: TITLE })
      await within(detail).findByRole('region', { name: 'Verification' })
      await page.user.click(await within(verification(detail)).findByRole('button', { name: 'Accept and close' }))
      await waitFor(() => expect(within(verification(detail)).queryByRole('button', { name: 'Accept and close' })).not.toBeInTheDocument())
    })
    await step('it is Done, verified by Meena', async () => {
      const page = await rowShows(tasker, 'Verified by Meena')
      expect(page.rowState(TITLE)).toBe('Done')
      expect(await tasker.fresh()).toMatchObject({ task_state: 'Done', verified_by: await tasker.id('Meena') })
    })
  })

  scenario('A submission needs a note', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    let detail: HTMLElement
    await step('"Fix the billing counter lights" has a verifier', () => sharedTask(tasker, TITLE, { assignee: 'Ravi', verifier: 'Meena' }))
    await step('Ravi submits it without a note', async () => {
      const opened = await openedBy(tasker, 'Ravi')
      detail = opened.detail
      await submitForVerification(opened.page, detail, '')
    })
    await step('it is refused, saying to add a note on what was done', async () => {
      expect(await within(detail).findByRole('alert')).toHaveTextContent(/Add a note on what was done/)
      expect((await tasker.fresh()).task_state).not.toBe(SUBMITTED)
    })
  })

  scenario('Return with a reason', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('Ravi submitted "Fix the billing counter lights" for Meena to verify', async () => {
      await sharedTask(tasker, TITLE, { assignee: 'Ravi', verifier: 'Meena' })
      const submitted = await tasker.change(TITLE, { task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' }, await tasker.id('Ravi'))
      expect(submitted.task_state).toBe(SUBMITTED)
    })
    await step('Meena returns it with the reason "Left counter still flickers"', async () => {
      const page = await tasker.as('Meena')
      await page.sidebarView(/^To verify/)
      await page.user.click(await within(await screen.findByRole('region', { name: 'To verify' })).findByRole('link', { name: TITLE }))
      const detail = await screen.findByRole('region', { name: 'Task detail content' })
      await within(detail).findByRole('heading', { name: TITLE })
      await within(detail).findByRole('region', { name: 'Verification' })
      await page.user.click(await within(verification(detail)).findByRole('button', { name: 'Return' }))
      await page.user.type(within(detail).getByRole('textbox', { name: 'Reason for returning' }), 'Left counter still flickers')
      await page.user.click(within(detail).getByRole('button', { name: 'Return task' }))
      await waitFor(() => expect(within(detail).queryByRole('textbox', { name: 'Reason for returning' })).not.toBeInTheDocument())
    })
    await step('it is In progress and shows "Returned: Left counter still flickers"', async () => {
      const page = await rowShows(tasker, 'Returned: Left counter still flickers')
      expect(page.rowState(TITLE)).toBe('In progress')
    })
    await step('it has been returned once', async () => expect((await tasker.fresh()).return_count).toBe(1))
  })

  scenario('An extension', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    const DUE_REASON = ['Reason for moving the due date', 'Move due date'] as const
    let reasonForm: Awaited<ReturnType<typeof reasonAsked>>
    let answer: Answer
    let dueBefore: unknown
    await step('"Fix the billing counter lights" is due on 7 November 2026', () =>
      sharedTask(tasker, TITLE, { assignee: 'Ravi', due_date: '2026-11-07' }))
    await step('Ravi moves it to 10 November 2026 without a reason', async () => {
      const { detail } = await openedBy(tasker, 'Ravi')
      await chooseDueDate(detail, '2026-11-10')
      reasonForm = await reasonAsked(detail, ...DUE_REASON)
      answer = await tasker.attempt('tasker.task', { row_id: tasker.current!.row_id, due_date: '2026-11-10' }, 'Ravi')
      dueBefore = tasker.current!.due_date
    })
    await step('it is refused, saying to give a reason', async () => {
      expect(reasonForm).toEqual({ asked: DUE_REASON[0], value: '', canConfirm: false })
      expect(answer.ok, 'the server moved the due date without a reason').toBe(false)
      expect(answer.message).toMatch(/Give a reason for moving the due date/)
      expect((await tasker.fresh()).due_date).toBe(dueBefore)
    })
    await step('Ravi moves it to 10 November 2026 because "Electrician on leave"', async () => {
      const { page, detail } = await openedBy(tasker, 'Ravi')
      await chooseDueDate(detail, '2026-11-10')
      await page.user.type(await within(detail).findByRole('textbox', { name: DUE_REASON[0] }), 'Electrician on leave')
      await page.user.click(within(detail).getByRole('button', { name: DUE_REASON[1] }))
      await waitFor(() => expect(within(detail).queryByRole('textbox', { name: DUE_REASON[0] })).not.toBeInTheDocument())
      await waitFor(async () => expect((await tasker.fresh()).extension_count).toBe(1))
    })
    await step('the task shows "was 07-Nov-2026 · extended 1 time"', () => rowShows(tasker, 'was 07-Nov-2026 · extended 1 time'))
  })

  scenario('Cancel without a reason', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    const CANCEL_REASON = ['Reason for cancelling', 'Cancel task'] as const
    let reasonForm: Awaited<ReturnType<typeof reasonAsked>>
    let answer: Answer
    await step('the task "Dropped supplier visit"', () => sharedTask(tasker, 'Dropped supplier visit'))
    await step('someone cancels it without a reason', async () => {
      const { page, detail } = await openedBy(tasker, 'a member')
      await page.user.selectOptions(within(detail).getByRole('combobox', { name: 'Task state' }), 'Cancelled')
      reasonForm = await reasonAsked(detail, ...CANCEL_REASON)
      answer = await tasker.attempt('tasker.task', { row_id: tasker.current!.row_id, task_state: 'Cancelled' }, 'a member')
    })
    await step('it is refused, saying to give a reason for cancelling', async () => {
      expect(reasonForm).toEqual({ asked: CANCEL_REASON[0], value: '', canConfirm: false })
      expect(answer.ok, 'the server cancelled it without a reason').toBe(false)
      expect(answer.message).toMatch(/Give a reason for cancelling/)
      expect((await tasker.fresh()).task_state).not.toBe('Cancelled')
    })
  })
})
