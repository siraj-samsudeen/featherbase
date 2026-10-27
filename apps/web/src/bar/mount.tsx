import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TopBar } from '../components/TopBar'
import { ApiError } from '../lib/api'
import { BarAddressContext, useDocumentAddress } from '../lib/bar-address'
import { paintSavedTheme } from '../lib/theme'
import { ThemeChoiceProvider } from '../lib/theme-choice'
import { paintOnto } from '../lib/theme-paint'
import platformCss from '../index.css?inline'
import { shadowCss } from './style'

// #650 (design D3): the shared top bar over an installed app's own page. The
// served document carries `<featherbase-bar data-app data-title>` first in its
// body (apps/server/src/runtime-shell.ts); this draws the real TopBar into
// that host's shadow root, so the bar is the same component as on every other
// page, and the app's document, styles and navigation stay the app's own:
//
// - styles live in the shadow root, and the theme is painted on the bar's own
//   root, never on the app's <html>;
// - the bar's router is a private one in memory: it never reads or rewrites
//   the app's address or history state. Its only route is the bar, so every
//   navigation from the bar (Sign-in methods, Log out, Open Admin) leaves the
//   app's page for a full platform page;
// - a bar control keeps its value in the document's own address and announces
//   each choice (lib/bar-address.ts);
// - the bar's height is published on the app's root as
//   `--featherbase-bar-height`, for an app that pins something to the top of
//   the window below the bar.

export const BAR_HEIGHT_VARIABLE = '--featherbase-bar-height'

interface Options {
  /** Load a platform page in full (tests watch it instead). */
  leave?: (href: string) => void
}

export function mountBar(host: HTMLElement, { leave = (href) => window.location.assign(href) }: Options = {}) {
  const app = { name: host.dataset.app ?? '', title: host.dataset.title || host.dataset.app || '' }
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = shadowCss(platformCss)
  const root = document.createElement('div')
  root.dataset.testid = 'bar-theme-root'
  root.className = 'font-sans text-ink'
  shadow.replaceChildren(style, root)
  paintOnto(root)
  paintSavedTheme()

  const history = createMemoryHistory({ initialEntries: ['/'] })
  history.push = (href) => leave(href)
  history.replace = (href) => {
    if (href !== '/') leave(href)
  }
  const router = createRouter({ routeTree: createRootRoute({ component: () => <Bar app={app} /> }), history })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2 },
    },
  })
  const reactRoot = createRoot(root)
  reactRoot.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )

  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(([entry]) => {
        document.documentElement.style.setProperty(BAR_HEIGHT_VARIABLE, `${Math.round(entry.contentRect.height)}px`)
      })
    : undefined
  observer?.observe(host)

  return {
    unmount() {
      observer?.disconnect()
      reactRoot.unmount()
    },
  }
}

function Bar({ app }: { app: { name: string; title: string } }) {
  const address = useDocumentAddress()
  return (
    <BarAddressContext.Provider value={address}>
      <ThemeChoiceProvider>
        <TopBar app={app} />
      </ThemeChoiceProvider>
    </BarAddressContext.Provider>
  )
}
