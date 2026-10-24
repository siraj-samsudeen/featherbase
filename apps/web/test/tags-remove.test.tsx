// Removing a tag asks first (#380 review): the remove control is a small glyph
// inside the chip, so a slip of the thumb must not silently delete a tag.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

const del = vi.fn(async () => ({}))
vi.mock('../src/lib/api', () => ({
  ApiError: class extends Error {},
  api: { get: vi.fn(async () => ({ tags: ['urgent', 'vip'] })), post: vi.fn(async () => ({})), delete: del },
}))

const { Tags } = await import('../src/components/Tags')

afterEach(() => vi.restoreAllMocks())

function renderTags() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Tags table="Customer" name="C-1" />
    </QueryClientProvider>,
  )
}

test('declining the question keeps the tag', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  renderTags()
  await userEvent.click(await screen.findByRole('button', { name: 'Remove urgent' }))
  expect(window.confirm).toHaveBeenCalledWith('Remove the tag “urgent”?')
  expect(del).not.toHaveBeenCalled()
})

test('confirming removes it', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderTags()
  await userEvent.click(await screen.findByRole('button', { name: 'Remove urgent' }))
  expect(del).toHaveBeenCalledWith('/api/tags/Customer/C-1/urgent')
})

test('chips sit far enough apart that one chip’s hit area cannot reach the next', async () => {
  renderTags()
  await screen.findByRole('button', { name: 'Remove urgent' })
  expect(screen.getByTestId('tag-list').className).toMatch(/\bgap-2\b/)
})
