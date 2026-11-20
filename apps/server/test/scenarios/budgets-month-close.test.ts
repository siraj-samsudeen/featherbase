// budgets-month-close's fenced scenarios (#1380, #1070): each test is one scenario of the spec, step by step,
// against the installed Budgets app.
import { describe, expect } from 'vitest'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { expectRefused } from '../fixtures'
import { start, type World } from './budgets-scenes'

const scenario = scenarioFor(test, 'budgets-month-close')

describe('budgets-month-close', () => {
  const provision = async (w: World) => { const line = await w.get('close_adjustment', w.made.adjustment.row_id); return [line.adjustment_state, Number(line.remaining_amount)] }
  const publish = (w: World) => w.act(w.editor, 'publish_close', { close: w.made.close.row_id })

  scenario('Nothing is added to a published close', async ({ createUser }, step) => {
    let w!: World
    let added!: Promise<unknown>
    await step('the close of October has a provision of 42,500 for Hilltop', async () => { w = await start(createUser); expect(await provision(w)).toEqual(['Open', 42500]) })
    await step('a Budget Editor publishes the close', () => publish(w))
    await step('the close says who published it', async () => expect(await w.get('month_close', w.made.close.row_id)).toMatchObject({ close_state: 'Published', published_by: w.editor.user }))
    await step('the Budget Editor adds another adjustment to it', () => {
      added = w.save('close_adjustment', { month_close: w.made.close.row_id, plant: '9003', gl_account: '49990001', amount: 5, adjustment_type: 'Provision', reason: 'Late' })
      added.catch(() => undefined)
    })
    await step('they are refused', () => expectRefused(added, 417, 'is published: make a new version'))
  })

  scenario('Republishing makes a second version', async ({ createUser }, step) => {
    let w!: World
    let second = ''
    await step('the close of October is published', async () => { w = await start(createUser); await publish(w) })
    await step('a Budget Editor makes a new version of it', async () => { second = (await w.act<{ close: string }>(w.editor, 'new_close_version', { close: w.made.close.row_id, downloaded_at: '2026-11-12T06:30:00.000Z' })).close })
    await step('October has a version 2 that is open', async () => expect(await w.get('month_close', second)).toMatchObject({ version_no: 2, close_state: 'Open' }))
    await step('version 1 is marked as replaced', async () => expect((await w.get('month_close', w.made.close.row_id)).close_state).toBe('Replaced'))
  })

  scenario('A provision is matched in two parts', async ({ createUser }, step) => {
    let w!: World
    const match = (document: string, amount: number) => w.act(w.editor, 'match_adjustment', { adjustment: w.made.adjustment.row_id, document, amount })
    await step('the close of October has a provision of 42,500 for Hilltop', async () => { w = await start(createUser) })
    await step('the close is published', () => publish(w))
    await step('a Budget Editor matches 40,000 of it to an SAP document', () => match('1900019201', 40000))
    await step('2,500 remains and the provision is still open', async () => expect(await provision(w)).toEqual(['Open', 2500]))
    await step('the Budget Editor matches the last 2,500 to another SAP document', () => match('1900019388', 2500))
    await step('nothing remains and the provision is posted in SAP', async () => expect(await provision(w)).toEqual(['Posted In SAP', 0]))
  })

  scenario('An account that is not classified yet', async ({ createUser }, step) => {
    let w!: World
    let added!: Promise<unknown>
    await step('the account "Pallet Purchases" has no P&L line', async () => { w = await start(createUser); await w.save('gl_account', { account_code: '49990009', account_name: 'Pallet Purchases', statement: 'P&L' }) })
    await step('a Budget Editor adds an adjustment on that account for Hilltop', () => {
      added = w.save('close_adjustment', { month_close: w.made.close.row_id, plant: '9003', gl_account: '49990009', amount: 412000, adjustment_type: 'Capitalise', reason: 'Pallets to be capitalised' })
      added.catch(() => undefined)
    })
    await step('they are refused, and told to classify the account first', () => expectRefused(added, 417, 'Pallet Purchases has no P&L line yet: classify it first'))
  })
})
