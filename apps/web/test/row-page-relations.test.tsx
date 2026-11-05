// #910 checklist 15–16 and #800's record tab set: a row page leads with its
// connections, as the same chips as the drill pane, directly under its name;
// its tabs are Form · Map · Tree · Collaboration · Activity, and the tab is
// part of the path. Unfinished edits survive switching tabs and the pane.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { PLANT, REGION, SITE, seedSites } from './relational-fixture'
import { decodePath } from '../src/lib/nav-path'

configure({ asyncUtilTimeout: 10_000 })

const ENK = `${tableHref(SITE)}/row/ENK`
const connections = () => screen.findByRole('region', { name: 'Connections' })
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

test('the row page offers Form, Map, Tree, Collaboration and Activity', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(ENK, admin)
  const tabs = await screen.findByRole('tablist', { name: 'Record workspace' })
  expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Form', 'Map', 'Tree', 'Collaboration', 'Activity'])
})

test('its region and its counted plants show under its name', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(ENK, admin)
  const chips = await connections()
  expect(await within(chips).findByRole('button', { name: 'Kerala · KL' })).toBeInTheDocument()
  expect(await within(chips).findByRole('button', { name: `${PLANT} 3` })).toBeInTheDocument()
})

test('opening the plants shows them in the drill pane', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(ENK, admin)
  fireEvent.click(await within(await connections()).findByRole('button', { name: `${PLANT} 3` }))
  const pane = await screen.findByRole('complementary', { name: 'Enchakkal · ENK' })
  await waitFor(() => expect(within(within(pane).getByRole('table')).getAllByRole('row')).toHaveLength(4))
})

test('opening its region shows Kerala in the drill pane', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(ENK, admin)
  fireEvent.click(await within(await connections()).findByRole('button', { name: 'Kerala · KL' }))
  expect(await screen.findByRole('complementary', { name: 'Kerala · KL' })).toHaveTextContent(REGION)
})

test('the chosen tab is kept in the path', async ({ admin }) => {
  await seedSites(admin)
  const { router } = await renderApp(ENK, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
  await waitFor(() => {
    const raw = new URLSearchParams((router.state as { location: { searchStr: string } }).location.searchStr).get('path')
    const path = decodePath(raw)
    expect(path?.steps[path.at].view).toBe('map')
  })
  expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true')
})

test('an unfinished edit survives switching tabs and opening the pane', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(ENK, admin)
  await waitFor(() => expect(field('site_name')).toHaveValue('Enchakkal'))
  fireEvent.change(field('site_name'), { target: { value: 'Enchakkal North' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
  fireEvent.click(await within(await connections()).findByRole('button', { name: 'Kerala · KL' }))
  await screen.findByRole('complementary', { name: 'Kerala · KL' })
  fireEvent.click(screen.getByRole('tab', { name: 'Form' }))
  expect(field('site_name')).toHaveValue('Enchakkal North')
  expect(screen.getByTestId('form-save')).toBeEnabled()
})
