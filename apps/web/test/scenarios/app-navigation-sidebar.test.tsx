// app-navigation's sidebar scenarios from the owner's testing of Dash on
// staging (18-Nov-2026): viewing as someone, the sidebar's width, its hover
// labels. Each test is one scenario of openspec/specs/app-navigation/spec.md.
// An app's page is mounted as its served document mounts it (runtime-shell,
// bar/main): the platform's bar first in the body, then the app's shell with
// its <featherbase-sidebar>. Pixels are the verifier's; widths here are the
// width the sidebar is given.
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { api, setSession } from '../../src/lib/api'
import { setViewedPerson } from '../../src/lib/viewing-as'
import { mountBar } from '../../src/bar/mount'
import { FeatherbaseSidebar } from '../../src/bar/sidebar'
import { scenarioFor } from 'server/test/scenario'
import { test, expect } from '../pg-test'

const scenario = scenarioFor(test, 'app-navigation')
if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

const APPS = {
  dash: { title: 'Dash', label: 'Dash navigation', rows: ['Sales vs target', 'Your sections'] },
  tasker: { title: 'Tasker', label: 'Task views', rows: ['Today', 'Upcoming'] },
}
let mounted: { unmount: () => void } | undefined

beforeEach(() => localStorage.clear())
afterEach(() => {
  act(() => mounted?.unmount())
  mounted = undefined
  document.body.replaceChildren()
  setViewedPerson(null)
  vi.restoreAllMocks()
})

/** An app's page, signed in as `as`, the way its served document is drawn. */
async function openApp(as: TestClient, app: keyof typeof APPS) {
  act(() => mounted?.unmount())
  document.body.replaceChildren()
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  const host = document.createElement('featherbase-bar')
  host.dataset.app = app
  host.dataset.title = APPS[app].title
  document.body.prepend(host)
  mounted = mountBar(host)
  const shell = document.createElement('div')
  const side = document.createElement('featherbase-sidebar')
  side.setAttribute('aria-label', APPS[app].label)
  for (const row of APPS[app].rows) {
    const link = document.createElement('a')
    link.href = `#${row}`
    link.textContent = row
    side.append(link)
  }
  shell.append(side)
  document.body.append(shell)
  await within(side.shadowRoot as unknown as HTMLElement).findByTestId('session-user')
}
const sidebar = () => document.querySelector('featherbase-sidebar') as HTMLElement
const shadow = () => within(sidebar().shadowRoot as unknown as HTMLElement)
const iconsOnly = () => sidebar().hasAttribute('data-collapsed')
const width = () => sidebar().style.getPropertyValue('--featherbase-sidebar-width')
const control = () => shadow().getByTestId('sidebar-collapse')
const edge = () => shadow().getByTestId('sidebar-edge')
const label = () => sidebar().shadowRoot!.querySelector('[role=tooltip]')?.textContent
/** A drag on the edge, as a mouse does it, ending with the click a browser sends there. */
function drag(by: number) {
  fireEvent.pointerDown(edge(), { clientX: 500, button: 0, pointerId: 1 })
  fireEvent.pointerMove(document, { clientX: 500 + by, pointerId: 1 })
  fireEvent.pointerUp(document, { clientX: 500 + by, pointerId: 1 })
  fireEvent.click(edge())
}

describe('app-navigation: the shared sidebar', () => {
  scenario("Viewing as someone keeps the tester's own sidebar", async ({ admin, createUser }, step) => {
    const person = await createUser({ fullName: 'Vas Person' })
    await step('a tester keeps the sidebar collapsed', () => {
      localStorage.setItem(`fc-sidebar-collapsed:${admin.user}`, '1')
    })
    await step('the person they view as has never collapsed it', () => {
      expect(localStorage.getItem(`fc-sidebar-collapsed:${person.user}`)).toBeNull()
    })
    await step('the tester views Dash as that person', async () => {
      setViewedPerson({ row_id: person.user!, full_name: 'Vas Person' })
      // The server agrees whom the browser views (view-as-me.test.tsx), so the bar keeps the marker.
      const realGet = api.get.bind(api)
      vi.spyOn(api, 'get').mockImplementation(((path: string) =>
        path === '/api/view_as'
          ? Promise.resolve({ may: true, viewing: { person: person.user!, name: 'Vas Person', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, recent: [], frequent: [] })
          : realGet(path)) as typeof api.get)
      await openApp(admin, 'dash')
      await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/view_as'))
    })
    await step("Dash's navigation shows only its icons", () => expect(iconsOnly()).toBe(true))
    await step('its foot holds the account, Help and Theme within the rail', () => {
      const foot = shadow().getByTestId('sidebar-account')
      // Stacked in the rail's column, never a row wider than it.
      expect(foot.className).toMatch(/\bflex-col\b/)
      for (const id of ['session-user', 'help-button', 'theme-button']) expect(within(foot).getByTestId(id)).toBeInTheDocument()
    })
    await step('the tester expands the sidebar', () => userEvent.click(control()))
    await step("Dash's navigation is shown in full", () => expect(iconsOnly()).toBe(false))
    await step('the person viewed still has no choice of their own', () => {
      expect(localStorage.getItem(`fc-sidebar-collapsed:${person.user}`)).toBeNull()
    })
  })

  scenario('The sidebar is as wide as the person makes it', async ({ admin }, step) => {
    await step('the user has Dash open with its navigation in full', async () => {
      await openApp(admin, 'dash')
      expect(iconsOnly()).toBe(false)
      expect(width()).toBe('240px')
    })
    await step("the user drags the sidebar's edge 60 pixels to the right", () => drag(60))
    await step('the sidebar is 300 pixels wide', () => expect(width()).toBe('300px'))
    await step('the user drags the edge far to the right', () => drag(600))
    await step('the sidebar is 360 pixels wide', () => expect(width()).toBe('360px'))
    await step('the user opens Tasker', () => openApp(admin, 'tasker'))
    await step("Tasker's sidebar is 360 pixels wide too", () => expect(width()).toBe('360px'))
    await step("the user clicks the sidebar's edge", () => userEvent.click(edge()))
    await step("Tasker's navigation shows only its icons", () => expect(iconsOnly()).toBe(true))
  })

  scenario('The collapse control names its key on hover', async ({ admin }, step) => {
    await step('the user has Dash open with its navigation in full', () => openApp(admin, 'dash'))
    await step('the user rests the pointer on the collapse control', () => {
      // A real pointer's events cross the shadow boundary (composed).
      fireEvent.pointerOver(control(), { composed: true })
    })
    await step('a label reads "Collapse sidebar · Ctrl+B"', () => expect(label()).toBe('Collapse sidebar · Ctrl+B'))
    await step('the control itself shows no key', () => {
      expect(control()).toHaveTextContent(/^Collapse$/)
      expect(control()).not.toHaveAttribute('title')
    })
    await step('the user folds the sidebar and rests the pointer on the control', async () => {
      fireEvent.pointerOut(control(), { composed: true })
      await userEvent.click(control())
      fireEvent.pointerOver(control(), { composed: true })
    })
    await step('a label reads "Expand sidebar · Ctrl+B"', () => expect(label()).toBe('Expand sidebar · Ctrl+B'))
  })
})
