// runtime-pages' server scenarios (#1410): who may save a page, what a wrong
// page is told, and an agent building one through /mcp. The scenarios a
// person reads on screen are in apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import type { PagePart } from 'shared'
import { test } from '../pg-test'
import { expectApiError, expectRefused, makeTable } from '../fixtures'
import { scenarioFor } from '../scenario'
import { connectAgent, issueToken, type Agent } from '../agent-driver'

const scenario = scenarioFor(test, 'runtime-pages')

const PAGE = '/api/table/Page'
const text: PagePart = { id: 'hello', component: 'Text', text: 'What to reorder next month' }
const definition = (parts: PagePart[] = [text], more: Record<string, unknown> = {}) => ({
  version: '1.0',
  components: [{ id: 'root', component: 'Page', title: 'Reorder Plan', children: parts.map((part) => part.id) }, ...parts],
  ...more,
})
const reorderPlan = (def: unknown = definition()) => ({ row_id: 'reorder-plan', title: 'Reorder Plan', module: 'Reorder', definition: def })
const saved = async (admin: TestClient) => (await admin.get<{ data: unknown[] }>(`${PAGE}?fields=${encodeURIComponent('["row_id"]')}`)).data
const reorderLine = (admin: TestClient) => makeTable(admin, { name: 'Reorder Line', module: 'Reorder', columns: ['item', 'category', 'sold_qty:Int', 'planned_qty:Int'] })
const builderAgent = async (createUser: (opts?: { roles?: string[] }) => Promise<TestClient>) =>
  connectAgent(await issueToken(await createUser({ roles: ['System Manager'] })))

describe('runtime-pages', () => {
  scenario('Someone who may not build is refused', async ({ admin, createUser }, step) => {
    let viewer!: TestClient
    let save!: Promise<unknown>
    await step('a viewer who may not build Tables', async () => {
      viewer = await createUser()
    })
    await step('the viewer saves a page titled "Reorder Plan"', () => {
      save = viewer.post(PAGE, reorderPlan())
      save.catch(() => {})
    })
    await step('the save is refused', () => expectRefused(save, 403))
    await step('no page is saved', async () => expect(await saved(admin)).toEqual([]))
  })

  scenario('Two mistakes are both named', async ({ admin }, step) => {
    let save!: Promise<unknown>
    let fields: Record<string, string> = {}
    await step('the user may build Tables', () => {})
    await step('the user saves a page with a part that does not exist and a misspelled setting on another part', () => {
      save = admin.post(PAGE, reorderPlan(definition([{ id: 'spark', component: 'Sparkline' }, { ...text, varient: 'heading' }])))
      save.catch(() => {})
    })
    await step('the save is refused', async () => {
      const refusal = await expectRefused(save, 417, 'The page has 2 mistakes. Nothing was saved.')
      fields = (refusal as unknown as { fields: Record<string, string> }).fields
    })
    await step('the refusal names the part that does not exist', () =>
      expect(fields['components.spark.component']).toMatch(/^There is no part "Sparkline"\. The parts are: Page, Stack, /))
    await step('the refusal names the misspelled setting', () =>
      expect(fields['components.hello.varient']).toBe('Text has no setting "varient". Its settings: text, variant'))
    await step('no page is saved', async () => expect(await saved(admin)).toEqual([]))
  })

  scenario('A column the Table does not have is named', async ({ admin }, step) => {
    let save!: Promise<unknown>
    await step('a Table "Reorder Line" with no column "planed_qty"', () => reorderLine(admin))
    await step('the user saves a page that reads "planed_qty" from "Reorder Line"', () => {
      const table: PagePart = { id: 'plan', component: 'Table', caption: 'Plan', rows: { '@path': '/data/lines' }, columns: [{ id: 'planned', header: 'Planned', value: { '@path': 'planed_qty' } }] }
      save = admin.post(PAGE, reorderPlan(definition([table], { data: { lines: { table: 'Reorder Line' } } })))
      save.catch(() => {})
    })
    await step('the save is refused', () => expectRefused(save, 417, 'The page has a mistake. Nothing was saved.'))
    await step('the refusal says "Reorder Line" has no column "planed_qty"', async () => {
      const refusal = await expectApiError(save, { status: 417 })
      expect((refusal as unknown as { fields: Record<string, string> }).fields).toEqual({ 'components.plan.columns.0.value': '"Reorder Line" has no column "planed_qty"' })
    })
  })

  scenario('An agent reads the parts and saves a page', async ({ admin, createUser }, step) => {
    let agent!: Agent
    let catalog!: { parts: Record<string, unknown>; example: { components: unknown[] } }
    let answer!: { name: string; address: string; status: string }
    await step('an agent connected for a user who may build Tables', async () => {
      agent = await builderAgent(createUser)
    })
    await step('the agent asks which parts a page can be made of', async () => {
      catalog = await agent.ok('list_parts')
    })
    await step('the answer includes a table part and an example page', () => {
      expect(catalog.parts).toHaveProperty('Table')
      expect(catalog.example.components.length).toBeGreaterThan(1)
    })
    await step('the agent saves a page titled "Reorder Plan"', async () => {
      answer = await agent.ok('save_page', { name: 'reorder-plan', title: 'Reorder Plan', module: 'Reorder', definition: definition() })
    })
    await step('the agent is given the page\'s address', () => expect(answer.address).toBe('/featherbase/admin/page/reorder-plan'))
    await step('the page is a draft', async () => {
      expect(answer.status).toBe('Draft')
      expect(await admin.get(`${PAGE}/reorder-plan`)).toMatchObject({ title: 'Reorder Plan', status: 'Draft', module: 'Reorder' })
    })
  })

  scenario('An agent\'s new Table is listed in its group', async ({ admin, createUser }, step) => {
    let agent!: Agent
    await step('an agent connected for a user who may build Tables', async () => {
      agent = await builderAgent(createUser)
    })
    await step('the agent makes a Table "Reorder Line" in the group "Reorder"', async () => {
      await agent.ok('create_table', { table: 'Reorder Line', module: 'Reorder', columns: [{ name: 'item', type: 'Data' }] })
    })
    await step('"Reorder Line" is listed in the group "Reorder"', async () => {
      const { pages } = await admin.get<{ pages: { label: string; module: string | null; cards: { links: { link_to: string }[] }[] }[] }>('/api/home_pages')
      const group = pages.find((page) => page.module === 'Reorder')
      expect(group?.cards.flatMap((card) => card.links.map((link) => link.link_to))).toEqual(['Reorder Line'])
    })
  })
})
