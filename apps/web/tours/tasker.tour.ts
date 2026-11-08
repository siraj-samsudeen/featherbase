// Tasker's tour (#1070): a team starts running its work in Tasker. The
// platform features Tasker relies on (installing an app, giving people its
// role) are told inside Tasker's own story.
//
// Part 1 is the simple path: install, let the team in, capture, plan, assign.
// Part 2 layers on how the team talks about and splits up its work.
import type { Page } from '@playwright/test'
import { ensurePerson, expect, tour, type Person } from './tour'

const PRIYA: Person = { user: 'priya@stores.example', password: 'tour-priya-pw', fullName: 'Priya Raman' }
const MEENA: Person = { user: 'meena@stores.example', password: 'tour-meena-pw', fullName: 'Meena Iyer' }
const ARUN: Person = { user: 'arun@stores.example', password: 'tour-arun-pw', fullName: 'Arun Kumar' }
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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
  }, 'An app is installed by choice, and gives nobody access by itself.')
})
