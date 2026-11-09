import type { Preview } from '@storybook/react-vite'
import { mswLoader } from 'msw-storybook-addon/csf3'
import '../src/index.css'

// Stories answer /api from recordings (stories/replay.ts), given as each
// story's `parameters.msw`; nothing reaches a server.
const preview: Preview = {
  loaders: [mswLoader()],
  // Desktop first: every story opens at the width people use (layout tests too).
  initialGlobals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    viewport: { options: { desktop: { name: 'Desktop 1280', styles: { width: '1280px', height: '800px' }, type: 'desktop' } } },
    layout: 'fullscreen',
    a11y: { test: 'todo' },
  },
}
export default preview
