// asset-verification-counts's scenarios (#1070): each test is one fenced
// scenario of openspec/specs/asset-verification-counts/spec.md, step by step,
// with the Assets app rendered in jsdom against the real in-process server.
import { waitFor } from '@testing-library/react'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect } from '../pg-test'
import { AssetCounts, Assets, realTime } from './assets'

const scenario = scenarioFor(test, 'asset-verification-counts')
afterEach(realTime)

async function world(fixtures: Parameters<typeof Assets.start>[0]) {
  const assets = await Assets.start(fixtures)
  return { assets, count: new AssetCounts(assets) }
}

/** A started ATK count expecting these assets, counted by Suresh and reviewed by Meena. */
async function expecting({ assets, count }: Awaited<ReturnType<typeof world>>, names: string[]) {
  await count.site('ATK 1501')
  for (const name of names) await assets.asset(name, 'ATK 1501')
  await count.plan({ counters: ['Suresh'], reviewer: 'Meena' })
  await count.start()
  const expected = await count.expected()
  for (const name of names) expect(expected, `${name} is not expected`).toContain(assets.assets[name])
}

/** A counting ATK count with Suresh on it and the billing PC in the register. */
async function billingPcCount({ assets, count }: Awaited<ReturnType<typeof world>>) {
  await count.site('ATK 1501')
  await assets.asset('billing PC', 'ATK 1501')
  await count.plan({ counters: ['Suresh'] })
  await count.start()
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('asset-verification-counts', () => {
  scenario('A full count of ATK', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    await step('ATK 1501 is a site', () => count.site('ATK 1501'))
    await step('a manager plans a full count of ATK 1501 with Suresh counting and Meena reviewing', () =>
      count.plan({ kind: 'Full', counters: ['Suresh'], reviewer: 'Meena' }))
    await step('the count is Planned, waiting to start', async () => {
      const stored = await count.current()
      expect(stored.count_state).toBe('Planned')
      expect(stored.snapshot_at).toBeNull()
      expect(stored.reviewer).toBe(assets.ids.Meena)
      const counters = await assets.list('equipment.counter', [['count', '=', stored.row_id]], ['person'])
      expect(counters.map(row => row.person)).toEqual([assets.ids.Suresh])
      const row = await count.countsRow('a manager')
      expect(row.text).toMatch(/Planned/)
      expect(row.canStart, 'the count offers no Start count').toBe(true)
    })
  })

  scenario('The reviewer cannot count', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    await step('Meena reviews the ATK count', () => count.plan({ counters: [], reviewer: 'Meena' }))
    await step('a manager adds Meena as a counter', () => count.addCounter('a manager', 'Meena', true))
    await step('the change is refused, saying the reviewer can’t also be a counter', async () => {
      assets.refused(/The reviewer can’t also be a counter/)
      expect(await assets.list('equipment.counter', [['count', '=', count.count.row_id]])).toEqual([])
    })
  })

  scenario('Start the ATK count', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    let startedFrom = 0
    let startedTo = 0
    await step('ATK 1501 has 12 assets in the register', async () => {
      await count.site('ATK 1501')
      for (let n = 1; n <= 12; n++) await assets.asset(`ATK asset ${n}`, 'ATK 1501')
    })
    await step('a manager starts the full count of ATK 1501', async () => {
      await count.plan({ kind: 'Full' })
      startedFrom = Date.now()
      await count.start('a manager')
      startedTo = Date.now()
    })
    await step('the count is Counting, expecting 12 assets, fixed at that time', async () => {
      const stored = await count.current()
      expect(stored.count_state).toBe('Counting')
      expect(stored.expected_total).toBe(12)
      const fixedAt = Date.parse(String(stored.snapshot_at))
      expect(fixedAt >= startedFrom - 1000 && fixedAt <= startedTo + 1000, `fixed at ${stored.snapshot_at}`).toBe(true)
      expect(await count.expected()).toHaveLength(12)
      // Fixed: an asset added to the place afterwards is not expected.
      await assets.asset('Bought after the start', 'ATK 1501')
      expect(await count.expected()).toHaveLength(12)
      expect((await count.countsRow('a manager')).text).toMatch(/Counting · 12 expected/)
    })
  })

  scenario('A counter cannot read the expected list', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    await step('Suresh counts the ATK count', async () => {
      await count.area('Dairy aisle')
      await count.site('Enchakkal WH 9151')
      await count.area('Cold store', 'Enchakkal WH 9151')
      await assets.asset('Display chiller', 'Dairy aisle')
      await assets.asset('Weighing scale', 'ATK 1501')
      await count.plan({ counters: ['Suresh'] })
      await count.start()
    })
    await step("he asks for the count's expected list", () => count.askExpected('Suresh'))
    await step('he is refused', () => assets.refused())
    await step('his count page shows only his areas and how many he has recorded', async () => {
      const { areas, text } = await count.counterPage('Suresh', 'Dairy aisle')
      expect(areas.length > 0 && areas.every(label => label.startsWith('ATK 1501')), `areas offered: ${areas.join(', ')}`).toBe(true)
      expect(text).toMatch(/You have recorded 0 items in ATK 1501 › Dairy aisle|You have recorded 0 items in .*Dairy aisle/)
      expect(text).not.toMatch(/Display chiller|Weighing scale|expected/i)
    })
  })

  scenario('A damaged chiller', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    let recordedFrom = 0
    let recordedTo = 0
    let recorded: { row_id: string }
    await step('the ATK count is Counting and Suresh counts it', async () => {
      await count.area('Dairy aisle')
      await assets.asset('display chiller', 'Dairy aisle')
      await count.plan({ counters: ['Suresh'] })
      await count.start()
      expect((await count.current()).count_state).toBe('Counting')
    })
    await step('he records the display chiller in ATK Dairy aisle as Damaged', async () => {
      recordedFrom = Date.now()
      recorded = await count.record('Suresh', { asset: 'display chiller', area: 'Dairy aisle', outcome: 'Damaged' })
      recordedTo = Date.now()
    })
    await step('the record keeps Suresh, the time, Dairy aisle and Damaged', async () => {
      const [stored] = (await count.scans()).filter(scan => scan.row_id === recorded.row_id)
      expect(stored!.created_by).toBe(assets.ids.Suresh)
      const at = Date.parse(String(stored!.created_at))
      expect(at >= recordedFrom - 1000 && at <= recordedTo + 1000, `recorded at ${stored!.created_at}`).toBe(true)
      expect(stored!.area).toBe(assets.places['Dairy aisle'])
      expect(stored!.outcome).toBe('Damaged')
      expect(stored!.asset).toBe(assets.assets['display chiller'])
    })
  })

  scenario('A typed tag needs a reason', async ({ createUser, admin }, step) => {
    const w = await world({ createUser, admin })
    await step('the billing PC’s label is torn', () => billingPcCount(w))
    await step('Suresh types its tag without a reason', () => w.count.typeTag('Suresh', 'billing PC', 'ATK 1501', null, true))
    await step('the record is refused, asking why the tag was typed', async () => {
      w.assets.refused(/Say why the tag was typed/)
      expect(await w.count.scans()).toEqual([])
    })
  })

  scenario('The same tag twice', async ({ createUser, admin }, step) => {
    const w = await world({ createUser, admin })
    let first: { row_id: string; duplicate?: unknown }
    let second: { row_id: string }
    await step('Suresh recorded the billing PC once', async () => {
      await billingPcCount(w)
      first = await w.count.record('Suresh', { asset: 'billing PC', area: 'ATK 1501' })
      expect(first.duplicate).toBe(false)
    })
    await step('he records it again in the same count', async () => {
      second = await w.count.record('Suresh', { asset: 'billing PC', area: 'ATK 1501' })
    })
    await step('the second record is flagged as a duplicate', async () => {
      const stored = await w.count.scans()
      expect(stored.find(scan => scan.row_id === second.row_id)!.duplicate).toBe(true)
      expect(stored.find(scan => scan.row_id === first.row_id)!.duplicate).toBe(false)
    })
  })

  scenario('Missing and moved are kept apart', async ({ createUser, admin }, step) => {
    const w = await world({ createUser, admin })
    await step('the ATK count expected the weighing scale and the forklift', () => expecting(w, ['weighing scale', 'forklift']))
    await step('the forklift was moved to Enchakkal after the count started', async () => {
      await w.assets.change('a manager', 'equipment.asset', w.assets.assets.forklift!, { place: await w.count.site('Enchakkal') })
    })
    await step('neither is recorded', async () => {
      expect(await w.count.scans()).toEqual([])
      await w.count.moveTo('In review')
    })
    await step('the review shows the scale as missing and the forklift as moved since the start', async () => {
      await w.count.review('Meena')
      // The places' names arrive after the review.
      await waitFor(() => expect(w.count.reviewShown().moved).toMatch(/forklift · now in Enchakkal/))
      const review = w.count.reviewShown()
      expect(review.missing).toMatch(/weighing scale/)
      expect(review.missing).not.toMatch(/forklift/)
      expect(review.moved).not.toMatch(/weighing scale/)
    })
  })

  scenario('Recount the scale', async ({ createUser, admin }, step) => {
    const w = await world({ createUser, admin })
    await step('the weighing scale is missing in the ATK review', async () => {
      await expecting(w, ['weighing scale'])
      await w.count.moveTo('In review')
      expect((await w.count.review('Meena')).missing).toMatch(/weighing scale/)
    })
    await step('the reviewer sends it back for recount and Suresh then finds it', async () => {
      await w.count.decide('Meena', 'weighing scale', 'Recount')
      await w.count.record('Suresh', { asset: 'weighing scale', area: 'ATK 1501', outcome: 'Found here' })
    })
    await step('the scale shows as found', async () => {
      await w.count.review('Meena')
      await waitFor(() => expect(w.count.reviewShown().found).toMatch(/weighing scale · Found here/))
      const review = w.count.reviewShown()
      expect(review.missing).not.toMatch(/weighing scale/)
    })
  })

  scenario('Close needs every decision', async ({ createUser, admin }, step) => {
    const w = await world({ createUser, admin })
    await step('the ATK review has one missing line without a decision', async () => {
      await expecting(w, ['weighing scale'])
      await w.count.moveTo('In review')
      expect(await w.assets.list('equipment.count_decision', [['count', '=', w.count.count.row_id]])).toEqual([])
    })
    await step('the reviewer closes the count', () => w.count.moveTo('Closed', 'Meena', true))
    await step('closing is refused, saying every missing and unlisted line needs a decision', async () => {
      w.assets.refused(/Decide every missing and unlisted line before closing/)
      expect((await w.count.current()).count_state).toBe('In review')
    })
  })

  scenario('Last verified', async ({ createUser, admin }, step) => {
    const { assets, count } = await world({ createUser, admin })
    let shown = ''
    await step('Suresh recorded the display chiller as Damaged in the ATK count on 7 November 2026', async () => {
      await count.area('Dairy aisle')
      await assets.asset('display chiller', 'Dairy aisle')
      await count.plan({ counters: ['Suresh'] })
      await count.start()
      const scan = await count.record('Suresh', { asset: 'display chiller', area: 'Dairy aisle', outcome: 'Damaged' })
      // Midday in India on that day: the platform stamps records with its own clock.
      await count.backdate(scan.row_id, new Date(Date.UTC(2026, 10, 7, 6, 30)).toISOString())
    })
    await step('anyone opens the chiller’s page', async () => {
      const main = await assets.open('a member', `asset=${encodeURIComponent(assets.assets['display chiller']!)}`)
      // The line names the count once the counts have arrived.
      await expect.poll(() => main.textContent, { timeout: 8000 }).toMatch(/Last verified .* · ATK count /)
      shown = main.textContent!
    })
    await step('it shows last verified 07-Nov-2026, Damaged, in the ATK count', () =>
      expect(shown).toMatch(new RegExp(`Last verified 07-Nov-2026 · Damaged · ${escape(String(count.count.count_name))}`)))
  })
})
