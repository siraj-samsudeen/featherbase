// jeyarama-assets-tagging's scenarios (#1070): each test is one fenced
// scenario of openspec/specs/jeyarama-assets-tagging/spec.md, step by step,
// against the real in-process server, with the Assets app rendered in jsdom
// where the scenario reads a page.
import { within } from '@testing-library/react'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect } from '../pg-test'
import { AssetCounts, Assets, type Row, realTime } from './assets'

const scenario = scenarioFor(test, 'jeyarama-assets-tagging')
afterEach(realTime)

async function world(fixtures: Parameters<typeof Assets.start>[0]) {
  const assets = await Assets.start(fixtures)
  return { assets, count: new AssetCounts(assets) }
}

/** A calendar day in India, `offset` days from today, as a date column stores it. */
const istDay = (offset: number) => new Date(Date.now() + 5.5 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10)

describe('jeyarama-assets-tagging', () => {
  scenario('A used tag is refused', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    await step('JRA-000123 is on the dairy chiller', async () => {
      const tag = await count.issuedTag(123)
      await count.site('ATK 1501')
      const id = await assets.asset('dairy chiller', 'ATK 1501', { tag_no: tag })
      expect((await assets.get('equipment.asset', id)).tag_no).toBe(tag)
    })
    await step('a counter records another item with JRA-000123', async () => {
      await assets.extra('a counter', ['Assets Member'])
      await count.area('Bakery')
      await count.freshCount(['a counter', 'another member'])
      await count.line('a counter', { tag: 'JRA-000123', taggedBy: 'another member', area: 'Bakery', asset_name: 'Bread rack' }, true)
    })
    await step('the line is refused, saying tag numbers are never reused', async () => {
      assets.refused(/tag numbers are never reused/)
      expect(await assets.list('equipment.count_line', [['count', '=', count.count.row_id]])).toEqual([])
    })
  })

  scenario('Both initial', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    let recorded: Row
    await step('Ravi and Meena count ATK area GF-A03', async () => {
      await count.area('GF-A03')
      await count.freshCount(['Ravi', 'Meena'])
    })
    await step('Meena records JRA-000123 tagged by Ravi', async () => {
      const tag = await count.issuedTag(123)
      recorded = await count.line('Meena', { tag, taggedBy: 'Ravi', area: 'GF-A03' })
    })
    await step('the line shows tagged by Ravi and recorded by Meena', async () => {
      const stored = await assets.get('equipment.count_line', recorded.row_id)
      expect(stored.tag_no).toBe('JRA-000123')
      expect(stored.tagged_by).toBe(assets.ids.Ravi)
      expect(stored.recorded_by).toBe(assets.ids.Meena)
      const table = await count.freshLines('Meena', 'GF-A03')
      await expect.poll(() => within(table).getAllByRole('row').find(row => row.textContent!.includes('JRA-000123'))?.textContent, { timeout: 8000 })
        .toMatch(/JRA-000123.*Tagged Ravi · recorded Meena/)
    })
  })

  scenario('A missing label', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    await step('3 tagged lines and no spoiled labels in GF-A03 today', async () => {
      await count.area('GF-A03')
      await assets.extra('the site manager', ['Assets Member'])
      await count.siteManager('the site manager')
      await count.freshCount(['Ravi', 'Meena'])
      for (let n = 0; n < 3; n++) await count.line('Meena', { tag: await count.freshTag(), taggedBy: 'Ravi', area: 'GF-A03' })
      expect(await assets.list('equipment.tag_event', [['count', '=', count.count.row_id]])).toEqual([])
    })
    await step('the site manager signs with 4 labels used', () =>
      assets.save('the site manager', 'equipment.area_close', { count: count.count.row_id, area: assets.places['GF-A03'], labels_used: 4 }, true))
    await step('it is refused, saying to find the difference first', async () => {
      assets.refused(/find the difference before signing/)
      expect(await assets.list('equipment.area_close', [['count', '=', count.count.row_id]])).toEqual([])
    })
  })

  scenario('Transfer during the freeze', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    await step("ATK 1501's count freeze runs from yesterday to tomorrow", async () => {
      await count.plan({ kind: 'Fresh inventory', site: 'ATK 1501', extra: { freeze_from: istDay(-1), freeze_to: istDay(1) } })
      const stored = await count.current()
      expect([String(stored.freeze_from).slice(0, 10), String(stored.freeze_to).slice(0, 10)]).toEqual([istDay(-1), istDay(1)])
    })
    await step("a manager requests a transfer out of ATK 1501 without the site manager's note", async () => {
      await assets.save('a manager', 'equipment.transfer', {
        transfer_kind: 'Between sites', from_place: await count.site('ATK 1501'), to_place: await assets.place('Enchakkal WH 9151'), reason: 'Spare scale for the warehouse',
      }, true)
    })
    await step('it is refused, saying ATK 1501 is in its count freeze', () => assets.refused(/ATK 1501 is in its count freeze/))
  })

  scenario('A counter cannot match', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    let counted: Row
    await step('Ravi counted at ATK 1501', async () => {
      await count.area('Dairy')
      await count.freshCount(['Ravi', 'Meena'])
      counted = await count.line('Meena', { tag: await count.freshTag(), taggedBy: 'Ravi', area: 'Dairy', serial_no: 'BS23K44871' })
    })
    await step('Ravi matches a SAP record', async () => {
      // Ravi is also an asset accountant, so only having counted can stop him.
      await assets.addRole('Ravi', 'Assets Accountant')
      await count.financeRole('Ravi', 'Asset accountant')
      // Another asset accountant holds the plant's SAP book.
      await assets.addRole('the asset accountant', 'Assets Accountant')
      const record = await assets.save('the asset accountant', 'equipment.sap_book', { plant: '1501', sap_asset_no: '200014', sap_asset_sub: '0', description: 'Chiller 3-door', book_value: 142000, quantity: 1 })
      await assets.act('Ravi', 'match_sap', { sap_book: record.row_id, lines: [counted.row_id], method: 'Serial number' }, true)
      assets.refused(/The count team never matches/)
    })
    await step('it is refused', () => assets.refused())
  })

  scenario('The accountant cannot approve a write-off', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    let exception: Row
    await step('an "In books, not found" exception raised by the asset accountant', async () => {
      await assets.addRole('the asset accountant', 'Assets Accountant')
      await count.financeRole('the asset accountant', 'Asset accountant')
      exception = await assets.save('the asset accountant', 'equipment.exception', { outcome: 'In books, not found', sap_asset_no: '200081-0', detail: 'EAS gate pair not found in any area' })
      expect(exception.raised_by).toBe(assets.ids['the asset accountant'])
    })
    await step('the asset accountant approves it', async () => {
      await assets.change('the asset accountant', 'equipment.exception', exception.row_id, { exception_state: 'Approved', approval_ref: 'FC/ATK/001' }, true)
      assets.refused(/an asset accountant never approves/)
    })
    await step('it is refused', async () => {
      assets.refused()
      expect((await assets.get('equipment.exception', exception.row_id)).exception_state).not.toBe('Approved')
    })
  })
})
