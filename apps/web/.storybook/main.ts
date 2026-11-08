// Storybook (#1070): the place to see every component and screen, in each of
// its states, without a server, and the layout tests that run on them.
// Stories live next to the components they show (src/**) or, for whole
// screens replayed from recorded API answers, in stories/.
import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)', '../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-vitest', '@storybook/addon-a11y', '@storybook/addon-mcp', 'msw-storybook-addon'],
  // MSW's service worker, served only to Storybook, never to the app's build.
  staticDirs: ['./public'],
}
export default config
