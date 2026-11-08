import type { Preview } from '@storybook/react-vite'
import { initialize, mswLoader } from 'msw-storybook-addon'
import '../src/index.css'

// Stories answer /api from recordings (stories/replay.ts); nothing reaches a server.
initialize({ onUnhandledRequest: 'bypass', quiet: true })

const preview: Preview = {
  loaders: [mswLoader],
  parameters: {
    // Desktop first: stories open at the width people use.
    viewport: { options: { desktop: { name: 'Desktop', styles: { width: '1280px', height: '800px' } } } },
    layout: 'fullscreen',
    a11y: { test: 'todo' },
  },
}
export default preview
