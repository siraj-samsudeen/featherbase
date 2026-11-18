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
import { expectRefused } from '../fixtures'

const scenario = scenarioFor(test, 'glossary')
const shelves = resolve('../..', 'test-apps/fixtures/shelves-v1')

interface Term { id: string; term: string; app: string | null; appTitle: string | null; definition: string }
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

describe('a repeated word shows where each meaning comes from', () => {
  scenario('One word, two sources', async ({ admin }, step) => {
    await step('a shelf-planning app defines "Shelf Lead"', () => installShelves(admin))
    await step('the instance has its own term "Shelf Lead"', () => addTerm(admin, 'Shelf Lead', 'The company meaning.'))
    await step('the user opens the shelf-planning glossary')
    const { terms } = await glossaryOf(admin, 'shelves')
    const lead = terms.filter(t => t.term === 'Shelf Lead')
    await step('"Shelf Lead" is listed twice', () => { expect(lead).toHaveLength(2) })
    await step('one is marked as coming from the shelf-planning app and the other as shared across apps', () => {
      expect(lead.map(t => t.app)).toEqual(['shelves', null])
      expect(lead.map(t => t.appTitle)).toEqual(['Shelves', null])
    })
  })
})
