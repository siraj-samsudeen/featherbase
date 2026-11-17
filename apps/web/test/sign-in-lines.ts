// #1267: a Person's Sign-In lines each open a small dialog for that method.
import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** Presses the one button on a Sign-In line and returns the dialog it opens. */
export async function openLine(panel: HTMLElement, line: string): Promise<HTMLElement> {
  const row = await within(panel).findByTestId(line)
  await userEvent.click(within(row).getByTestId('sign-in-line-action'))
  return within(panel).findByTestId('sign-in-dialog')
}

/** Opens the "Show N ended" list under the lines. */
export async function showEnded(panel: HTMLElement) {
  const toggle = await within(panel).findByTestId('sign-in-show-ended')
  if (toggle.getAttribute('aria-expanded') !== 'true') await userEvent.click(toggle)
}

/** #1267: Identifiers sit in a closed "Identifier History" section; opens it as a person would. */
export async function openIdentifierHistory(): Promise<HTMLElement> {
  const { screen } = await import('@testing-library/react')
  const panel = await screen.findByTestId('person-identifiers', {}, { timeout: 8000 })
  if (!panel.hasAttribute('open')) await userEvent.click(within(panel).getByTestId('identifier-history-toggle'))
  return panel
}
