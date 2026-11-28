import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { PartsBar, type Part } from './PartsBar'

const PARTS: Part[] = [
  { label: 'From recent selling', color: 'var(--color-part-recent)', share: 59 },
  { label: 'December step on top', color: 'var(--color-part-step)', share: 14 },
  { label: 'From last year × growth', color: 'var(--color-part-last-year)', share: 27 },
  { label: 'Adjustments', color: 'var(--color-part-adjust)', share: 0 },
]

/**
 * What a number is built from: a full-width 100% bar (the mix, never the size) or a donut. The hover and the
 * accessible name give each part's share in words. The four part colours are tokens, fixed and colour-blind safe.
 */
const meta = {
  title: 'Shop floor/PartsBar',
  component: PartsBar,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { parts: PARTS },
} satisfies Meta<typeof PartsBar>
export default meta
type Story = StoryObj<typeof meta>

export const Bar: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img')).toHaveAccessibleName('From recent selling: 59% · December step on top: 14% · From last year × growth: 27% · Adjustments: 0%')
  },
}
export const Donut: Story = { args: { shape: 'donut' } }
