// Tickets' own page (example-apps/tickets/src/main.tsx) rendered in jsdom for
// one person, against the in-process server (#1070). The page mounts itself
// on #root when its module runs, so each open loads a fresh copy of the
// module: what one page learned (ticket types, people's names) never leaks
// into the next.
import { resolve } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { settleSandboxRequests } from 'server/test/pg-test-shared'

// The web suite runs from apps/web.
const MAIN = resolve('../..', 'example-apps/tickets/src/main.tsx')
let copy = 0

// jsdom has no modal dialogs; Tickets opens its New ticket form in one. Open
// is all a test needs: the dialog's content is then in the page.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open') }
}

/** Opens Tickets at /tickets/<query> as that person and waits until it has their session. */
export async function openTickets(as: TestClient, query = '') {
  await settleSandboxRequests()
  localStorage.setItem('fc_token', as.token!)
  localStorage.setItem('fc_user', JSON.stringify({ row_id: as.user }))
  window.history.replaceState(null, '', `/tickets/${query}`)
  document.body.innerHTML = '<div id="root"></div>'
  await import(/* @vite-ignore */ `${MAIN}?page=${++copy}`)
  await waitFor(() => expect(screen.getAllByRole('button', { name: /New ticket/ })[0]).toBeEnabled(), { timeout: 10_000 })
}

/** The shared app navigation Tickets fills (`<featherbase-sidebar>`). */
export const sidebar = () => document.querySelector('featherbase-sidebar') as HTMLElement

/** Searches the queue for a ticket and opens it. */
export async function selectTicket(user: { type: (el: Element, text: string) => Promise<void>; click: (el: Element) => Promise<void>; clear: (el: Element) => Promise<void> }, rowId: string) {
  const search = screen.getByRole('searchbox', { name: 'Search tickets' })
  await user.clear(search)
  await user.type(search, rowId)
  const row = await waitFor(() => {
    const found = [...document.querySelectorAll('.ticket-id')].find(el => el.textContent?.includes(rowId))
    expect(found, `the queue lists ${rowId}`).toBeTruthy()
    return found!
  }, { timeout: 8000 })
  await user.click(row)
}
