// Tasker's tour (#1070): a team starts running its work in Tasker. The
// platform features Tasker relies on (installing an app, giving people its
// role) are told inside Tasker's own story.
//
// Part 1 is the simple path: install, let the team in, capture, plan, assign.
// Part 2 layers on how the team talks about and splits up its work.
import type { Page } from '@playwright/test'
import { ensurePerson, expect, tour, type Person } from './tour'

/** A System Manager gives a person a role on their Person page. */
async function grantRole(page: Page, person: Person, role: string): Promise<void> {
  await page.getByRole('link', { name: 'System', exact: true }).first().click()
  await page.getByRole('link', { name: /^(Person|People)$/ }).first().click()
  await page.getByTestId('list-view').getByRole('link', { name: new RegExp(person.fullName) }).first().click()
  await page.getByTestId('add-row-roles').click()
  await page.getByTestId('table-roles').locator('[data-childfield="role"]').last().fill(role.split(' ')[0]!)
  await page.getByTestId('link-options-role').getByTestId('link-option').filter({ hasText: role }).click()
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
}

const PRIYA: Person = { user: 'priya@stores.example', password: 'tour-priya-pw', fullName: 'Priya Raman' }
const MEENA: Person = { user: 'meena@stores.example', password: 'tour-meena-pw', fullName: 'Meena Iyer' }
const ARUN: Person = { user: 'arun@stores.example', password: 'tour-arun-pw', fullName: 'Arun Kumar' }

tour('Tasker: a team runs its work', async ({ story, request }) => {
  await ensurePerson(request, { ...PRIYA, roles: ['System Manager'] })
  await ensurePerson(request, { ...MEENA, roles: [] })
  await ensurePerson(request, { ...ARUN, roles: [] })
  const s = await story(PRIYA)
  const page = () => s.page

  await s.part('Part 1: the simple path', 'Install Tasker, let the team in, and start working.')

  await s.chapter('Install Tasker', 60_000, async () => {
    await s.step('Priya finds Tasker among the apps this instance offers', async () => {
      await page().getByRole('link', { name: 'Apps', exact: true }).first().click()
      await expect(page().getByTestId('apps-page')).toBeVisible()
      await page().getByRole('navigation', { name: 'Available apps' }).getByRole('button', { name: /Tasker/ }).click()
      await expect(page().getByLabel('Tasker details')).toContainText('Not installed')
    })
    await s.step('One click installs it', async () => {
      const details = page().getByLabel('Tasker details')
      await details.getByRole('button', { name: /^(Prepare and install|Install app)$/ }).click()
      await expect(details).toContainText('Installed on this instance', { timeout: 45_000 })
    })
    await s.step('Import Data still opens for her, with an app she cannot read yet installed', async () => {
      // #1007: the wizard failed outright for a System Manager without Tasker's role;
      // #1076: and, until the page was reloaded, for anyone who had just installed it.
      await page().getByRole('link', { name: 'Import Data' }).first().click()
      await expect(page().getByTestId('iw-dropzone')).toBeVisible()
      await page().getByTestId('iw-file-input').setInputFiles({ name: 'contacts.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Phone\nRavi,98400 00001\n') })
      await expect(page().getByTestId('iw-new-grid-0').or(page().getByTestId('iw-overview')).first()).toBeVisible()
      await page().getByTestId('iw-target-0').click()
      await expect(page().getByTestId('iw-target-menu-0')).toBeVisible()
      await expect(page().getByTestId(/^iw-target-opt-0-tasker\./)).toHaveCount(0)
      await page().keyboard.press('Escape')
    })
    await s.step("After a reload too: Tasker's Tables are hers to import into only once she holds its role", async () => {
      // #1007: a System Manager without the app's role was refused the whole wizard.
      await page().getByRole('button', { name: 'Start over' }).click().catch(() => undefined)
      await page().reload()
      await expect(page().getByTestId('iw-dropzone')).toBeVisible()
      await page().getByTestId('iw-file-input').setInputFiles({ name: 'contacts.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Phone\nRavi,98400 00001\n') })
      await page().getByTestId('iw-target-0').click()
      await expect(page().getByTestId('iw-target-menu-0')).toBeVisible()
      await expect(page().getByTestId(/^iw-target-opt-0-tasker\./)).toHaveCount(0)
      await page().keyboard.press('Escape')
    })
  }, 'An app is installed by choice, and gives nobody access by itself.')

  for (const person of [MEENA, ARUN]) {
    await s.chapter(`Let ${person.fullName.split(' ')[0]} in`, 30_000, async () => {
      await s.step(`${person.fullName} gets Tasker's role, Tasker Member`, async () => {
        await grantRole(page(), person, 'Tasker Member')
      })
    }, 'Installing gave nobody access; a role does.')
  }

  // ------------------------------------------------------------ the team
  const meena = await s.as(MEENA)
  await s.chapter('Meena opens Tasker', 30_000, async () => {
    await s.step('She signs in and lands in Tasker, the only app she has', async () => {
      await meena.goto('/tasker/')
      await expect(meena.getByTestId('task-management-page')).toBeVisible()
    })
    await s.step('A task is written down the moment it comes to mind', async () => {
      await meena.getByRole('link', { name: 'Inbox' }).or(meena.getByRole('button', { name: 'Inbox' })).first().click()
      await meena.getByRole('textbox', { name: 'Quick capture' }).fill('Order shelf labels')
      await meena.keyboard.press('Enter')
      await expect(meena.locator('section[aria-labelledby=inbox-heading] article').filter({ hasText: 'Order shelf labels' })).toBeVisible()
    })
  })

  const PROJECT = 'Diwali display'
  let arun: Page = meena
  await s.chapter('Start a project', 30_000, async () => {
    await s.step(`Meena starts "${PROJECT}" with just a name`, async () => {
      await meena.getByRole('button', { name: 'Projects', exact: true }).first().click()
      await meena.getByRole('textbox', { name: 'New project' }).fill(PROJECT)
      await meena.keyboard.press('Enter')
      await expect(meena.getByRole('heading', { name: PROJECT })).toBeVisible()
    })
    await s.step('Tasks go straight in, one per line', async () => {
      for (const title of ['Hang the lights', 'Arrange the silk sarees']) {
        await meena.getByRole('textbox', { name: 'Add task to project' }).fill(title)
        await meena.keyboard.press('Enter')
        await expect(meena.getByRole('link', { name: title })).toBeVisible()
      }
    })
    await s.step('The Inbox task joins the project, and the team can now see it', async () => {
      await meena.getByRole('link', { name: 'Inbox' }).or(meena.getByRole('button', { name: 'Inbox' })).first().click()
      await meena.getByLabel('Destination for Order shelf labels').selectOption({ label: PROJECT })
      await expect(meena.locator('section[aria-labelledby=inbox-heading] article').filter({ hasText: 'Order shelf labels' })).toHaveCount(0)
    })
  }, 'A project is a named, shared group of tasks.')

  await s.chapter('Hand out the work', 30_000, async () => {
    await s.step('Meena makes Arun responsible for hanging the lights', async () => {
      await meena.getByRole('button', { name: PROJECT }).first().click()
      await meena.getByLabel('Assign Hang the lights').selectOption({ label: ARUN.fullName })
      await expect(meena.getByLabel('Assign Hang the lights')).toHaveValue(/.+/)
    })
    arun = await s.as(ARUN)
    await s.step('Arun signs in and finds it in My Work', async () => {
      await arun.goto('/tasker/')
      await expect(arun.getByTestId('task-management-page')).toBeVisible()
      await expect(arun.getByRole('link', { name: 'Hang the lights' })).toBeVisible()
    })
    await s.step('He starts on it', async () => {
      await arun.getByLabel('State for Hang the lights').selectOption({ label: 'In progress' })
      await expect(arun.getByLabel('State for Hang the lights')).toHaveValue(/progress/i)
    })
    s.show(meena)
    await s.step('Together shows who is doing what', async () => {
      await meena.getByRole('link', { name: 'Together' }).or(meena.getByRole('button', { name: 'Together' })).first().click()
      const together = meena.locator('section[aria-labelledby="together-heading"]').or(meena.locator('#together-heading').locator('xpath=../..')).first()
      await expect(together).toContainText(ARUN.fullName)
      await expect(together).toContainText('Hang the lights')
    })
  }, 'Each task says who is responsible and how far along it is.')

  // ---------------------------------------------------------------- Part 2

  await s.part('Part 2: working together', 'Questions, smaller pieces of work, and what to do first.')

  const details = (p: Page) => p.getByRole('complementary', { name: 'Task details' }).or(p.locator('aside[aria-label="Task details"]')).first()
  await s.chapter('Ask a question on the task', 30_000, async () => {
    await s.step('Meena opens the task and asks Arun which lights to use', async () => {
      await meena.getByRole('button', { name: PROJECT }).first().click()
      await meena.getByRole('link', { name: 'Hang the lights' }).click()
      const discussion = details(meena).locator('section[aria-label="Task discussion"]')
      await discussion.getByLabel('Message type').selectOption({ label: 'Question' })
      await discussion.getByLabel('Reply needed from').selectOption({ label: ARUN.fullName })
      await discussion.getByLabel('Your question').fill('Warm white or the coloured strings?')
      await discussion.getByRole('button', { name: 'Post question' }).click()
      await expect(discussion).toContainText('Warm white or the coloured strings?')
    })
    s.show(arun)
    await s.step('Arun sees it waiting on him, and answers', async () => {
      await arun.reload()
      const attention = arun.locator('[aria-label="Needs your attention"]')
      await expect(attention).toContainText('Hang the lights')
      await arun.getByRole('link', { name: 'Hang the lights' }).first().click()
      const discussion = details(arun).locator('section[aria-label="Task discussion"]')
      await discussion.getByLabel('Reply to Warm white or the coloured strings?').fill('Warm white, like last year.')
      await discussion.getByRole('button', { name: 'Reply', exact: true }).click()
      await expect(discussion).toContainText('Warm white, like last year.')
    })
    s.show(meena)
    await s.step('Meena marks the question answered', async () => {
      await meena.reload()
      const discussion = details(meena).locator('section[aria-label="Task discussion"]')
      await expect(discussion).toContainText('Warm white, like last year.')
      await discussion.getByRole('button', { name: 'Mark answered' }).first().click()
      await expect(discussion.getByRole('button', { name: 'Reopen question' }).first()).toBeVisible()
    })
  }, "A task keeps its updates, questions and replies together.")

  await s.chapter('Split the work into subtasks', 30_000, async () => {
    await s.step('Arranging the sarees becomes two smaller pieces', async () => {
      await meena.getByRole('button', { name: PROJECT }).first().click()
      await meena.getByRole('link', { name: 'Arrange the silk sarees' }).click()
      const subtasks = details(meena).locator('section[aria-label="Subtasks"]')
      for (const title of ['Steam the sarees', 'Fold them for the shelves']) {
        await subtasks.getByLabel('New subtask').fill(title)
        await subtasks.getByRole('button', { name: 'Add subtask' }).click()
        await expect(subtasks).toContainText(title)
      }
    })
  }, 'Responsibility, discussion and progress stay close to the overall task.')

  await s.chapter('Plan my day', 30_000, async () => {
    await s.step('Meena picks what she will do first into My Focus', async () => {
      await meena.getByRole('button', { name: PROJECT }).first().click()
      await meena.getByRole('button', { name: 'Add to My Focus: Order shelf labels' }).first().click()
      await meena.getByRole('link', { name: 'My Work' }).or(meena.getByRole('button', { name: 'My Work' })).first().click()
      await expect(meena.getByRole('heading', { name: 'My Focus' }).locator('xpath=..')).toContainText('Order shelf labels')
    })
  }, 'A private, ordered list of what each person does next.')
})

