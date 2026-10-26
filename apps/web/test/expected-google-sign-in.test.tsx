// #473: the Person form's "Expects Google sign-in" checkbox carries a plain
// one-line hint, read with the control, so the administrator knows what
// ticking it does before they save.
import { screen } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

const HINT = 'They can sign in with Google using this email the first time; after that the link is permanent.'

test('the Person form explains what expecting Google sign-in does', async ({ admin }) => {
  await renderApp('/featherbase/admin/Person/new', admin)
  const box = await screen.findByLabelText('Expects Google sign-in')
  expect(box).toHaveAttribute('type', 'checkbox')
  expect(box).toHaveAccessibleDescription(HINT)
  expect(screen.getByText(HINT)).toBeVisible()
})
