// budgets-access's fenced scenarios (#1380, #1070): each test is one scenario of the spec, step by step,
// against the installed Budgets app.
import { describe, expect } from 'vitest'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { expectRefused } from '../fixtures'
import { appCatalog } from '../../src/runtime-packages'
import { budgetsClient } from '../jeyarama-budgets-world'
import { start, type Row, type World } from './budgets-scenes'

const scenario = scenarioFor(test, 'budgets-access')

describe('budgets-access', () => {

  scenario('An administrator is not a Budgets person', async ({ createUser }, step) => {
    let w!: World
    let asked!: Promise<unknown>
    await step('the FY27 Original budget holds a figure for Hilltop', async () => { w = await start(createUser) })
    await step("an administrator who is not a Budgets person asks for the budget's figures", () => { asked = budgetsClient(w.admin).get('/api/table/budgets.pl_budget?fields=["amount"]'); asked.catch(() => undefined) })
    await step('they are refused', () => expectRefused(asked, 403))
    await step('Budgets is not among the apps they can open', async () => expect((await appCatalog(w.admin.user!)).map(app => app.name)).not.toContain('budgets'))
  })

  scenario('A viewer cannot approve a budget', async ({ createUser }, step) => {
    let w!: World
    let seen: Row[] = []
    let tried!: Promise<unknown>
    await step('the FY27 Original budget is a draft', async () => { w = await start(createUser); expect((await w.get('budget_version', w.made.version.row_id)).version_state).toBe('Draft') })
    await step('a Budget Viewer reads its figures', async () => { seen = (await w.viewer.get<{ data: Row[] }>('/api/table/budgets.pl_budget?fields=["plant","amount"]')).data })
    await step('they see the figure for Hilltop', () => expect(seen.map(row => [row.plant, Number(row.amount)])).toEqual([['9003', 1840000]]))
    await step('the Budget Viewer tries to approve the budget', () => { tried = w.act(w.viewer, 'approve_version', { version: w.made.version.row_id }); tried.catch(() => undefined) })
    await step('they are refused', () => expectRefused(tried, 403))
    await step('the budget is still a draft', async () => expect((await w.get('budget_version', w.made.version.row_id)).version_state).toBe('Draft'))
  })
})
