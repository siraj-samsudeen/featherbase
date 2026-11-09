// row-retirement's fenced scenarios (#1070), each walked step by step in jsdom
// against the real in-process server: the reason a person reads on the form,
// and which plants the list shows. Ported from the cucumber steps: the plants
// and a retirement a scenario starts from are made through the API; retiring,
// reactivating and what the list shows go through the screen.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { tableSlug } from 'shared'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderSession, byTestId, inside, type Session } from '../pg-test'

const scenario = scenarioFor(test, 'row-retirement')
const PLANTS = 'Retirement Plant'
const listPath = `/featherbase/admin/table/${encodeURIComponent(tableSlug(PLANTS))}`
const api = `/api/table/${encodeURIComponent(PLANTS)}`
const WAIT = { timeout: 15_000 }

async function plants(admin: TestClient, first: string, second: string) {
  await admin.post('/api/table_def', {
    name: PLANTS,
    module: 'Custom',
    id_pattern: 'prompt',
    columns: [{ column_name: 'city', label: 'City', column_type: 'Data', in_list_view: true }],
  })
  await admin.post(api, { row_id: first, city: 'Kochi' })
  await admin.post(api, { row_id: second, city: 'Nowhere' })
}

const retire = (admin: TestClient, plant: string, reason: string) =>
  admin.post(`${api}/${encodeURIComponent(plant)}:retire`, { reason })

async function openForm(admin: TestClient, plant: string): Promise<{ session: Session }> {
  cleanup()
  const { session } = await renderSession(`${listPath}/row/${encodeURIComponent(plant)}`, admin, { session: WAIT })
  await session.assertText('Record actions')
  return { session }
}

async function openList(admin: TestClient): Promise<{ session: Session }> {
  cleanup()
  const { session } = await renderSession(listPath, admin, { session: WAIT })
  await session.until('the list has rows', () => screen.queryByTestId('list-rows'))
  return { session }
}

// Which rows, in which order, and which carry the badge: lists and counts the DSL doesn't read.
/** Each listed row's title: the link that opens it. */
const rowTitles = () =>
  [...screen.getByTestId('list-rows').querySelectorAll('tr td a')].map((a) => a.textContent!.trim())

async function shownPlants(count: number) {
  await waitFor(() => expect(rowTitles()).toHaveLength(count), WAIT)
  return rowTitles()
}

const retiredRowTitles = () =>
  [...screen.getByTestId('list-rows').querySelectorAll('tr')]
    .filter((tr) => within(tr as HTMLElement).queryByTestId('retired-badge'))
    .flatMap((tr) => [...tr.querySelectorAll('td a')].map((a) => a.textContent!.trim()))

describe('row-retirement', () => {
  scenario('A sample plant is retired', async ({ admin }, step) => {
    await step('a table of plants holds "Riverside" and "Sample plant"', () => plants(admin, 'Riverside', 'Sample plant'))
    await step('the user retires "Sample plant" because "Not a real location"', async () => {
      const { session } = await openForm(admin, 'Sample plant')
      await session
        .clickButton('Record actions')
        .clickButton('Retire')
        .within(byTestId('retire-row-dialog'), (dialog) => dialog.fillIn('Reason', 'Not a real location').clickButton('Retire'))
        .until('the form shows the row as retired', () => screen.queryByTestId('retired-notice'))
    })
    await step('"Sample plant" shows it is retired because "Not a real location"', async () => {
      const { session } = await openForm(admin, 'Sample plant')
      await inside(session, 'retired-badge', (badge) => badge.assertText('Retired'))
      // The reason whole, exactly: the DSL's text verbs check containment.
      expect(screen.getByTestId('retired-reason').textContent!.trim()).toBe('Not a real location')
    })
  }, 40_000)

  scenario('The list leaves the retired plant out', async ({ admin }, step) => {
    await step('a table of plants holds "Riverside" and "Sample plant"', () => plants(admin, 'Riverside', 'Sample plant'))
    await step('"Sample plant" is retired because "Not a real location"', () => retire(admin, 'Sample plant', 'Not a real location'))
    await step('the user opens the list of plants', () => openList(admin))
    await step('the list shows "Riverside" and not "Sample plant"', async () => {
      const shown = await shownPlants(1)
      expect(shown).toEqual(['Riverside'])
      expect(shown).not.toContain('Sample plant')
    })
  }, 40_000)

  scenario('Retired plants shown again', async ({ admin }, step) => {
    await step('a table of plants holds "Riverside" and "Sample plant"', () => plants(admin, 'Riverside', 'Sample plant'))
    await step('"Sample plant" is retired because "Not a real location"', () => retire(admin, 'Sample plant', 'Not a real location'))
    await step('the user opens the list of plants and asks to see retired rows', async () => {
      const { session } = await openList(admin)
      await session.check('Show retired')
    })
    await step('the list shows "Riverside" and "Sample plant"', async () =>
      expect((await shownPlants(2)).sort()).toEqual(['Riverside', 'Sample plant']))
    await step('only "Sample plant" is marked as retired', () => expect(retiredRowTitles()).toEqual(['Sample plant']))
  }, 40_000)

  scenario('The plant is back in use', async ({ admin }, step) => {
    await step('a table of plants holds "Riverside" and "Sample plant"', () => plants(admin, 'Riverside', 'Sample plant'))
    await step('"Sample plant" is retired because "Not a real location"', () => retire(admin, 'Sample plant', 'Not a real location'))
    await step('the user reactivates "Sample plant"', async () => {
      const { session } = await openForm(admin, 'Sample plant')
      await inside(session, 'retired-notice', (notice) => notice.assertText('Not a real location'))
        .clickButton('Record actions')
        .clickButton('Reactivate')
        .until('the retired notice is gone', () => !screen.queryByTestId('retired-notice'))
    })
    await step('the list of plants shows "Riverside" and "Sample plant"', async () => {
      await openList(admin)
      expect((await shownPlants(2)).sort()).toEqual(['Riverside', 'Sample plant'])
    })
  }, 40_000)
})
