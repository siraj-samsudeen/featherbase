// UI-024: choosing dark in the top bar actually repaints the canvas. The
// theme choice's DOM effect and its per-person storage are component tests
// (apps/web/test/theme.test.tsx); what only a real browser can say is that
// the stylesheet's cascade paints a different background. Replaces
// apps/web/e2e/dark-mode.spec.ts.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import recording from './recordings/admin-home.json'
import { AppScreen } from './AppScreen'
import { replay, type Recording } from './replay'

const adminHome = recording as Recording

const meta: Meta<typeof AppScreen> = {
  title: 'Screens/Theme',
  component: AppScreen,
  args: { recording: adminHome },
  parameters: { msw: replay(adminHome) },
}
export default meta
type Story = StoryObj<typeof meta>

const canvasColour = () => getComputedStyle(document.body).backgroundColor

export const DarkRepaintsTheCanvas: Story = {
  name: 'Choosing dark repaints the canvas',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dark = await canvas.findByTestId('theme-dark', {}, { timeout: 15_000 })
    // Start from light, whatever an earlier story left behind.
    await userEvent.click(canvas.getByTestId('theme-light'))
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-theme', 'dark'))
    const light = canvasColour()
    await userEvent.click(dark)
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'))
    await waitFor(() => expect(canvasColour()).not.toBe(light))
    // Leave the next story in light.
    await userEvent.click(canvas.getByTestId('theme-light'))
  },
}
