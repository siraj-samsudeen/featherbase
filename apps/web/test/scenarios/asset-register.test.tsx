// asset-register's scenarios (#1070): each test is one fenced scenario of
// openspec/specs/asset-register/spec.md, step by step, with the Assets app
// (client-apps/jeyarama/equipment) rendered in jsdom against the real
// in-process server.
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, insideOf, onScreen } from '../pg-test'
import { Assets, istLabel, realTime } from './assets'

const scenario = scenarioFor(test, 'asset-register')
afterEach(realTime)

const COLD_ROOM = 'walk-in cold room'
const SAP_REFRESHED = '2026-11-07T04:30:00.000Z'

/** The register's row for one asset, as a person sees it (after picking a site in the Place filter): its text and Tag cell. */
async function registerRow(assets: Assets, name: string, assetId: string, site?: string) {
  await assets.open(name, 'assets')
  const table = await screen.findByRole('table', { name: 'Assets' })
  if (site) {
    // Waits for the site to be offered: selectOption looks for its option once.
    await within(screen.getByRole('combobox', { name: 'Place' })).findByRole('option', { name: site })
    await onScreen().selectOption('Place', site)
  }
  // The asset's row and its Tag cell, by column: the DSL reads text, not tables.
  const row = await waitFor(() => {
    const link = table.querySelector(`tbody a[href="#asset=${encodeURIComponent(assetId)}"]`)
    expect(link, 'the asset is in the register').not.toBeNull()
    return link!.closest('tr')!
  })
  const tagColumn = [...table.querySelectorAll('thead th')].map(th => th.textContent!.trim()).indexOf('Tag')
  return { text: row.textContent!, tag: tagColumn < 0 ? null : row.querySelectorAll('td')[tagColumn]!.textContent!.trim() }
}

/** The asset page of `assetId`, opened by a person, once it shows the asset. */
async function openAsset(assets: Assets, name: string, assetId: string) {
  const main = await assets.open(name, `asset=${encodeURIComponent(assetId)}`)
  const asset = await assets.get('equipment.asset', assetId)
  await screen.findByRole('heading', { name: String(asset.asset_name) })
  return main
}

describe('asset-register', () => {
  scenario('An AC in a store', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let assetId = ''
    const assetName = 'Voltas 2-ton split AC'
    await step("ATK 1501 is one of the group's sites", async () => {
      const site = await assets.get('equipment.place', await assets.place('ATK 1501', 'Site'))
      expect(site.place_level).toBe('Site')
    })
    await step('a manager adds the "Voltas 2-ton split AC" of type AC to ATK 1501 with tag JRA-000501', async () => {
      const row = await assets.save('a manager', 'equipment.asset', { asset_name: assetName, asset_type: await assets.type('AC'), place: await assets.place('ATK 1501'), tag_no: 'JRA-000501' })
      assetId = row.row_id
    })
    await step('the register lists the AC under tag JRA-000501', async () => {
      expect((await assets.get('equipment.asset', assetId)).tag_no).toBe('JRA-000501')
      const row = await registerRow(assets, 'a manager', assetId)
      expect(row.text).toMatch(new RegExp(assetName))
      expect(row.tag).toBe('JRA-000501')
    })
    await step('every member sees it in ATK 1501', async () => {
      for (const member of ['a member', 'another member']) {
        const row = await registerRow(assets, member, assetId, 'ATK 1501')
        expect(row.text).toMatch(new RegExp(assetName))
        expect(row.text).toMatch(/ATK 1501/)
      }
    })
  })

  scenario('An asset not yet tagged', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let assetId = ''
    let row: Awaited<ReturnType<typeof registerRow>>
    await step('the "Billing PC, till 3" in ATK 1501 has no tag yet', async () => {
      assetId = await assets.asset('Billing PC, till 3', 'ATK 1501')
      expect((await assets.get('equipment.asset', assetId)).tag_no ?? null).toBeNull()
    })
    await step('a member opens the register', async () => {
      row = await registerRow(assets, 'a member', assetId)
    })
    await step('the billing PC\'s tag reads "Needs a tag"', () => expect(row.tag).toBe('Needs a tag'))
  })

  scenario('A cold room deep inside a warehouse', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    await step('the Cold chain area is on the Ground floor of the Main building at Enchakkal WH 9151', async () => {
      await assets.place('Enchakkal WH 9151', 'Site')
      await assets.place('Main building', 'Building', 'Enchakkal WH 9151')
      await assets.place('Ground floor', 'Floor', 'Main building')
      await assets.place('Cold chain', 'Area', 'Ground floor')
    })
    await step('a member opens the walk-in cold room in Cold chain', async () => {
      await openAsset(assets, 'a member', await assets.asset(COLD_ROOM, 'Cold chain'))
    })
    await step('its place reads "Enchakkal WH 9151 › Main building › Ground floor › Cold chain"', () =>
      onScreen().within('main', (main) => main.assertText('Enchakkal WH 9151 › Main building › Ground floor › Cold chain')))
  })

  scenario('SAP numbers on the asset page', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    const sap = { assetNo: '210004512', sub: '0', equipment: '10007731' }
    let assetId = ''
    const SAP = '[aria-labelledby="from-sap"]'
    await step('the walk-in cold room is SAP asset 210004512, sub-number 0, equipment 10007731', async () => {
      assetId = await assets.asset(COLD_ROOM, 'Enchakkal WH 9151', {
        sap_asset_no: sap.assetNo, sap_asset_sub: sap.sub, sap_equipment_no: sap.equipment, sap_refreshed_at: SAP_REFRESHED,
      })
    })
    await step('a member opens it in Assets', () => openAsset(assets, 'a member', assetId))
    await step('the page shows those numbers as coming from SAP, with when they were refreshed', async () => {
      await insideOf(onScreen(), SAP, (section) => section
        .assertText(`${sap.assetNo} / ${sap.sub}`)
        .assertText(sap.equipment)
        .assertText(`Refreshed ${istLabel(SAP_REFRESHED)}`))
    })
    // A count of controls: the DSL reads text, not elements.
    await step('offers no way to change them', () =>
      expect(document.querySelector(SAP)!.querySelectorAll('input, select, textarea, button, a, [contenteditable="true"]')).toHaveLength(0))
  })

  scenario('Owned by one company, run by another', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let assetId = ''
    await step('KAIPL is a Verified legal entity and Kannammal Agro is another', async () => {
      expect((await assets.get('equipment.entity', await assets.entity('KAIPL', 'Verified'))).entity_status).toBe('Verified')
      await assets.entity('Kannammal Agro', 'Draft')
    })
    await step('the walk-in cold room is owned by KAIPL and operated by Kannammal Agro', async () => {
      assetId = await assets.asset(COLD_ROOM, 'Enchakkal WH 9151', { owner_entity: await assets.entity('KAIPL'), operator_entity: await assets.entity('Kannammal Agro') })
    })
    await step('its page shows both, with KAIPL marked Verified', async () => {
      await openAsset(assets, 'a member', assetId)
      // The ownership facts in the order the page lists them: Legal owner, then Operator.
      const fact = (n: number) => `[aria-labelledby="ownership"] dl > div:nth-child(${n})`
      await onScreen()
        .within(`${fact(1)} > dt`, (term) => term.assertExactText('Legal owner'))
        .within(`${fact(1)} > dd`, (value) => value.assertExactText('KAIPL · Verified'))
        .within(`${fact(2)} > dt`, (term) => term.assertExactText('Operator'))
      // A pattern: whether the operator is marked is not this scenario's.
      expect(document.querySelector(`${fact(2)} > dd`)!.textContent!.trim()).toMatch(/^Kannammal Agro · /)
    })
  })

  scenario('Capitalized, under repair and with a vendor at once', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let assetId = ''
    await step('the walk-in cold room is Capitalized and Under repair, With vendor', async () => {
      assetId = await assets.asset(COLD_ROOM, 'Enchakkal WH 9151', { book_status: 'Capitalized', condition: 'Under repair', custody_status: 'With vendor' })
    })
    await step('it has an open repair job', () => assets.save('store staff', 'equipment.job', { asset: assetId, problem: 'Door seal torn' }))
    await step('its page shows Books Capitalized, Condition Under repair, Custody With vendor and Workflow Repair job open', async () => {
      await openAsset(assets, 'a member', assetId)
      // Every state, in order: the DSL reads text, not lists.
      const states = screen.getByRole('list', { name: 'States' })
      await waitFor(() => expect(within(states).getAllByRole('listitem').map(item => item.textContent!.trim()))
        .toEqual(['Books: Capitalized', 'Condition: Under repair', 'Custody: With vendor', 'Workflow: Repair job open']))
    })
  })

  scenario('Store staff can look but not change', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let assetId = ''
    let before: unknown
    await step('the "Voltas 2-ton split AC" is in the register', async () => {
      assetId = await assets.asset('Voltas 2-ton split AC', 'ATK 1501', { type: 'AC' })
    })
    await step('store staff try to change its place', async () => {
      before = (await assets.get('equipment.asset', assetId)).place
      await assets.change('store staff', 'equipment.asset', assetId, { place: await assets.place('Avadi Store') }, true)
    })
    await step('the change is refused', async () => {
      assets.refused()
      expect((await assets.get('equipment.asset', assetId)).place).toBe(before)
    })
  })

  scenario('A warranty about to end', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let assetId = ''
    // The register reads the day on the device of whoever opens it.
    await step('today is 7 November 2026', () => assets.setClock('2026-11-07T10:00:00+05:30'))
    await step('the "Kirloskar 62.5 kVA DG" warranty ends on 30 November 2026', async () => {
      assetId = await assets.asset('Kirloskar 62.5 kVA DG', 'ATK 1501', { type: 'DG', warranty_until: '2026-11-30' })
    })
    await step('the register shows its warranty ends soon', async () => {
      const row = await registerRow(assets, 'a manager', assetId)
      expect(row.text).toMatch(/Warranty ends soon/)
    })
  })
})
