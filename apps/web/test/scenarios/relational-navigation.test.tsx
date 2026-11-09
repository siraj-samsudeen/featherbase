// relational-navigation's scenarios, as a person reads them on screen (#1070:
// off the cucumber suite). Each test is one fenced scenario of the effective
// spec (openspec/changes/issue-910-relational-navigation/specs/
// relational-navigation/spec.md), step by step, rendered in jsdom against the
// real in-process server, over the organisation masters of
// ../organisation-fixture.ts. "The user" is the System Manager, unless a
// scenario signs them in again or limits what they read: then they are a
// person who may read the masters, and nothing more.
//
// jsdom lays nothing out, so "below" and "above" are read from document order
// and the pane's resolved place, and "quieter" from the group's empty mark;
// the pixels and colours themselves are a real browser's to show.
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, vi } from 'vitest'
import { rowHref, tableHref } from 'shared'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from '../pg-test'
import {
  add, ENCHAKKAL_PLANTS, PLANTS, SITE, limitRows, listColumns, readerRoles, seedOrganisation, type OrgIds,
} from '../organisation-fixture'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]
type View = Awaited<ReturnType<typeof renderApp>>
type CreateUser = (o: { email?: string; roles?: string[] }) => Promise<Client>
const scenario = scenarioFor(test, 'relational-navigation')

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A row's name, which its code may follow ("Enchakkal Supermarket · 1503"), and not a longer name. */
const named = (name: string) => new RegExp(`^\\W*${escape(name)}( · .+)?$`)
/** A group: "Plant 3", "Profit Centre 40". */
const groupNamed = (table: string) => new RegExp(`^${escape(table)}s?\\s*(\\d+)$`, 'i')
const countOf = (el: HTMLElement) => Number((el.textContent ?? '').replace(/\D+/g, ''))

const location = (view: View) => (view.router.state as { location: { pathname: string; searchStr: string } }).location
const history = (view: View) => (view.router as unknown as { history: { back: () => void; forward: () => void } }).history

// ---- the list ----

const listRows = () => [...screen.getByTestId('list-rows').querySelectorAll('tr')]
const rowTexts = () => listRows().map((r) => r.textContent ?? '')
const filterWords = () => screen.queryAllByTestId('filter-chip').map((c) => (c.textContent ?? '').replace('×', '').trim())

/** The list's line whose name (a link or button) is `name`. */
function rowNamed(name: string) {
  const line = listRows().find((r) => within(r).queryAllByRole('link', { name }).length + within(r).queryAllByRole('button', { name }).length > 0)
  if (!line) throw new Error(`no line of the list is named ${name}`)
  return line
}

/** Selects a row by clicking its line where nothing else is to be clicked. */
async function select(name: string) {
  const line = await waitFor(() => rowNamed(name))
  const plain = within(line).getAllByRole('cell').filter((c) =>
    !within(c).queryAllByRole('link').length && !within(c).queryAllByRole('button').length && !within(c).queryAllByRole('checkbox').length)
  fireEvent.click(plain.at(-1)!)
}

/** What the list shows: its address, its rows and its filters, once every linked name has arrived. */
async function snapshot(view: View) {
  await waitFor(() => {
    expect(listRows().length).toBeGreaterThan(0)
    expect(rowTexts().some((t) => t.includes('…'))).toBe(false)
  })
  return { at: location(view).pathname, rows: rowTexts(), filters: filterWords() }
}

async function openList(as: Client, table: string) {
  const view = await renderApp(tableHref(table), as)
  await waitFor(() => expect(listRows().length).toBeGreaterThan(0))
  return view
}

async function sitesNarrowedToKerala() {
  await waitFor(() => {
    expect(rowTexts()).toHaveLength(3)
    expect(filterWords()).toEqual(expect.arrayContaining([expect.stringContaining('Kerala')]))
  })
  expect(rowTexts().some((r) => r.includes('Tenkasi'))).toBe(false)
}

// ---- the drill pane ----

const pane = (name: string) => screen.findByRole('complementary', { name: named(name) })
const part = async (name: string, heading: string) => (await within(await pane(name)).findByRole('heading', { name: heading })).parentElement!
const group = async (name: string, table: string) => within(await pane(name)).findByRole('button', { name: groupNamed(table) })

async function openGroup(name: string, table: string) {
  const button = await group(name, table)
  fireEvent.click(button)
  await waitFor(async () => expect(await group(name, table)).toHaveAttribute('aria-pressed', 'true'))
}

/** The open group's rows (not its header). */
async function groupRows(name: string) {
  const table = await within(await pane(name)).findByRole('table')
  return waitFor(() => {
    const rows = within(table).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0)
    expect(rows.length).toBeGreaterThan(0)
    return rows
  })
}

async function drillTo(name: string, rowName: string) {
  const row = (await groupRows(name)).find((r) => r.textContent?.includes(rowName))!
  fireEvent.click(within(row).getAllByRole('cell')[0]!)
}

async function drillToSupermarket() {
  await openGroup('Enchakkal', 'Plant')
  await drillTo('Enchakkal', 'Enchakkal Supermarket')
  await pane('Enchakkal Supermarket')
}

/** The pane's "Filter" beside a linked value it points at. */
async function filterBy(name: string, value: string) {
  const pointsAt = await part(name, 'Points at')
  await waitFor(() => expect(pointsAt).toHaveTextContent(value))
  const filter = within(pointsAt).getAllByRole('button', { name: 'Filter' }).find((b) => {
    for (let el: HTMLElement | null = b.parentElement; el && el !== pointsAt; el = el.parentElement)
      if (el.textContent?.includes(value)) return true
    return false
  })!
  fireEvent.click(filter)
}

async function selectInSites(as: Client, name: string) {
  const view = await openList(as, SITE)
  const before = await snapshot(view)
  await select(name)
  await pane(name)
  return { view, before }
}

/** Sites list narrowed to Kerala from Enchakkal's pane, then drilled to the supermarket. */
async function walkThroughKerala(as: Client) {
  const { view } = await selectInSites(as, 'Enchakkal')
  await filterBy('Enchakkal', 'Kerala')
  await sitesNarrowedToKerala()
  await pane('Enchakkal')
  await drillToSupermarket()
  return view
}

/** Signs in again: a fresh page, nothing kept in the browser, only what the server remembers. */
function signInAfresh() {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
}

// ---- a row page: Form · Map · Tree ----

async function openRowPage(as: Client, table: string, row: string) {
  const view = await renderApp(rowHref(table, row), as)
  await screen.findByTestId('form-view')
  return view
}

const heading = () => screen.getAllByRole('heading', { level: 1 })[0]!
const showTab = async (name: string) => {
  fireEvent.click(await screen.findByRole('tab', { name }))
  await waitFor(() => expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true'))
}
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

const tree = () => screen.findByRole('tree')
/** The innermost line whose own name matches. */
async function line(name: string | RegExp, scope?: HTMLElement) {
  const pattern = typeof name === 'string' ? named(name) : name
  return (await within(scope ?? (await tree())).findAllByRole('treeitem', { name: pattern })).at(-1)!
}
async function unfold(item: HTMLElement) {
  if (item.getAttribute('aria-expanded') !== 'true') fireEvent.keyDown(item, { key: 'ArrowRight' })
  await waitFor(() => expect(item).toHaveAttribute('aria-expanded', 'true'))
  return item
}
const unfoldRow = async (name: string, scope?: HTMLElement) => unfold(await line(name, scope))
const unfoldGroup = async (table: string, scope?: HTMLElement) => unfold(await line(groupNamed(table), scope))
const treeGroupCount = async (table: string, scope?: HTMLElement) => countOf(await line(groupNamed(table), scope))

async function openTree(as: Client, table: string, row: string) {
  const view = await openRowPage(as, table, row)
  await showTab('Tree')
  await tree()
  return view
}

/** Enchakkal's tree unfolded: plants, the supermarket's profit centres, EKL - Retail (All). */
async function unfoldToRetail(admin: Client, org: OrgIds) {
  const view = await openTree(admin, SITE, org[SITE]!.Enchakkal!)
  const plants = await unfoldGroup('Plant')
  const supermarket = await unfoldRow('Enchakkal Supermarket', plants)
  const profitCentres = await unfoldGroup('Profit Centre', supermarket)
  return { view, retail: await unfoldRow('EKL - Retail (All)', profitCentres) }
}

describe('relational-navigation', () => {
  scenario("Enchakkal's plants are counted beside the site list", async ({ admin }, step) => {
    let view!: View
    let before!: Awaited<ReturnType<typeof snapshot>>
    await step('the site Enchakkal is in region Kerala and has three plants', () => seedOrganisation(admin))
    await step('the user selects Enchakkal in the list of sites', async () => {
      view = await openList(admin, SITE)
      before = await snapshot(view)
      await select('Enchakkal')
    })
    await step('the drill pane shows that Enchakkal points at the region Kerala', async () => {
      await pane('Enchakkal')
      const pointsAt = await part('Enchakkal', 'Points at')
      await waitFor(() => expect(pointsAt).toHaveTextContent('Kerala'))
    })
    await step('it shows a group of 3 plants that point at Enchakkal', async () =>
      expect(countOf(await group('Enchakkal', 'Plant'))).toBe(3))
    await step('the list of sites stays as it was', async () => expect(await snapshot(view)).toEqual(before))
  })

  scenario("Enchakkal's supermarket reads with its plant code", async ({ admin }, step) => {
    await step('the plant Enchakkal Supermarket has the plant code 1503', () => seedOrganisation(admin))
    await step('the user opens the list of profit centres', () => openList(admin, 'Profit Centre'))
    await step(`each profit centre's plant reads "Enchakkal Supermarket · 1503"`, async () => {
      await waitFor(() => {
        const plants = listRows().map((r) => (r.querySelector('[data-testid="cell-plant"]')?.textContent ?? '').trim())
        expect([...new Set(plants)]).toEqual(['Enchakkal Supermarket · 1503'])
      })
    })
  })

  scenario('Kerala opens beside the site list', async ({ admin }, step) => {
    let view!: View
    let before!: Awaited<ReturnType<typeof snapshot>>
    await step('the site Enchakkal is in region Kerala', () => seedOrganisation(admin))
    await step("the user clicks Kerala in Enchakkal's line of the list of sites", async () => {
      view = await openList(admin, SITE)
      before = await snapshot(view)
      const line = rowNamed('Enchakkal')
      fireEvent.click([...within(line).queryAllByRole('link', { name: 'Kerala' }), ...within(line).queryAllByRole('button', { name: 'Kerala' })][0]!)
    })
    await step('Kerala shows in the drill pane', () => pane('Kerala'))
    await step('the list of sites stays as it was', async () => expect(await snapshot(view)).toEqual(before))
  })

  scenario('From the site to its supermarket', async ({ admin }, step) => {
    let walk!: Awaited<ReturnType<typeof selectInSites>>
    await step('the user has Enchakkal open in the drill pane', async () => {
      await seedOrganisation(admin)
      walk = await selectInSites(admin, 'Enchakkal')
    })
    await step('the user opens its group of plants and clicks Enchakkal Supermarket', async () => {
      await openGroup('Enchakkal', 'Plant')
      await drillTo('Enchakkal', 'Enchakkal Supermarket')
    })
    await step('the drill pane shows Enchakkal Supermarket and what points at it', async () => {
      await part('Enchakkal Supermarket', 'Pointed at by')
      expect(countOf(await group('Enchakkal Supermarket', 'Profit Centre'))).toBe(40)
    })
    await step('the list of sites stays as it was', async () => expect(await snapshot(walk.view)).toEqual(walk.before))
  })

  scenario('Supplying and billing plants', async ({ admin }, step) => {
    let org!: OrgIds
    /** A group named by its table and the link it comes through: "Cost Centre · Supplying plant 8". */
    const viaGroup = async (link: string, count: number) =>
      within(await pane('Enchakkal Supermarket')).findByRole('button', { name: new RegExp(`^Cost Centres? · ${link}\\s*${count}$`, 'i') })
    await step('each cost centre names a supplying plant and a billing plant', async () => {
      org = await seedOrganisation(admin)
    })
    await step('Enchakkal Supermarket supplies 8 cost centres and bills none', async () => {
      for (let i = 1; i <= 8; i++)
        await add(admin, 'Cost Centre', { row_id: `15039900${i}`, name: `EKL-Supply ${i}`,
          profit_centre: org['Profit Centre']!['EKL - Retail (All)'], supplying_plant: org.Plant!['Enchakkal Supermarket'] })
    })
    await step('the user opens Enchakkal Supermarket in the drill pane', async () => {
      await openList(admin, 'Plant')
      await select('Enchakkal Supermarket')
      await pane('Enchakkal Supermarket')
    })
    await step('a group of 8 cost centres by supplying plant shows', () => viaGroup('Supplying plant', 8))
    await step('a group of 0 cost centres by billing plant shows, quieter than the other', async () => {
      const empty = await viaGroup('Billing plant', 0)
      // The empty group carries the mark that mutes it; the full one doesn't.
      expect(empty).toHaveAttribute('data-empty')
      expect(await viaGroup('Supplying plant', 8)).not.toHaveAttribute('data-empty')
    })
  })

  scenario("Enchakkal's plants with their columns", async ({ admin }, step) => {
    await step('the user has Enchakkal open in the drill pane', async () => {
      await seedOrganisation(admin)
      await selectInSites(admin, 'Enchakkal')
    })
    await step('the user opens its group of plants', () => openGroup('Enchakkal', 'Plant'))
    await step('the 3 plants show with the columns of the list of plants', async () => {
      await waitFor(async () => expect(await groupRows('Enchakkal')).toHaveLength(3))
      const rows = (await groupRows('Enchakkal')).map((r) => r.textContent ?? '')
      for (const name of ENCHAKKAL_PLANTS) expect(rows.some((r) => r.includes(name)), `${name} is among the plants`).toBe(true)
      const columns = within(within(await pane('Enchakkal')).getByRole('table')).getAllByRole('columnheader')
        .map((h) => (h.textContent ?? '').replace(/[↑↓]/g, '').trim())
      for (const label of listColumns('Plant')) expect(columns).toContain(label)
    })
  })

  scenario("Enchakkal's plants as a list", async ({ admin }, step) => {
    let view!: View
    await step('the user has Enchakkal open in the drill pane', async () => {
      await seedOrganisation(admin)
      ;({ view } = await selectInSites(admin, 'Enchakkal'))
    })
    await step('the user opens its group of plants as a list', async () => {
      await openGroup('Enchakkal', 'Plant')
      fireEvent.click(await within(await pane('Enchakkal')).findByRole('link', { name: 'Open as list' }))
    })
    await step('the list of plants opens, narrowed to the 3 plants of Enchakkal', async () => {
      await waitFor(() => expect(location(view).pathname).toBe(tableHref('Plant')))
      await waitFor(() => expect(rowTexts()).toHaveLength(3))
      for (const name of ENCHAKKAL_PLANTS) expect(rowTexts().some((r) => r.includes(name)), `${name} is listed`).toBe(true)
      expect(filterWords().length).toBeGreaterThan(0)
    })
  })

  scenario('A new plant for Enchakkal', async ({ admin }, step) => {
    let view!: View
    await step("the user may add plants and has Enchakkal's plants open as a list", async () => {
      await seedOrganisation(admin)
      ;({ view } = await selectInSites(admin, 'Enchakkal'))
      await openGroup('Enchakkal', 'Plant')
      fireEvent.click(await within(await pane('Enchakkal')).findByRole('link', { name: 'Open as list' }))
      await waitFor(() => expect(location(view).pathname).toBe(tableHref('Plant')))
    })
    await step('the user starts a new plant', async () => {
      fireEvent.click(await screen.findByRole('link', { name: 'New' }))
      await waitFor(() => expect(location(view).pathname).toBe(`${tableHref('Plant')}/new`))
    })
    await step("the new plant's site is already Enchakkal", async () => {
      const form = await screen.findByTestId('form-view')
      await waitFor(() => expect(within(form).getByLabelText('Site', { exact: true })).toHaveValue('Enchakkal'))
    })
  })

  scenario("Only Kerala's sites", async ({ admin }, step) => {
    let view!: View
    await step('the user has Enchakkal open in the drill pane over the list of sites', async () => {
      await seedOrganisation(admin)
      ;({ view } = await selectInSites(admin, 'Enchakkal'))
    })
    await step("the user narrows the list by Enchakkal's region Kerala", () => filterBy('Enchakkal', 'Kerala'))
    await step('the list of sites shows only sites in Kerala', async () => {
      expect(location(view).pathname).toBe(tableHref(SITE))
      await sitesNarrowedToKerala()
    })
    await step("the filter shows as one of the list's filters, which the user can remove", () => {
      expect(filterWords().some((w) => w.includes('Kerala'))).toBe(true)
      expect(within(screen.getAllByTestId('filter-chip')[0]!).getByRole('button', { name: 'Remove filter' })).toBeVisible()
    })
  })

  scenario("Enchakkal's fields at a glance", async ({ admin }, step) => {
    let view!: View
    await step('the site Enchakkal has a long note and two empty fields', () => seedOrganisation(admin))
    await step("the user reads Enchakkal's fields in the drill pane", async () => {
      ;({ view } = await selectInSites(admin, 'Enchakkal'))
      const fields = await within(await pane('Enchakkal')).findByRole('button', { name: 'Fields' })
      if (fields.getAttribute('aria-pressed') !== 'true') fireEvent.click(fields)
    })
    await step('the note is shortened with a way to read all of it', async () => {
      const more = await within(await pane('Enchakkal')).findByRole('button', { name: 'Show more' })
      expect(more).toBeVisible()
      expect(more).toHaveAttribute('aria-expanded', 'false')
    })
    await step('the two empty fields are folded away under a count', async () =>
      expect(await within(await pane('Enchakkal')).findByText(/^\d+ empty fields?$/)).toHaveTextContent('2 empty fields'))
    await step("the user can open Enchakkal's form to edit it", async () => {
      fireEvent.click(await within(await pane('Enchakkal')).findByRole('link', { name: 'Open row page' }))
      await waitFor(() => expect(location(view).pathname.startsWith(`${tableHref(SITE)}/row/`)).toBe(true))
      const name = await waitFor(() => within(screen.getByTestId('form-view')).getByLabelText('Name', { exact: true }))
      await waitFor(() => expect(name).toHaveValue('Enchakkal'))
      expect(name).not.toHaveAttribute('readonly')
      expect(name).toBeEnabled()
    })
  })

  scenario('Back to the site from its supermarket', async ({ admin }, step) => {
    await step('the user narrowed the list of sites to Kerala, selected Enchakkal and drilled to Enchakkal Supermarket', async () => {
      await seedOrganisation(admin)
      await walkThroughKerala(admin)
    })
    await step('the user chooses the step named Enchakkal on the path', () => {
      const path = screen.getByRole('navigation', { name: 'Path' })
      fireEvent.click(within(path).getAllByRole('button', { name: /(^|\s)Enchakkal$/ })[0]!)
    })
    await step('the drill pane shows Enchakkal again with the same group open', async () => {
      await pane('Enchakkal')
      await waitFor(async () => expect(await group('Enchakkal', 'Plant')).toHaveAttribute('aria-pressed', 'true'))
    })
    await step('the list of sites is still narrowed to Kerala', () => sitesNarrowedToKerala())
  })

  scenario("The browser's back button returns to Enchakkal", async ({ admin }, step) => {
    let view!: View
    await step('the user drilled from Enchakkal to Enchakkal Supermarket', async () => {
      await seedOrganisation(admin)
      ;({ view } = await selectInSites(admin, 'Enchakkal'))
      await drillToSupermarket()
    })
    await step("the user presses the browser's back button", () => history(view).back())
    await step('the drill pane shows Enchakkal again', () => pane('Enchakkal'))
    await step('going forward shows Enchakkal Supermarket again', async () => {
      history(view).forward()
      await pane('Enchakkal Supermarket')
    })
  })

  scenario('A colleague opens the supermarket step', async ({ admin, createUser }, step) => {
    let link = ''
    let view!: View
    await step('the user copied the link of the step showing Enchakkal Supermarket', async () => {
      await seedOrganisation(admin)
      await walkThroughKerala(admin)
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
      link = String(writeText.mock.calls[0]![0])
      expect(link).toMatch(/^https?:\/\//)
    })
    await step('a colleague who can read sites and plants opens that link', async () => {
      // Kerala names the filter, so the colleague reads regions too.
      const colleague = await (createUser as CreateUser)({ email: 'colleague@example.com', roles: await readerRoles(admin, ['Region', SITE, 'Plant']) })
      signInAfresh()
      const url = new URL(link)
      view = await renderApp(url.pathname + url.search, colleague)
    })
    await step('the colleague sees the list of sites narrowed to Kerala', async () => {
      expect(location(view).pathname).toBe(tableHref(SITE))
      await sitesNarrowedToKerala()
    })
    await step('Enchakkal Supermarket in the drill pane', () => pane('Enchakkal Supermarket'))
  })

  scenario("Yesterday's walk is still there", async ({ admin, createUser }, step) => {
    let user!: Client
    let items: HTMLElement[] = []
    await step('the user walked from the list of sites to Enchakkal Supermarket yesterday', async () => {
      await seedOrganisation(admin)
      user = await (createUser as CreateUser)({ email: 'walker@example.com', roles: await readerRoles(admin) })
      await selectInSites(user, 'Enchakkal')
      await drillToSupermarket()
      // The walk is saved to the person's settings before the next sign-in.
      await waitFor(async () => {
        const { settings } = await user.get<{ settings: { recentPaths?: unknown[] } | null }>('/api/user_settings/__navigation')
        expect(JSON.stringify(settings?.recentPaths ?? [])).toContain('1503')
      })
    })
    await step('the user signs in today and looks at their recent paths', async () => {
      signInAfresh()
      await openList(user, SITE)
      fireEvent.click(await screen.findByRole('button', { name: 'Recent paths' }))
      items = await screen.findAllByRole('menuitem')
    })
    await step('that path is listed by its names', async () => {
      // The names arrive after the menu opens; an ellipsis stands in until then.
      await waitFor(() => {
        items = screen.getAllByRole('menuitem')
        expect(items.map((i) => (i.textContent ?? '').replace(/\s+/g, ' '))).toEqual(expect.arrayContaining([expect.stringContaining('Enchakkal Supermarket')]))
      })
    })
    await step('choosing it brings back Enchakkal Supermarket in the drill pane', async () => {
      fireEvent.click(items.find((i) => i.textContent?.includes('Enchakkal Supermarket'))!)
      await pane('Enchakkal Supermarket')
    })
  })

  scenario('The pane stays where the user put it', async ({ admin, createUser }, step) => {
    let user!: Client
    await step('the user fixed the drill pane below the list', async () => {
      await seedOrganisation(admin)
      user = await (createUser as CreateUser)({ email: 'placer@example.com', roles: await readerRoles(admin) })
      await selectInSites(user, 'Enchakkal')
      fireEvent.click(within(await screen.findByRole('group', { name: 'Pane place' })).getByRole('button', { name: 'Bottom' }))
      await waitFor(async () => {
        const { settings } = await user.get<{ settings: { panePlace?: string } | null }>('/api/user_settings/__navigation')
        expect(settings?.panePlace).toBe('bottom')
      })
    })
    await step('the user signs in again and selects Enchakkal', async () => {
      signInAfresh()
      await openList(user, SITE)
      await select('Enchakkal')
    })
    await step('the drill pane opens below the list', async () => {
      const site = await pane('Enchakkal')
      expect(site).toHaveAttribute('data-place', 'bottom')
      expect(follows(listRows().at(-1)!, site)).toBe(true)
    })
  })

  scenario("Enchakkal's page leads with its plants", async ({ admin }, step) => {
    let org!: OrgIds
    await step('the site Enchakkal has three plants', async () => {
      org = await seedOrganisation(admin)
    })
    await step("the user opens Enchakkal's page", () => openRowPage(admin, SITE, org[SITE]!.Enchakkal!))
    await step('its region Kerala and a group of 3 plants show under its name', async () => {
      await waitFor(() => expect(heading()).toHaveTextContent('Enchakkal'))
      const kerala = await waitFor(() => {
        const found = [...screen.queryAllByRole('button', { name: /^Kerala\b/ }), ...screen.queryAllByRole('link', { name: /^Kerala\b/ })][0]
        if (!found) throw new Error('Kerala does not show under Enchakkal\'s name')
        return found
      })
      expect(kerala).toBeVisible()
      expect(follows(heading(), kerala)).toBe(true)
      const plants = await screen.findByRole('button', { name: groupNamed('Plant') })
      expect(countOf(plants)).toBe(3)
      expect(follows(heading(), plants)).toBe(true)
    })
    await step('opening the plants shows them in the drill pane', async () => {
      fireEvent.click(screen.getByRole('button', { name: groupNamed('Plant') }))
      await pane('Enchakkal')
      const rows = (await groupRows('Enchakkal')).map((r) => r.textContent ?? '')
      for (const name of ENCHAKKAL_PLANTS) expect(rows.some((r) => r.includes(name)), `${name} is in the drill pane`).toBe(true)
    })
  })

  scenario("Enchakkal's tree survives a look at the form", async ({ admin }, step) => {
    await step("the user expanded Enchakkal's plants on its tree", async () => {
      const org = await seedOrganisation(admin)
      await openTree(admin, SITE, org[SITE]!.Enchakkal!)
      await unfoldGroup('Plant')
      // …and one plant deeper, which no tree unfolds on its own.
      await unfoldRow('Enchakkal Supermarket')
    })
    await step('the user switches to the form and back to the tree', async () => {
      await showTab('Form')
      await showTab('Tree')
    })
    await step("Enchakkal's plants are still expanded", async () => {
      expect(await line(groupNamed('Plant'))).toHaveAttribute('aria-expanded', 'true')
      expect(await line('Enchakkal Supermarket')).toBeVisible()
      expect(await line('Enchakkal Supermarket')).toHaveAttribute('aria-expanded', 'true')
    })
  })

  scenario('Kerala in the pane, Enchakkal in the middle', async ({ admin }, step) => {
    await step("the user is looking at Enchakkal's map", async () => {
      const org = await seedOrganisation(admin)
      await openRowPage(admin, SITE, org[SITE]!.Enchakkal!)
      await showTab('Map')
      await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Enchakkal'))
    })
    await step('the user clicks the region Kerala on the map', async () => {
      fireEvent.click(await screen.findByTestId('map-forward-Region'))
    })
    await step('Kerala shows in the drill pane', () => pane('Kerala'))
    await step('the map is still centred on Enchakkal', () => expect(screen.getByTestId('map-center')).toHaveTextContent('Enchakkal'))
    await step('choosing to centre on Kerala redraws the map around Kerala', async () => {
      // #910 checklist 17: the drill pane's "Focus here" re-centres the map.
      fireEvent.click(await within(await pane('Kerala')).findByRole('button', { name: 'Focus here' }))
      await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Kerala'))
      expect(await screen.findByTestId(`map-group-${SITE}`)).toBeVisible()
    })
  })

  scenario('A cost centre from the tree', async ({ admin }, step) => {
    let org!: OrgIds
    let view!: View
    await step("the user unfolded Enchakkal's tree down to the cost centre EKL-Marketing", async () => {
      org = await seedOrganisation(admin)
      const walk = await unfoldToRetail(admin, org)
      view = walk.view
      await unfoldGroup('Cost Centre', walk.retail)
      expect(await line('EKL-Marketing')).toBeVisible()
    })
    await step('the user clicks EKL-Marketing on the tree', async () => {
      const item = await line('EKL-Marketing')
      fireEvent.click(within(item).getAllByText(named('EKL-Marketing')).at(-1)!)
    })
    await step('EKL-Marketing shows in the drill pane', () => pane('EKL-Marketing'))
    await step('the tree is still centred on Enchakkal', async () => {
      expect(heading()).toHaveTextContent('Enchakkal')
      expect(heading()).not.toHaveTextContent('Kerala')
      expect(location(view).pathname).toContain(encodeURIComponent(org[SITE]!.Enchakkal!))
      expect(await tree()).toBeVisible()
    })
  })

  scenario('From the site down to a cost centre', async ({ admin }, step) => {
    let retail!: HTMLElement
    let org!: OrgIds
    await step("Enchakkal Supermarket is one of Enchakkal's plants", async () => {
      org = await seedOrganisation(admin)
    })
    await step("the user unfolds Enchakkal's plants, then Enchakkal Supermarket's profit centres, then EKL - Retail (All)", async () => {
      ;({ retail } = await unfoldToRetail(admin, org))
    })
    await step('the cost centres of EKL - Retail (All) show beneath it', async () => {
      expect(await treeGroupCount('Cost Centre', retail)).toBe(4)
      expect(follows(await line('EKL - Retail (All)'), await line(groupNamed('Cost Centre'), retail))).toBe(true)
    })
    await step('the region Kerala shows above Enchakkal', async () => {
      const t = await tree()
      const enchakkal = within(t).getAllByText(named('Enchakkal'))[0]!
      expect(follows(await line('Kerala'), enchakkal)).toBe(true)
    })
  })

  scenario('The first 20 of 40 profit centres', async ({ admin }, step) => {
    let centres!: HTMLElement
    await step('Enchakkal Supermarket has 40 profit centres', () => seedOrganisation(admin))
    await step('the user unfolds them on the tree', async () => {
      await openTree(admin, 'Plant', '1503')
      centres = await unfoldGroup('Profit Centre')
    })
    await step('the first 20 profit centres show, with a way to show all 40', async () => {
      await waitFor(() => expect(within(within(centres).getAllByRole('group')[0]!).getAllByRole('treeitem')).toHaveLength(20))
      expect(within(centres).getAllByRole('button', { name: /\b40\b/ })[0]).toBeVisible()
    })
  })

  scenario('A plant the user may not read', async ({ admin, createUser }, step) => {
    const hidden = 'Enchakkal Hardware'
    let user!: Client
    let org!: OrgIds
    const seen: { paneCount?: number; paneText?: string; treeCount?: number; treeText?: string } = {}
    await step("the user may read sites but not one of Enchakkal's three plants", async () => {
      org = await seedOrganisation(admin)
      user = await (createUser as CreateUser)({ email: 'limited@example.com', roles: await readerRoles(admin) })
      await limitRows(admin, user.user!, 'Plant', PLANTS.filter((p) => p.name !== hidden).map((p) => p.row_id))
    })
    await step('the user opens Enchakkal in the drill pane and on its tree', async () => {
      await selectInSites(user, 'Enchakkal')
      seen.paneCount = countOf(await group('Enchakkal', 'Plant'))
      await openGroup('Enchakkal', 'Plant')
      await groupRows('Enchakkal')
      seen.paneText = document.body.textContent ?? ''
      cleanup()
      await openTree(user, SITE, org[SITE]!.Enchakkal!)
      seen.treeCount = await treeGroupCount('Plant')
      await unfoldGroup('Plant')
      expect(await line('Enchakkal Supermarket')).toBeVisible()
      seen.treeText = document.body.textContent ?? ''
    })
    await step('the group of plants counts 2', () => {
      expect(seen.paneCount, 'the drill pane counts the plant the user may not read').toBe(2)
      expect(seen.treeCount, 'the tree counts the plant the user may not read').toBe(2)
    })
    await step('the name of the third plant shows nowhere', () => {
      expect(seen.paneText).not.toContain(hidden)
      expect(seen.treeText).not.toContain(hidden)
    })
  })
})
