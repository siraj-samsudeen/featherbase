// #1222: View as in the shared top bar — the button (C), the Ctrl+Shift+K window (B), the picker,
// the banner, and the reloads that keep one page from mixing two people.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ViewAsPerson, ViewAsState } from '../src/components/ViewAs'

class FakeApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
let state: ViewAsState | Error = { may: false }
let found: ViewAsPerson[] = []
let signedIn = true
const post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({}))
vi.mock('../src/lib/api', () => ({
  ApiError: FakeApiError,
  getSessionUser: () => (signedIn ? { row_id: 'tester', email: 't@example.test' } : null),
  api: {
    get: vi.fn(async (path: string) => {
      if (path === '/api/view_as') { if (state instanceof Error) throw state; return state }
      return found
    }),
    post: (path: string, body?: unknown) => post(path, body),
  },
}))

const { ViewAsBanner, ViewAsButton, ViewAsPicker, identityLine, VIEWING_AS_ATTRIBUTE } = await import('../src/components/ViewAs')
const { setViewedPerson, viewedPerson } = await import('../src/lib/viewing-as')
const viewingMarker = (row_id = 'P-1', full_name = 'Asha Leader') => setViewedPerson({ row_id, full_name })

const asha: ViewAsPerson = { person: 'P-1', name: 'Asha Leader', code: '2001', jobs: ['Team Leader · Lakeside'] }
const mohan: ViewAsPerson = { person: 'P-2', name: 'Mohan Manager', code: '3013', jobs: ['Store Manager · Lakeside', 'Team Leader · Lakeside'] }
const viewingAsha = (extra: Partial<ViewAsState> = {}): ViewAsState =>
  ({ may: true, viewing: { ...asha, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, recent: [asha, mohan], frequent: [asha], ...extra })

let reload: ReturnType<typeof vi.fn>
beforeEach(() => {
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, pathname: '/admin', reload })
  state = { may: false }
  found = []
  signedIn = true
  post.mockReset().mockResolvedValue({})
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-featherbase-viewing-as')
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function show(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('identityLine', () => {
  test('code, first job and how many more', () => {
    expect(identityLine(mohan)).toBe('3013 · Store Manager · Lakeside · +1 more')
    expect(identityLine(asha)).toBe('2001 · Team Leader · Lakeside')
  })
  test('someone with no staff record', () => {
    expect(identityLine({ person: 'P-9', name: 'Guest' })).toBe('Not on the staff list')
  })
})

describe('the View as button and window', () => {
  test('nobody signed in, or someone who may not view as anyone, sees nothing', async () => {
    signedIn = false
    const first = show(<ViewAsButton compact={false} />)
    expect(first.container.innerHTML).toBe('')
    first.unmount()
    signedIn = true
    show(<ViewAsButton compact={false} />)
    await waitFor(() => expect(screen.queryByTestId('view-as-button')).toBeNull())
    fireEvent.keyDown(document, { key: 'K', ctrlKey: true, shiftKey: true })
    expect(screen.queryByTestId('view-as-palette')).toBeNull()
  })

  test('the button opens the picker under it, and Escape or a click outside closes it', async () => {
    state = { may: true, recent: [asha], frequent: [] }
    show(<ViewAsButton compact={false} />)
    await userEvent.click(await screen.findByTestId('view-as-button'))
    expect(screen.getByTestId('view-as-dropdown')).toBeTruthy()
    expect(screen.getByTestId('view-as-recent').textContent).toContain('Asha Leader')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('view-as-dropdown')).toBeNull()
    await userEvent.click(screen.getByTestId('view-as-button'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('view-as-dropdown')).toBeNull()
    await userEvent.click(screen.getByTestId('view-as-button'))
    await userEvent.click(screen.getByTestId('view-as-button'))
    expect(screen.queryByTestId('view-as-dropdown')).toBeNull()
  })

  test('compact shows the icon only', async () => {
    state = { may: true }
    show(<ViewAsButton compact />)
    expect((await screen.findByTestId('view-as-button')).textContent).toBe('')
  })

  test('Ctrl+Shift+K opens the picker as a window; other keys do not', async () => {
    state = { may: true }
    show(<ViewAsButton compact={false} />)
    await screen.findByTestId('view-as-button')
    fireEvent.keyDown(document, { key: 'k', shiftKey: true })
    expect(screen.queryByTestId('view-as-palette')).toBeNull()
    fireEvent.keyDown(document, { key: 'K', metaKey: true, shiftKey: true })
    expect(screen.getByTestId('view-as-palette')).toBeTruthy()
    fireEvent.mouseDown(screen.getByTestId('view-as-palette'))
    expect(screen.queryByTestId('view-as-palette')).toBeNull()
  })

  test('while viewing, the banner takes the button’s place; the shortcut still opens the picker', async () => {
    viewingMarker()
    state = viewingAsha()
    show(<ViewAsButton compact={false} />)
    await waitFor(() => {
      fireEvent.keyDown(document, { key: 'K', ctrlKey: true, shiftKey: true })
      expect(screen.getByTestId('view-as-palette')).toBeTruthy()
    })
    expect(screen.queryByTestId('view-as-button')).toBeNull()
  })
})

describe('the picker', () => {
  test('nobody yet: it says how to search; the footer names the time limit', () => {
    show(<ViewAsPicker state={{ may: true }} />)
    expect(screen.getByTestId('view-as-picker').textContent).toContain('You haven’t viewed as anyone yet')
    expect(screen.getByTestId('view-as-picker').textContent).toContain('Ends after 60 minutes')
  })

  test('the person being viewed is left out of Recent and Frequently used', () => {
    show(<ViewAsPicker state={{ ...viewingAsha(), minutes: 30, person_link: true }} />)
    expect(screen.queryByTestId('view-as-frequent')).toBeNull()
    expect(screen.getByTestId('view-as-recent').textContent).not.toContain('Asha')
    expect(screen.getByTestId('view-as-recent').querySelector('a')).toBeTruthy()
    expect(screen.getByTestId('view-as-picker').textContent).toContain('Ends after 30 minutes')
  })

  test('a search finds people; picking one starts View as, pauses history, tells other tabs and reloads', async () => {
    found = [mohan]
    show(<ViewAsPicker state={{ may: true }} />)
    await userEvent.type(screen.getByTestId('view-as-search'), 'mo')
    expect((await screen.findByTestId('view-as-results')).textContent).toContain('Mohan Manager')
    await userEvent.type(screen.getByTestId('view-as-search'), '{Enter}')
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith('/api/view_as/start', { person: 'P-2' })
    expect(viewedPerson()).toEqual({ row_id: 'P-2', full_name: 'Mohan Manager' })
    expect(window.localStorage.getItem('featherbase.view-as.changed')).toBeTruthy()
  })

  test('Enter with nothing found does nothing, and says no one was found', async () => {
    show(<ViewAsPicker state={{ may: true }} />)
    await userEvent.type(screen.getByTestId('view-as-search'), 'zz')
    await screen.findByTestId('view-as-none')
    await userEvent.type(screen.getByTestId('view-as-search'), '{Enter}')
    expect(post).not.toHaveBeenCalled()
  })

  test('a refusal shows the server’s words; anything else a plain message', async () => {
    state = { may: true, recent: [asha] }
    post.mockRejectedValueOnce(new FakeApiError('You can’t view as this person.', 403))
    show(<ViewAsPicker state={{ may: true, recent: [asha] }} />)
    await userEvent.click(screen.getByTestId('view-as-pick'))
    expect((await screen.findByTestId('view-as-error')).textContent).toBe('You can’t view as this person.')
    post.mockRejectedValueOnce(new Error('network'))
    await userEvent.click(screen.getByTestId('view-as-pick'))
    await waitFor(() => expect(screen.getByTestId('view-as-error').textContent).toBe('Could not change the view. Try again.'))
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('the banner', () => {
  test('not viewing: no banner, and the page is not marked', async () => {
    state = { may: true }
    document.documentElement.setAttribute(VIEWING_AS_ATTRIBUTE, '')
    show(<ViewAsBanner />)
    await waitFor(() => expect(document.documentElement.hasAttribute(VIEWING_AS_ATTRIBUTE)).toBe(false))
    expect(screen.queryByTestId('view-as-banner')).toBeNull()
  })

  test('viewing: who, their line, for viewing only; the page is marked; Switch opens the picker', async () => {
    viewingMarker()
    state = viewingAsha()
    show(<ViewAsBanner />)
    const banner = await screen.findByTestId('view-as-banner')
    expect(banner.textContent).toContain('Viewing as Asha Leader · 2001 · Team Leader · Lakeside')
    expect(banner.textContent).toContain('For viewing only')
    expect(document.documentElement.hasAttribute(VIEWING_AS_ATTRIBUTE)).toBe(true)
    await userEvent.click(screen.getByTestId('view-as-switch'))
    expect(screen.getByTestId('view-as-switch-panel')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('view-as-switch-panel')).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })

  test('a person with no staff line shows the fallback words', async () => {
    viewingMarker('P-9', 'Guest')
    state = { may: true, viewing: { person: 'P-9', name: 'Guest', expires_at: new Date(Date.now() + 60_000).toISOString() } }
    show(<ViewAsBanner />)
    expect((await screen.findByTestId('view-as-banner')).textContent).toContain('Not on the staff list')
  })

  test('Exit ends View as, resumes history and reloads; a failure is shown', async () => {
    viewingMarker()
    state = viewingAsha()
    show(<ViewAsBanner />)
    post.mockRejectedValueOnce(new FakeApiError('Try again later.', 500))
    await userEvent.click(await screen.findByTestId('view-as-exit'))
    expect((await screen.findByRole('alert')).textContent).toBe('Try again later.')
    await userEvent.click(screen.getByTestId('view-as-exit'))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(post).toHaveBeenLastCalledWith('/api/view_as/exit', {})
    expect(viewedPerson()).toBeNull()
  })

  test('when its time is up the page reloads', async () => {
    viewingMarker()
    state = viewingAsha({ viewing: { ...asha, expires_at: new Date(Date.now() - 5_000).toISOString() } })
    show(<ViewAsBanner />)
    await screen.findByTestId('view-as-banner')
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 2000 })
  })
})

describe('reloads that keep one page to one person', () => {
  test('“View as has ended” from the server reloads', async () => {
    state = new FakeApiError('View as has ended.', 409)
    show(<ViewAsBanner />)
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  test('another error does not', async () => {
    state = new FakeApiError('Down.', 500)
    show(<ViewAsBanner />)
    await new Promise((r) => setTimeout(r, 50))
    expect(reload).not.toHaveBeenCalled()
  })

  test('a stale history marker is fixed and the page redrawn', async () => {
    viewingMarker()
    state = { may: true }
    show(<ViewAsBanner />)
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(viewedPerson()).toBeNull()
  })

  test('a marker missing while viewing is set and the page redrawn', async () => {
    state = viewingAsha()
    show(<ViewAsBanner />)
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(viewedPerson()).toEqual({ row_id: 'P-1', full_name: 'Asha Leader' })
  })

  test('someone who may not view as anyone is treated as not viewing', async () => {
    state = { may: false, viewing: { ...asha, expires_at: new Date(Date.now() + 60_000).toISOString() } }
    show(<ViewAsBanner />)
    await new Promise((r) => setTimeout(r, 50))
    expect(reload).not.toHaveBeenCalled()
    expect(screen.queryByTestId('view-as-banner')).toBeNull()
  })

  test('whom the page shows changing under it (another tab switched) reloads', async () => {
    viewingMarker()
    state = viewingAsha()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ViewAsBanner /></QueryClientProvider>)
    await screen.findByTestId('view-as-banner')
    state = viewingAsha({ viewing: { ...mohan, expires_at: new Date(Date.now() + 60_000).toISOString() } })
    await act(() => client.invalidateQueries({ queryKey: ['view-as'] }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  test('another tab switched and already set the marker: whom the page shows still changed, so it reloads', async () => {
    viewingMarker()
    state = viewingAsha()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ViewAsBanner /></QueryClientProvider>)
    await screen.findByTestId('view-as-banner')
    viewingMarker('P-2', 'Mohan Manager')
    state = viewingAsha({ viewing: { ...mohan, expires_at: new Date(Date.now() + 60_000).toISOString() } })
    await act(() => client.invalidateQueries({ queryKey: ['view-as'] }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(viewedPerson()).toEqual({ row_id: 'P-2', full_name: 'Mohan Manager' })
  })

  test('another tab starting or ending View as reloads this one; other keys do not', () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }))
    expect(reload).not.toHaveBeenCalled()
    window.dispatchEvent(new StorageEvent('storage', { key: 'featherbase.view-as.changed' }))
    expect(reload).toHaveBeenCalled()
  })
})
