// admin-ui-feedback's scenarios (#1070): the command bar as a person uses it,
// the real Admin in jsdom against the in-process server. Each test is one
// fenced scenario of openspec/specs/admin-ui-feedback/spec.md, step by step.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, vi } from 'vitest'
import { grantRole } from 'server/test/fixtures'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp, onScreen } from '../pg-test'

type Admin = Parameters<typeof renderApp>[1]
type User = ReturnType<typeof userEvent.setup>
const scenario = scenarioFor(test, 'admin-ui-feedback')

const TABLE = 'Sign In Method'
const LIST_PATH = '/featherbase/admin/table/sign-in-method'
const here = (r: { router: unknown }) =>
  decodeURIComponent((r.router as { state: { location: { pathname: string } } }).state.location.pathname)
const input = () => screen.getByRole('textbox', { name: 'Search or type a command' }) as HTMLInputElement
const dropdown = () => screen.queryByTestId('awesomebar-results')
const options = () => within(screen.getByTestId('awesomebar-results')).getAllByRole('option')
const T = { timeout: 8000 }
// The record hit for Person's own definition: its title, then its kind.
const personDefinition = () => {
  const found = screen.queryAllByTestId('awesomebar-doc').find((e) => /^Person\s*Table definition$/.test(e.textContent ?? ''))
  if (!found) throw new Error('no "Person Table definition" result')
  expect(found).toHaveAttribute('role', 'option')
  return found
}

/** ⌘K, as the person presses it: the bar takes the focus. */
async function open(user: User) {
  await onScreen().pressKey('Meta+k')
  expect(document.activeElement).toBe(input())
}

/** Replace what the bar holds, as a person retyping it. */
async function fill(_user: User, text: string) {
  await onScreen().fillIn('Search or type a command…', text)
}

/** The Sign In Method list, with the total the server reported. */
async function expectSignInMethods(app: { router: unknown }, total: number) {
  expect(here(app)).toBe(LIST_PATH)
  const list = await screen.findByTestId('list-view', {}, T)
  await waitFor(() => expect(within(list).getByRole('heading', { level: 1, name: /^Sign In Method(?:\s|$)/ })).toBeInTheDocument(), T)
  // A fresh instance can have no configured methods: the count is the server's.
  await waitFor(() => expect(within(list).getByTestId('list-total')).toHaveTextContent(`${total} total`), T)
  expect(within(list).queryByTestId('list-rows-error')).toBeNull()
}

async function visitSignInMethods(admin: Admin) {
  const result = await admin.get<{ data: unknown[]; total: number }>(`/api/table/${encodeURIComponent(TABLE)}`)
  expect(Array.isArray(result.data)).toBe(true)
  const app = await renderApp(LIST_PATH, admin)
  await expectSignInMethods(app, result.total)
  return { app, total: result.total }
}

async function searchSignInMethods(user: User) {
  await open(user)
  await fill(user, TABLE)
  await waitFor(() => expect(screen.getAllByTestId('awesomebar-table').some((e) => e.textContent?.includes(TABLE))).toBe(true), T)
  await onScreen().pressKey('Enter')
}

async function searchPerson(admin: Admin, user: User) {
  const app = await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findAllByTestId('all-tables-link', {}, T)
  await open(user)
  await fill(user, 'Person')
  await waitFor(personDefinition, T)
  return app
}

async function choosePersonResult(user: User, kind: 'new' | 'record') {
  // Person's own new-row choice: an installed app may offer another.
  const target = () =>
    kind === 'new'
      ? screen.getAllByTestId('awesomebar-new').find((e) => e.getAttribute('role') === 'option' && e.textContent?.trim() === '+ New Person row')!
      : personDefinition()
  const count = options().length
  for (let i = 0; i < count; i++) {
    await onScreen().pressKey('ArrowDown')
    if (target().getAttribute('aria-selected') === 'true') break
  }
  expect(target()).toHaveAttribute('aria-selected', 'true')
  await onScreen().pressKey('Enter')
}

async function expectPersonForm(app: { router: unknown }, kind: 'new' | 'record') {
  await waitFor(() => expect(here(app)).toMatch(kind === 'new' ? /\/admin\/table\/person\/new$/ : /\/admin\/table\/table\/row\/Person$/), T)
  await screen.findByTestId('form-view', {}, T)
  await waitFor(() => expect(dropdown()).toBeNull())
}

/** An offered destination: a page or Table, not a record or a "new row" action sharing its label. */
const destinations = (label: string) =>
  dropdown()
    ? within(dropdown()!).queryAllByRole('option').filter((e) =>
        !['awesomebar-doc', 'awesomebar-new'].includes(e.getAttribute('data-testid') ?? '') && e.textContent?.includes(label))
    : []

/** Type the label and wait for the server's search answer to be shown. */
async function searchDestination(user: User, label: string) {
  const answered = new Promise<void>((resolve) => {
    const real = globalThis.fetch
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const res = await real(url, init)
      const u = new URL(String(url), 'http://localhost')
      if (u.pathname === '/api/search' && u.searchParams.get('q') === label) {
        expect(res.status).toBe(200)
        spy.mockRestore()
        resolve()
      }
      return res
    })
  })
  await open(user)
  await fill(user, label)
  await answered
  await new Promise((r) => setTimeout(r, 50))
}

async function findDestination(user: User, label: string) {
  await searchDestination(user, label)
  await waitFor(() => expect(destinations(label)).toHaveLength(1), T)
  await user.click(destinations(label)[0]!)
}

/** Searching for "access", with the server's records held back until released. */
async function searchAccess(admin: Admin, user: User) {
  await renderApp('/featherbase/admin', admin)
  await waitFor(() => input(), T)
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let held!: () => void
  const heldReady = new Promise<void>((r) => (held = r))
  let delivered!: () => void
  const deliveredDone = new Promise<void>((r) => (delivered = r))
  const real = globalThis.fetch
  let once = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = new URL(String(url), 'http://localhost')
    if (once || u.pathname !== '/api/search') return real(url, init)
    once = true
    const res = await real(url, init)
    expect(res.status).toBe(200)
    held()
    await gate
    queueMicrotask(delivered)
    return res
  })
  await open(user)
  await fill(user, 'access')
  await heldReady
  await waitFor(() => expect(dropdown()).toBeInTheDocument(), T)
  expect(options()[0]).toBeInTheDocument()
  return { release, deliveredDone }
}

async function expectPreservedDismissal(late: { release: () => void; deliveredDone: Promise<void> }) {
  await waitFor(() => expect(dropdown()).toBeNull())
  expect(input()).toHaveValue('access')
  late.release()
  await late.deliveredDone
  // Let the page consume and render the late records.
  await new Promise((r) => setTimeout(r, 100))
  expect(dropdown()).toBeNull()
  expect(input()).toHaveValue('access')
}

async function reopenPreservedSearch(user: User, shortcut: boolean) {
  if (shortcut) await open(user)
  else input().focus()
  expect(input()).toHaveValue('access')
  await waitFor(() => expect(dropdown()).toBeInTheDocument(), T)
  expect(options()[0]).toBeInTheDocument()
}

describe('admin-ui-feedback', () => {
  scenario('Instance health opens from search', async ({ admin }, step) => {
    const user = userEvent.setup()
    let app!: { router: unknown }
    await step('the user manages the instance', async () => {
      app = await renderApp('/featherbase/admin', admin)
      await waitFor(() => input(), T)
    })
    await step('the user finds Instance health through the command bar', () => findDestination(user, 'Instance health'))
    await step('the instance health page is shown without the command dropdown', async () => {
      await waitFor(() => expect(here(app)).toBe('/featherbase/admin/instance-health'), T)
      const page = await screen.findByTestId('instance-health', {}, T)
      expect(within(page).getByRole('heading', { name: 'Instance health' })).toBeInTheDocument()
      await waitFor(() => expect(dropdown()).toBeNull())
    })
  })

  scenario('Settings opens its existing form', async ({ admin }, step) => {
    const user = userEvent.setup()
    let app!: { router: unknown }
    await step('the user manages the instance', async () => {
      app = await renderApp('/featherbase/admin', admin)
      await waitFor(() => input(), T)
    })
    await step('the user finds System Settings through the command bar', () => findDestination(user, 'System Settings'))
    await step('the existing System Settings form is shown', async () => {
      await waitFor(() => expect(here(app)).toBe('/featherbase/admin/table/system-settings'), T)
      const form = await screen.findByTestId('form-view', {}, T)
      await waitFor(() => expect(within(form).getByTestId('form-status')).toHaveTextContent(/^Saved$/), T)
      expect(within(form).getByRole('heading', { level: 1 })).toHaveTextContent('System Settings')
      await waitFor(() => expect(dropdown()).toBeNull())
    })
  })

  scenario('Unavailable pages are absent', async ({ admin, createUser }, step) => {
    const user = userEvent.setup()
    await step('the user can read Person but cannot manage the instance', async () => {
      await grantRole(admin, { role: 'Person Reader', table: 'Person', can_read: true })
      const reader = await createUser({ roles: ['Person Reader'] })
      await renderApp('/featherbase/admin', reader)
      await waitFor(() => input(), T)
    })
    await step('the user searches for Instance health through the command bar', () => searchDestination(user, 'Instance health'))
    await step('Instance health is not offered', () => {
      const offered = dropdown() ? within(dropdown()!).queryAllByRole('option').filter((e) => e.textContent?.includes('Instance health')) : []
      expect(offered).toHaveLength(0)
    })
  })

  scenario('An outside click preserves the search', async ({ admin }, step) => {
    const user = userEvent.setup()
    let late!: Awaited<ReturnType<typeof searchAccess>>
    await step('the user is searching for access in the command bar', async () => {
      late = await searchAccess(admin, user)
    })
    await step('the user clicks outside the command bar', async () => {
      // A real pointer on page space that takes no focus, not blur().
      expect(screen.getByTestId('awesomebar').contains(document.body)).toBe(false)
      await user.click(document.body)
    })
    await step('its results are hidden with the search preserved', () => expectPreservedDismissal(late))
    await step('focusing the command bar shows its results again', () => reopenPreservedSearch(user, false))
  })

  scenario('Escape from a focused result preserves the search', async ({ admin }, step) => {
    const user = userEvent.setup()
    let late!: Awaited<ReturnType<typeof searchAccess>>
    await step('the user is searching for access in the command bar', async () => {
      late = await searchAccess(admin, user)
    })
    await step('the user focuses a result and presses Escape', async () => {
      input().focus()
      await user.tab()
      // DOM focus is on an offered result, not just an arrow-key selection.
      expect(document.activeElement).toBe(options()[0])
      await onScreen().pressKey('Escape')
    })
    await step('its results are hidden with the search preserved', () => expectPreservedDismissal(late))
    await step('the command shortcut shows its results again', () => reopenPreservedSearch(user, true))
  })

  scenario('Escape from the search preserves the search', async ({ admin }, step) => {
    const user = userEvent.setup()
    let late!: Awaited<ReturnType<typeof searchAccess>>
    await step('the user is searching for access in the command bar', async () => {
      late = await searchAccess(admin, user)
    })
    await step('the user presses Escape in the search', async () => {
      expect(document.activeElement).toBe(input())
      await onScreen().pressKey('Escape')
    })
    await step('its results are hidden with the search preserved', () => expectPreservedDismissal(late))
    await step('the command shortcut shows its results again', () => reopenPreservedSearch(user, true))
  })

  scenario('A new-row choice opens its form', async ({ admin }, step) => {
    const user = userEvent.setup()
    let app!: { router: unknown }
    await step('the user is searching for Person in the command bar', async () => {
      app = await searchPerson(admin, user)
    })
    await step('the user chooses the new Person row result using the arrow keys and Enter', () => choosePersonResult(user, 'new'))
    await step('a blank Person form is shown without the command dropdown', () => expectPersonForm(app, 'new'))
  })

  scenario('A record choice opens its form', async ({ admin }, step) => {
    const user = userEvent.setup()
    let app!: { router: unknown }
    await step('the user is searching for Person in the command bar', async () => {
      app = await searchPerson(admin, user)
    })
    await step('the user chooses the Person definition record using the arrow keys and Enter', () => choosePersonResult(user, 'record'))
    await step('the Person definition form is shown without the command dropdown', () => expectPersonForm(app, 'record'))
  })

  scenario('A replaced search does not reopen the old record', async ({ admin }, step) => {
    const user = userEvent.setup()
    let app!: { router: unknown }
    await step('the user is searching for Person in the command bar', async () => {
      app = await searchPerson(admin, user)
    })
    await step('the user replaces the search with Sign In Meth and immediately activates the search', async () => {
      await fill(user, 'Sign In Meth')
      await onScreen().pressKey('Enter')
    })
    await step('the previous Person record is not opened', async () => {
      await waitFor(() => expect(here(app)).not.toMatch(/\/all-tables$/), T)
      expect(here(app)).not.toBe('/featherbase/admin/table/table/row/Person')
    })
  })

  scenario('A destination leaves its page unobstructed', async ({ admin }, step) => {
    const user = userEvent.setup()
    let seen!: Awaited<ReturnType<typeof visitSignInMethods>>
    await step('the user is viewing the Sign In Method list', async () => {
      seen = await visitSignInMethods(admin)
    })
    await step('the user selects the Sign In Method destination from the command bar', () => searchSignInMethods(user))
    await step('the Sign In Method list is shown without the command dropdown', async () => {
      await expectSignInMethods(seen.app, seen.total)
      await waitFor(() => expect(dropdown()).toBeNull())
    })
    await step('the command bar can be reopened with its history intact', async () => {
      await open(user)
      const recents = await screen.findByTestId('awesomebar-recents', {}, T)
      await waitFor(() =>
        expect(within(recents).getAllByTestId('awesomebar-recent').some((e) => e.textContent?.includes(TABLE))).toBe(true), T)
    })
  })

  scenario('A replayed search remains usable', async ({ admin }, step) => {
    const user = userEvent.setup()
    let seen!: Awaited<ReturnType<typeof visitSignInMethods>>
    await step('the user has searched for Sign In Method', async () => {
      seen = await visitSignInMethods(admin)
      await searchSignInMethods(user)
      await expectSignInMethods(seen.app, seen.total)
    })
    await step('the user replays that past search from the command bar', async () => {
      await open(user)
      await fill(user, 'Sign In')
      const chip = await waitFor(() => {
        const found = screen.getAllByTestId('awesomebar-recent-search').find((e) => e.textContent?.includes(TABLE))
        expect(found).toBeDefined()
        return found!
      }, T)
      await user.click(chip)
    })
    await step('the search remains available to edit and run', async () => {
      expect(input()).toHaveValue(TABLE)
      expect(document.activeElement).toBe(input())
      await waitFor(() => expect(dropdown()).toBeInTheDocument(), T)
      // Edit with the keyboard without refocusing: the whole query is in the focused input.
      await onScreen().pressKey('End').pressKey(' ')
      expect(input()).toHaveValue(`${TABLE} `)
      await onScreen().pressKey('Backspace')
      expect(input()).toHaveValue(TABLE)
      await onScreen().pressKey('Enter')
      await waitFor(() => expect(input()).toHaveValue(''), T)
      await expectSignInMethods(seen.app, seen.total)
      await waitFor(() => expect(dropdown()).toBeNull())
    })
  })
})
