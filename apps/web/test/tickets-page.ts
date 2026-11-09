// Tickets' own page (example-apps/tickets/src/main.tsx) rendered in jsdom for
// one person, against the in-process server (#1070). The page mounts itself
// on #root when its module runs, so each open loads a fresh copy of the
// module: what one page learned (ticket types, people's names) never leaks
// into the next.
import { resolve } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { createSession, type Session } from 'feather-testing-postgres/session'
import { settleSandboxRequests } from 'server/test/pg-test-shared'
import { SESSION_TIMEOUT } from './pg-test'

// The web suite runs from apps/web.
const MAIN = resolve('../..', 'example-apps/tickets/src/main.tsx')
let copy = 0

// jsdom has no modal dialogs; Tickets opens its New ticket form in one. Open
// is all a test needs: the dialog's content is then in the page.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open') }
}

/** Opens Tickets at /tickets/<query> as that person, waits until it has their
 *  session, and hands back a Session that drives the page. */
export async function openTickets(as: TestClient, query = ''): Promise<{ session: Session }> {
  await settleSandboxRequests()
  localStorage.setItem('fc_token', as.token!)
  localStorage.setItem('fc_user', JSON.stringify({ row_id: as.user }))
  window.history.replaceState(null, '', `/tickets/${query}`)
  document.body.innerHTML = '<div id="root"></div>'
  await import(/* @vite-ignore */ `${MAIN}?page=${++copy}`)
  // Enabled, not only present: the button stays disabled until the page has the person's session.
  await waitFor(() => expect(screen.getAllByRole('button', { name: /New ticket/ })[0]).toBeEnabled(), { timeout: 10_000 })
  // In an object: a Session is thenable, so an async function returning it bare would run it instead.
  return { session: createSession({ timeout: SESSION_TIMEOUT }) }
}

/** The shared app navigation Tickets fills (`<featherbase-sidebar>`). */
export const sidebar = () => document.querySelector('featherbase-sidebar') as HTMLElement

/** Searches the queue for a ticket and opens it. */
export function selectTicket(session: Session, rowId: string): Session {
  return session
    .fillIn('Search tickets', rowId)
    .within('.ticket-list', (queue) => queue.clickButton(rowId))
}

/** Waits until the ticket's own page shows (its header's kicker). */
export function ticketOpens(session: Session): Session {
  return session.until('the ticket page is open', () => document.querySelector('.ticket-kicker'))
}
