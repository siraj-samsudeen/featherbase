// #1242 (admin-lists 2): a Table's list keeps List actions and Table
// administration as two labelled groups in one ⋯ More menu, and its other
// views (and Explore) in a View menu in the toolbar. Tests reach them here.
import { screen, within, type BoundFunctions, type queries } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type Scope = BoundFunctions<typeof queries>
type Wait = { timeout: number } | undefined
export type ListMenu = 'List actions' | 'Table administration' | 'View'

const opener = (menu: ListMenu) => (menu === 'View' ? /^View$/ : /^More$/)

/** Opens the menu that holds `menu` and returns that group, to find its items in. */
export async function openListMenu(menu: ListMenu, scope: Scope = screen, wait?: Wait) {
  const button = await scope.findByRole('button', { name: opener(menu) }, wait)
  if (button.getAttribute('aria-expanded') !== 'true') await userEvent.click(button)
  return within(await scope.findByRole('group', { name: menu }, wait))
}

/** Whether the list offers `menu` at all: opens More (or View) if it is there,
 *  so an absent group is truly absent, not merely closed. */
export async function hasListMenu(menu: ListMenu, scope: Scope = screen): Promise<boolean> {
  const button = scope.queryByRole('button', { name: opener(menu) })
  if (!button) return false
  if (button.getAttribute('aria-expanded') !== 'true') await userEvent.click(button)
  return scope.queryByRole('group', { name: menu }) !== null
}
