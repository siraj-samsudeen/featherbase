// The component gallery (#380, /gallery.html on the dev server): the page
// renders every shared primitive, flips the theme, and raises both toasts.
// No e2e spec opens it — gallery.html is outside the app's routes — so this is
// its only test (ADR 0012 merged web coverage). Pure UI: no server, no data.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import { Gallery } from '../src/gallery/Gallery'

afterEach(() => {
  delete document.documentElement.dataset.theme
})

test('shows every section, flips light and dark, and raises both toasts', async () => {
  const user = userEvent.setup()
  render(<Gallery />)
  expect(screen.getByRole('heading', { level: 1, name: 'Components' })).toBeInTheDocument()
  for (const title of ['Buttons', 'Fields', 'Status, in words', 'Notices', 'Report headline', 'Tab bar (phone only)', 'Toasts'])
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
  expect(screen.getByText('Enter a number of 1 or more')).toBeInTheDocument()
  expect(screen.getAllByText('Men Casual Shirt').length).toBeGreaterThan(0)
  // The tab bar's specimen is drawn in place at any width, the open tab marked.
  const tabs = screen.getByRole('navigation', { name: 'Example app' })
  expect(tabs.className).not.toMatch(/\bsm:hidden\b/)
  expect(screen.getByRole('link', { name: 'Targets' })).toHaveAttribute('aria-current', 'page')

  await user.click(screen.getByRole('button', { name: 'Dark' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  await user.click(screen.getByRole('button', { name: 'Light' }))
  expect(document.documentElement.dataset.theme).toBe('light')

  await user.click(screen.getByRole('button', { name: 'Show a confirmation' }))
  expect(await screen.findByText('Checklist saved')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Show a failure' }))
  expect(await screen.findByText('Could not save. Check your connection and try again.')).toBeInTheDocument()
})
