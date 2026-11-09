// sign-in-and-accounts' fenced scenarios (#1070), rendered in jsdom against
// the real in-process server. Each test is one scenario of
// openspec/specs/sign-in-and-accounts/spec.md, step by step.
//
// The Google sign-in runs through the dev mock provider on the server
// (server/test/google-mock): the browser's hops between hosts and the consent
// page's form are what a real browser alone proves.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, vi } from 'vitest'
import { rowHref } from 'shared'
import { scenarioFor } from 'server/test/scenario'
import { googleSignIn, redeemSession } from 'server/test/google-mock'
import { test, expect, renderApp } from '../pg-test'

const scenario = scenarioFor(test, 'sign-in-and-accounts')
const ACCOUNT_NUMBER = '104116711844961612173'

describe('sign-in-and-accounts', () => {
  scenario('A claimed Google invite reads as who and when', async ({ admin, api }, step) => {
    const address = 'linked.google.837@gmail.com'
    let person = ''
    let row: HTMLElement
    await step('a person was invited by a Google address and has signed in with it', async () => {
      vi.stubEnv('ALLOW_MOCK_OAUTH', '1')
      const google = await admin.get<{ row_id: string; kind: string; enabled: boolean | number }>('/api/table/Sign In Method/google')
      expect(google.kind).toBe('google')
      if (!google.enabled) await admin.post('/api/save_row', { table: 'Sign In Method', row: { ...google, enabled: true } })
      person = (await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { full_name: 'Linked Google', enabled: true } })).row_id
      await admin.post(`/api/people/${encodeURIComponent(person)}/identities`, { method: google.row_id, email: address, send_invitation_email: false })
      const signedIn = await googleSignIn(api, address, { subject: ACCOUNT_NUMBER })
      expect(signedIn.status).toBe(302)
      expect((await redeemSession(api, signedIn)).user.row_id).toBe(person)
    })
    await step("a System Manager opens the person's sign-in methods", async () => {
      await renderApp(rowHref('Person', person), admin)
      const panel = await screen.findByTestId('user-sign-in-methods', {}, { timeout: 8000 })
      row = await waitFor(() => {
        const found = within(panel).getAllByRole('listitem').find((li) => li.textContent?.includes('Google'))
        expect(found).toBeDefined()
        return found as HTMLElement
      })
    })
    await step("the Google sign-in leads with the person's address", async () => {
      await waitFor(() => expect(within(row).getByTestId('identity-head').textContent?.trim()).toBe(`Google · ${address}`))
    })
    await step('it says it was linked at first sign-in, and when it was last used', () => {
      expect(within(row).getByTestId('identity-linked').textContent).toMatch(
        /^linked \d{2}-[A-Z][a-z]{2}-\d{4} .* at first sign-in · last signed in \d{2}-[A-Z][a-z]{2}-\d{4} /,
      )
    })
    await step("Google's account number shows only under the sign-in's details", async () => {
      expect(within(row).getByText(ACCOUNT_NUMBER, { exact: false })).not.toBeVisible()
      await userEvent.click(within(row).getByText('Details'))
      expect(within(row).getByText(`Google account number: ${ACCOUNT_NUMBER}`)).toBeVisible()
    })
  })
})
