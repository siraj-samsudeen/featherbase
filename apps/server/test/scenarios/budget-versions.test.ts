// budget-versions's fenced scenarios (#1380, #1070): each test is one scenario of the spec, step by step,
// against the installed Budgets app.
import { describe, expect } from 'vitest'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { expectRefused } from '../fixtures'
import { figuresOf } from '../../../../client-apps/jeyarama/budgets/src/plRules'
import { approve, budgetFor, figures, manpowerInOctober, revision, start, type Row, type World } from './budgets-scenes'

const scenario = scenarioFor(test, 'budget-versions')

describe('budget-versions', () => {

  scenario('A revision takes over from its first month', async ({ createUser }, step) => {
    let w!: World
    await step('the FY27 Original budget covers April to March and is approved', async () => { w = await start(createUser) })
    await step('FY27 Revision 1 covers October to March and is approved after it', async () => {
      // Approved the same day here; the later of two approvals that day is the one made last.
      const made = await revision(w)
      await approve(w, made)
    })
    await step('the budget for September is FY27 Original', async () => expect(await budgetFor(w, '2026-09-01')).toBe('FY27 Original'))
    await step('the budget for October is FY27 Revision 1', async () => expect(await budgetFor(w, '2026-10-01')).toBe('FY27 Revision 1'))
  })

  scenario('A draft revision changes nothing yet', async ({ createUser }, step) => {
    let w!: World
    await step('the FY27 Original budget covers April to March and is approved', async () => { w = await start(createUser) })
    await step('FY27 Revision 1 covers October to March and is still a draft', async () => { await revision(w) })
    await step('the budget for October is FY27 Original', async () => expect(await budgetFor(w, '2026-10-01')).toBe('FY27 Original'))
  })

  scenario('A figure cannot be changed after approval', async ({ createUser }, step) => {
    let w!: World
    let changed!: Promise<unknown>
    await step("the FY27 Original budget holds 18,40,000 for Hilltop's Manpower Cost in October", async () => { w = await start(createUser); expect(await manpowerInOctober(w, w.made.version.row_id)).toEqual([1840000]) })
    await step('a Budget Editor approves the budget', () => approve(w, w.made.version.row_id))
    await step('the budget says who approved it', async () => expect((await w.get('budget_version', w.made.version.row_id)).approved_by).toBe(w.editor.user))
    await step('the Budget Editor changes that figure to 19,00,000', () => { changed = w.save('pl_budget', { row_id: w.made.budget.row_id, updated_at: w.made.budget.updated_at, amount: 1900000 }); changed.catch(() => undefined) })
    await step('they are refused', async () => { await expectRefused(changed, 417, 'is approved: revise it to change a figure'); expect(await manpowerInOctober(w, w.made.version.row_id)).toEqual([1840000]) })
  })

  scenario('A revision starts from the approved figures', async ({ createUser }, step) => {
    let w!: World
    let made = ''
    await step("the FY27 Original budget holds 18,40,000 for Hilltop's Manpower Cost in October", async () => { w = await start(createUser) })
    await step('the budget is approved', () => approve(w, w.made.version.row_id))
    await step('a Budget Editor revises it for October to March as FY27 Revision 1', async () => {
      made = (await w.act<{ version: string }>(w.editor, 'revise_version', { version: w.made.version.row_id, version_name: 'FY27 Revision 1', covers_from: '2026-10-01', covers_to: '2027-03-01' })).version
    })
    await step('FY27 Revision 1 is a draft', async () => expect(await w.get('budget_version', made)).toMatchObject({ version_name: 'FY27 Revision 1', version_state: 'Draft' }))
    await step("it shows 18,40,000 for Hilltop's Manpower Cost in October, held on FY27 Original", async () => {
      const versions = (await w.rows('budget_version')).map(v => ({ row_id: v.row_id, based_on: (v.based_on as string) ?? null, covers_from: String(v.covers_from).slice(0, 10), covers_to: String(v.covers_to).slice(0, 10) }))
      const cells = (await w.rows('pl_budget')).map(c => ({ budget_version: String(c.budget_version), plant: String(c.plant), budget_month: String(c.budget_month).slice(0, 10), pl_line: String(c.pl_line), amount: Number(c.amount) }))
      expect(figuresOf(versions, cells, made).get(`9003|2026-10-01|${w.made.manpower.row_id}`)).toEqual({ amount: 1840000, from: w.made.version.row_id })
    })
  })

  scenario('One bad figure keeps the whole block out', async ({ createUser }, step) => {
    let w!: World
    let pasted!: Promise<unknown>
    let subtotal!: Row
    await step('the FY27 Original budget is a draft', async () => {
      w = await start(createUser)
      subtotal = await w.save('pl_line', { line_key: 'store_ebitda', line_name: 'Store EBITDA', level: 'Published', line_order: 900, section: 'Below Store EBITDA', line_kind: 'Subtotal', sign: 'Income', subtotal_rule: 'Running Total' })
    })
    await step('a Budget Editor brings in a figure for Hilltop and a figure for a subtotal line together', () => {
      pasted = w.act(w.editor, 'paste_budget', { version: w.made.version.row_id, values: [
        { plant: '9003', pl_line: w.made.manpower.row_id, budget_month: '2026-11-01', amount: 1860000 },
        { plant: '9003', pl_line: subtotal.row_id, budget_month: '2026-11-01', amount: 5 },
      ] })
      pasted.catch(() => undefined)
    })
    await step('they are refused', () => expectRefused(pasted, 417, 'Store EBITDA is a subtotal'))
    await step('the budget holds neither figure', async () => expect((await figures(w, w.made.version.row_id)).map(row => String(row.budget_month).slice(0, 7))).toEqual(['2026-10']))
  })

  scenario('Bringing a figure in again replaces it', async ({ createUser }, step) => {
    let w!: World
    await step("the FY27 Original budget holds 18,40,000 for Hilltop's Manpower Cost in October", async () => { w = await start(createUser) })
    await step("a Budget Editor brings in 19,00,000 for Hilltop's Manpower Cost in October", () =>
      w.act(w.editor, 'paste_budget', { version: w.made.version.row_id, values: [{ plant: '9003', pl_line: w.made.manpower.row_id, budget_month: '2026-10-01', amount: 1900000 }] }))
    await step('the budget holds one figure for it, 19,00,000', async () => expect(await manpowerInOctober(w, w.made.version.row_id)).toEqual([1900000]))
  })
})
