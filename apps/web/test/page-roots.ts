// Pages that mount themselves (Tickets' main.tsx calls createRoot on #root
// when its module runs) are not Testing Library's, so its cleanup() never
// unmounts them. A page left mounted keeps rendering as its requests answer,
// after jsdom is gone ("window is not defined" from React's scheduler).
// test/setup.ts records every root made on #root here; unmountPages()
// unmounts them, between pages and after each test.
import type { createRoot, Root } from 'react-dom/client'

const pages: Root[] = []

export function trackRoot(root: Root, container: Parameters<typeof createRoot>[0]): Root {
  // The shared bar (src/bar) mounts itself the same way, inside its host's shadow root.
  if (container instanceof Element && (container.id === 'root' || container.getAttribute('data-testid') === 'bar-theme-root')) pages.push(root)
  return root
}

export function unmountPages(): void {
  for (const root of pages.splice(0)) root.unmount()
}
