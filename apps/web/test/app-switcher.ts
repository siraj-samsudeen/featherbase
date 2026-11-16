// The application switcher (#1236): a menu button, not a native select. Tests
// open it, read its choices and choose one through these, the way a person does.
import { waitFor, within, type BoundFunctions, type queries } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type Scope = BoundFunctions<typeof queries>
type Wait = { timeout: number } | undefined

/** The switcher's button: its name is "Switch application: <the current app>". */
export const switcherButton = (scope: Scope, wait?: Wait) => scope.findByRole('button', { name: /^Switch application: / }, wait)

/** The app the switcher shows as current. */
export async function currentApp(scope: Scope, wait?: Wait): Promise<string> {
  return (await switcherButton(scope, wait)).getAttribute('aria-label')!.replace(/^Switch application: /, '')
}

/** The open menu (opened if it is not). */
export async function openSwitcher(scope: Scope, wait?: Wait) {
  const button = await switcherButton(scope, wait)
  if (button.getAttribute('aria-expanded') !== 'true') await userEvent.click(button)
  const root = (button.getRootNode() as Document | ShadowRoot)
  const menu = root.querySelector<HTMLElement>('[data-testid="app-switcher-menu"]')!
  return { menu, ...within(menu) }
}

/** The apps the menu offers, by title, in order (the closed ones apart). */
export async function appChoices(scope: Scope, wait?: Wait): Promise<string[]> {
  const { menu } = await openSwitcher(scope, wait)
  return [...menu.querySelectorAll<HTMLElement>('[data-testid="app-switcher-item"]')].map((item) => item.dataset.title ?? '')
}

/** The apps a System Manager sees greyed, by title. */
export async function closedChoices(scope: Scope, wait?: Wait): Promise<string[]> {
  const { menu } = await openSwitcher(scope, wait)
  return [...menu.querySelectorAll<HTMLElement>('[data-testid="app-switcher-closed"]')].map((item) => item.dataset.title ?? '')
}

/** Chooses the app titled `title` from the menu, once the menu offers it
 *  (the list fills in when the app catalog answers). */
export async function chooseApp(scope: Scope, title: string, wait?: Wait) {
  const { menu } = await openSwitcher(scope, wait)
  const item = await waitFor(() => {
    const found = [...menu.querySelectorAll<HTMLElement>('[data-testid="app-switcher-item"]')].find((el) => el.dataset.title === title)
    if (!found) throw new Error(`The app switcher offers no ${title}`)
    return found
  }, wait)
  await userEvent.click(item)
}
