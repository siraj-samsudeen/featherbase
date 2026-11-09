import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { fmtINR } from './format'
import { achievementTone, Headline } from './Headline'

/**
 * The answer-first block at the top of a report page: the period (`label`), the conclusion in words ("₹72,000
 * behind"), the supporting figures (`detail`) and, optionally, progress toward a target as a meter with a marker
 * line. Pick the `tone` from the figure with `achievementTone(pct)` (below 90% negative, 90 to 99.9% caution,
 * 100% and over positive, no target missing). One per report.
 */
const meta = {
  title: 'Shop floor/Headline',
  component: Headline,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    label: 'Month to date · 01-Oct-2026 to 21-Oct-2026',
    conclusion: `${fmtINR(72_000)} behind`,
    tone: achievementTone(81.7),
    detail: `81.7% of target: ${fmtINR(3_21_000)} sold of ${fmtINR(3_93_000)}`,
    progress: { value: 81.7, marker: 90, label: 'Achievement' },
  },
} satisfies Meta<typeof Headline>
export default meta
type Story = StoryObj<typeof meta>

export const BehindTarget: Story = {
  play: async ({ canvasElement }) => {
    const meter = within(canvasElement).getByRole('meter', { name: 'Achievement' })
    await expect(meter).toHaveAttribute('aria-valuenow', '81.7')
  },
}

export const NearTarget: Story = {
  args: {
    conclusion: `${fmtINR(18_500)} to go`,
    tone: achievementTone(95.3),
    detail: `95.3% of target: ${fmtINR(3_74_500)} sold of ${fmtINR(3_93_000)}`,
    progress: { value: 95.3, marker: 90, label: 'Achievement' },
  },
}

export const OverTarget: Story = {
  name: 'Over target (the meter stretches past 100%)',
  args: {
    conclusion: `${fmtINR(41_000)} ahead`,
    tone: achievementTone(110.4),
    detail: `110.4% of target: ${fmtINR(4_34_000)} sold of ${fmtINR(3_93_000)}`,
    progress: { value: 110.4, marker: 100, label: 'Achievement' },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('meter')).toHaveAttribute('aria-valuemax', '110.4')
  },
}

export const NoTarget: Story = {
  args: { conclusion: `${fmtINR(3_21_000)} sold`, tone: achievementTone(null), detail: 'No target is set for October yet.', progress: undefined },
}

export const NoMeter: Story = { args: { progress: undefined } }
