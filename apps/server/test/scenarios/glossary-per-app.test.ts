// glossary's per-app scenarios (the owner, 18-Nov-2026): each app has its own
// glossary, one meaning per word. Each test is one fenced scenario of the
// glossary change's spec, step by step. The shelf-planning app is the shelves
// fixture; the Help menu scenario is in apps/web/test/scenarios/.
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { discoverPackages } from '../../src/runtime-packages'
import { sql } from '../../src/db'
import { expectApiError, expectRefused } from '../fixtures'

const scenario = scenarioFor(test, 'glossary')
const shelves = resolve('../..', 'test-apps/fixtures/shelves-v1')

interface Term { id: string; term: string; app: string | null; definition: string }
const glossaryOf = (client: TestClient, app: string) => client.get<{ terms: Term[] }>(`/api/glossary?app=${app}`)
const addTerm = (client: TestClient, term: string, definition: string) =>
  client.post('/api/save_row', { table: 'Glossary Term', row: { term, definition } })
async function installShelves(admin: TestClient) {
  expect(await discoverPackages([shelves])).toEqual([])
  await admin.post('/api/install_app', { name: 'shelves' })
}

describe('each app has its own glossary', () => {
  scenario('An app\'s glossary holds its words and the company\'s', async ({ admin }, step) => {
    await step('a shelf-planning app defines "Shelf Lead" and "Coverage"', () => installShelves(admin))
    await step('the instance has a term of its own, "Cluster"', () => addTerm(admin, 'Cluster', 'A group of stores.'))
    await step('the user opens the shelf-planning glossary')
    const { terms } = await glossaryOf(admin, 'shelves')
    await step('it lists "Coverage" and "Shelf Lead", then "Cluster"', () => {
      expect(terms.map(t => [t.app, t.term])).toEqual([['shelves', 'Coverage'], ['shelves', 'Shelf Lead'], [null, 'Cluster']])
    })
  })

  scenario('A person who cannot use the app cannot read its glossary', async ({ admin, createUser }, step) => {
    await step('a person who cannot use the shelf-planning app', async () => {
      await installShelves(admin)
      await sql`delete from permission where ref_table = 'shelves.assignment'`
    })
    const staff = await createUser({ email: 'staff@example.test' })
    await step('the person asks for the shelf-planning glossary')
    await step('they are refused', () => expectRefused(glossaryOf(staff, 'shelves'), 403))
  })
})

describe('one meaning per word', () => {
  scenario('The instance cannot take an app\'s word', async ({ admin }, step) => {
    await step('a shelf-planning app defines "Shelf Lead"', () => installShelves(admin))
    await step('a System Manager adds an instance term "shelf lead"')
    await step('it is refused, and the reason names the shelf-planning app', () =>
      expectApiError(addTerm(admin, 'shelf lead', 'Mine.'), { status: 417, message: expect.stringContaining('already a term in Shelves') }))
  })

  scenario('Two instance terms cannot share a name', async ({ admin }, step) => {
    await step('the instance has a term "Cluster"', () => addTerm(admin, 'Cluster', 'A group of stores.'))
    await step('a System Manager adds another instance term "CLUSTER"')
    await step('it is refused', () =>
      expectApiError(addTerm(admin, 'CLUSTER', 'Another.'), { status: 417, message: expect.stringContaining('already a term of this instance') }))
  })

  scenario('An app that arrives later keeps its own meaning', async ({ admin }, step) => {
    await step('the instance has a term "Shelf Lead"', () => addTerm(admin, 'Shelf Lead', 'The company\'s meaning.'))
    await step('a shelf-planning app that defines "Shelf Lead" is installed')
    await step('the install goes through', () => installShelves(admin))
    await step('the shelf-planning glossary shows the app\'s "Shelf Lead" and not the instance\'s', async () => {
      const lead = (await glossaryOf(admin, 'shelves')).terms.filter(t => t.term === 'Shelf Lead')
      expect(lead.map(t => t.app)).toEqual(['shelves'])
      expect(lead[0]!.definition).not.toBe('The company\'s meaning.')
    })
  })
})
