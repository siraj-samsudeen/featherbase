// dashboards-and-home-pages' fenced scenarios (#1070), rendered in jsdom
// against the real in-process server. Each test is one scenario of
// openspec/specs/dashboards-and-home-pages/spec.md, step by step: the System
// home page keeps its curated groups and lists every standalone system Table.
import { screen, waitFor } from '@testing-library/react'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { tableHref } from 'shared'
import { sql } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from '../pg-test'

const scenario = scenarioFor(test, 'dashboards-and-home-pages')

type Table = { name: string; label: string }
type Hint = { label: string | null; type: string; link_to: string | null }
type Card = { heading: string; links: { name: string; label: string; path: string }[] }

/** What the System page should hold, read from metadata, not from the home-pages response whose completeness is at issue. */
async function rememberCatalogue() {
  const catalogue = (await sql`
    select name, coalesce(nullif(label, ''), name) as label
    from table_def where system = true and kind != 'sub_table'
    order by name collate "C"`) as unknown as Table[]
  const hints = (await sql`
    select label, type, link_to from home_page_link
    where parent = 'system' and parenttype = 'Home Page'
    order by position, row_id`) as unknown as Hint[]
  expect(catalogue.length, 'the baseline must contain system Tables').toBeGreaterThan(0)
  expect(hints.some((hint) => hint.type === 'Card Break'), 'the baseline must contain curated groups').toBe(true)
  return { catalogue, hints }
}

function expectedGroups({ catalogue, hints }: { catalogue: Table[]; hints: Hint[] }) {
  const eligible = new Map(catalogue.map((table) => [table.name, table]))
  const seen = new Set<string>()
  const groups: { heading: string; links: Table[] }[] = []
  let current: { heading: string; links: Table[] } | undefined
  for (const hint of hints) {
    if (hint.type === 'Card Break') {
      current = { heading: hint.label || 'Tables', links: [] }
      groups.push(current)
    } else if (hint.link_to && eligible.has(hint.link_to) && !seen.has(hint.link_to)) {
      if (!current) { current = { heading: 'Tables', links: [] }; groups.push(current) }
      current.links.push(eligible.get(hint.link_to)!)
      seen.add(hint.link_to)
    }
  }
  return {
    curated: groups.filter((group) => group.links.length > 0),
    unplaced: catalogue.filter((table) => !seen.has(table.name)),
  }
}

const expectedLinks = (tables: Table[]) => tables.map((table) => ({ name: table.name, label: table.label, path: tableHref(table.name) }))

function cards(): Card[] {
  return [...screen.getByTestId('home-page-cards').querySelectorAll(':scope > div')].map((card) => ({
    heading: card.querySelector('[data-testid="home-card-heading"]')!.textContent!.trim(),
    links: [...card.querySelectorAll('a')].map((link) => ({
      name: link.getAttribute('data-testid')!.slice('home-link-'.length),
      label: link.textContent!.trim(),
      path: new URL(link.href).pathname,
    })),
  }))
}

async function openSystem(admin: TestClient) {
  await renderApp('/featherbase/admin/home/system', admin)
  const title = await screen.findByTestId('home-page-title', {}, { timeout: 8000 })
  expect(title.textContent!.trim()).toBe('System')
  await waitFor(() => expect(screen.getByTestId('home-page-cards').querySelector('a')).not.toBeNull(), { timeout: 8000 })
}

describe('dashboards-and-home-pages', () => {
  scenario('System keeps useful groups without losing unplaced Tables', async ({ admin }, step) => {
    let baseline: Awaited<ReturnType<typeof rememberCatalogue>>
    await step('the user can manage the platform', async () => {
      baseline = await rememberCatalogue()
    })
    await step('the user opens System', () => openSystem(admin))
    await step('the existing system groups retain their order', () => {
      const { curated } = expectedGroups(baseline)
      const actual = cards()
      expect(actual.slice(0, curated.length).map((card) => card.heading)).toEqual(curated.map((group) => group.heading))
      for (const [index, group] of curated.entries())
        expect(actual[index]!.links.slice(0, group.links.length), 'stored system groups and their link order must be retained with effective labels')
          .toEqual(expectedLinks(group.links))
    })
    await step('unplaced system Tables appear under Platform in name order', () => {
      const { curated, unplaced } = expectedGroups(baseline)
      expect(unplaced.length, 'the baseline must exercise unplaced Tables').toBeGreaterThan(0)
      const expected: Card[] = curated.map((group) => ({ heading: group.heading, links: expectedLinks(group.links) }))
      let platform = expected.find((card) => card.heading === 'Platform')
      if (!platform) { platform = { heading: 'Platform', links: [] }; expected.push(platform) }
      platform.links.push(...expectedLinks(unplaced))
      expect(cards(), 'unmatched system Tables must be appended in name order').toEqual(expected)
    })
  })

  scenario('System includes all standalone system Tables', async ({ admin }, step) => {
    let baseline: Awaited<ReturnType<typeof rememberCatalogue>>
    await step('the user can manage the platform', async () => {
      baseline = await rememberCatalogue()
    })
    await step('the user opens System', () => openSystem(admin))
    await step('System contains every standalone system Table exactly once', () => {
      const links = cards().flatMap((card) => card.links)
      const actual = [...links].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      expect(actual, 'System must show exactly the eligible catalogue, including Settings and excluding sub-tables').toEqual(expectedLinks(baseline.catalogue))
    })
  })

  scenario('A new system Table appears without navigation setup', async ({ admin }, step) => {
    const fixture = { name: 'Acceptance System Probe', relation: 'acceptance_system_probe', label: 'New acceptance system Table' }
    await step('the user can manage the platform', () => rememberCatalogue())
    await step('a new system Table has no navigation entry', async () => {
      // Privileged fixture: creating a Table through the API refuses system=true,
      // and no navigation helper is called.
      await sql.unsafe(`create table featherbase.${fixture.relation} (row_id text primary key)`)
      await sql`insert into table_def (name, module, system, kind, label) values (${fixture.name}, 'Core', true, 'table', ${fixture.label})`
      invalidateMeta()
      expect(await sql`select row_id from home_page_link where link_to = ${fixture.name}`, 'the fixture must have no navigation entry anywhere').toHaveLength(0)
    })
    await step('the user opens System', () => openSystem(admin))
    await step('the new system Table appears under Platform', () => {
      const platform = cards().filter((card) => card.heading === 'Platform')
      expect(platform, 'System must have a Platform group').toHaveLength(1)
      expect(platform[0]!.links.filter((link) => link.name === fixture.name)).toEqual(expectedLinks([fixture]))
      expect(cards().flatMap((card) => card.links).filter((link) => link.name === fixture.name)).toHaveLength(1)
    })
  })
})
