// glossary's Help-menu scenarios (the owner, 18-Nov-2026): an app's Help menu
// opens that app's glossary, and the Admin, which has none, offers none. Each
// test is one fenced scenario of the glossary change's spec, step by step. The
// Tasker fixture stands in for an app whose pages open for everyone.
import { resolve } from 'node:path'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { discoverPackages } from 'server/src/runtime-packages'
import { test, expect, renderApp } from '../pg-test'

const scenario = scenarioFor(test, 'glossary')
const tasker = resolve(process.cwd(), '../..', 'test-apps/fixtures/tasker-v1')

async function openHelp() {
  await userEvent.click(await screen.findByTestId('help-button', {}, { timeout: 8000 }))
}

describe('Help opens the app\'s glossary', () => {
  scenario('Help offers the app\'s glossary', async ({ admin, createUser }, step) => {
    await step('the Tasker app is open for a person who can use it', async () => {
      expect(await discoverPackages([tasker])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      await renderApp('/featherbase/glossary/tasker', await createUser({ email: 'staff@example.test' }))
    })
    await step('the person opens Help', openHelp)
    await step('Help offers Tasker\'s glossary', async () => {
      const item = await screen.findByTestId('glossary-item')
      expect(within(item.parentElement!).getByRole('menuitem', { name: 'Glossary' })).toHaveAttribute('href', '/featherbase/glossary/tasker')
    })
  })

  scenario('The Admin\'s Help offers no glossary', async ({ admin }, step) => {
    await step('a System Manager has the Admin open', async () => { await renderApp('/featherbase/admin/all-tables', admin) })
    await step('the manager opens Help', openHelp)
    await step('Help offers no glossary', async () => {
      await screen.findByTestId('keyboard-shortcuts-item')
      expect(screen.queryByTestId('glossary-item')).not.toBeInTheDocument()
    })
  })
})
