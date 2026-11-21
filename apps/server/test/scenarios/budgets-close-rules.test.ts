// budgets-close-rules's fenced scenarios (#1380, #1070): each test is one scenario of the spec, step by step,
// against the installed Budgets app.
import { describe, expect } from 'vitest'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { statement } from '../../../../client-apps/jeyarama/budgets/src/plRules'
import { figures, start, type Line, type Row, type World } from './budgets-scenes'

const scenario = scenarioFor(test, 'budgets-close-rules')

describe('budgets-close-rules', () => {

  scenario('Store EBITDA follows a changed line', async ({ createUser }, step) => {
    let w!: World
    let cost!: Row
    const ebitda = async () => {
      const lines = (await w.rows('pl_line')).filter(line => ['scan_margin', 'manpower_cost', 'store_ebitda'].includes(String(line.line_key))) as unknown as Line[]
      const amounts = new Map((await figures(w, w.made.version.row_id)).filter(row => row.plant === '9003').map(row => [String(row.pl_line), Number(row.amount)]))
      return statement(lines, amounts).find(row => row.line.row_id === 'store_ebitda')!.amount
    }
    await step('a P&L of Scan Margin, Manpower Cost and Store EBITDA', async () => {
      w = await start(createUser)
      await w.save('pl_line', { line_key: 'scan_margin', line_name: 'Scan Margin', level: 'Published', line_order: 100, section: 'Margin', line_kind: 'Posted', sign: 'Income' })
      await w.save('pl_line', { line_key: 'store_ebitda', line_name: 'Store EBITDA', level: 'Published', line_order: 900, section: 'Below Store EBITDA', line_kind: 'Subtotal', sign: 'Income', subtotal_rule: 'Running Total' })
    })
    await step('Hilltop has a Scan Margin of 100 and a Manpower Cost of 30', async () => {
      await w.save('pl_budget', { budget_version: w.made.version.row_id, plant: '9003', budget_month: '2026-10-01', pl_line: 'scan_margin', amount: 100 })
      cost = await w.save('pl_budget', { row_id: w.made.budget.row_id, updated_at: w.made.budget.updated_at, amount: 30 })
    })
    await step("Hilltop's Store EBITDA is 70", async () => expect(await ebitda()).toBe(70))
    await step('Manpower Cost becomes 40', () => w.save('pl_budget', { row_id: cost.row_id, updated_at: cost.updated_at, amount: 40 }))
    await step("Hilltop's Store EBITDA is 60", async () => expect(await ebitda()).toBe(60))
  })

  scenario('Two accounts get the same line', async ({ createUser }, step) => {
    let w!: World
    await step('the accounts "Staff Tea And Snacks" and "Staff Uniform"', async () => {
      w = await start(createUser)
      const first = await w.get('gl_account', '49990001')
      await w.save('gl_account', { row_id: first.row_id, updated_at: first.updated_at, pl_line: null })
      await w.save('gl_account', { account_code: '49990002', account_name: 'Staff Uniform', statement: 'P&L' })
    })
    await step('a Budget Editor gives both the line Salaries in one step', () => w.act(w.editor, 'set_accounts', { accounts: ['49990001', '49990002'], change: { pl_line: w.made.salaries.row_id } }))
    await step('both accounts are on Salaries', async () => expect((await w.rows('gl_account')).map(account => account.pl_line)).toEqual([w.made.salaries.row_id, w.made.salaries.row_id]))
    await step('the history of "Staff Uniform" says who changed its line', async () => {
      const history = await w.editor.get<{ versions: { created_by: string; data: { changed: unknown[] } }[] }>('/api/activity/budgets.gl_account/49990002')
      expect(history.versions.map(version => [version.created_by, version.data.changed])).toEqual([[w.editor.user, [['pl_line', null, w.made.salaries.row_id]]]])
    })
  })
})
