import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { Segmented } from './Segmented'

type Period = 'day' | 'week' | 'month' | 'year'
const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'Month to date' },
  { value: 'year', label: 'Year to date' },
]

function Periods({ initial = 'month' }: { initial?: Period }) {
  const [value, setValue] = useState<Period>(initial)
  return <Segmented label="Period" options={PERIODS} value={value} onChange={setValue} />
}

/**
 * Two to five mutually exclusive choices that change the view in place (Today / This week / Month to date; Table
 * / Compact). The chosen one is `aria-pressed`, so its look is never the only signal. The caller holds `value`.
 * For more choices, or ones that take a sentence, use a `Select`; for sections of a page, `ContentTabs`.
 * `ViewToggle` and `PanePlace` are ready-made Segmenteds.
 */
const meta = {
  title: 'Shop floor/Segmented',
  component: Segmented,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: () => <Periods />,
} satisfies Meta<typeof Segmented>
export default meta
// Generic over its values; each story renders its own.
type Story = StoryObj

export const FourChoices: Story = {
  play: async ({ canvasElement }) => {
    const group = within(within(canvasElement).getByRole('group', { name: 'Period' }))
    await userEvent.click(group.getByRole('button', { name: 'This week' }))
    await expect(group.getByRole('button', { name: 'This week' })).toHaveAttribute('aria-pressed', 'true')
    await expect(group.getByRole('button', { name: 'Month to date' })).toHaveAttribute('aria-pressed', 'false')
  },
}

export const OneLine: Story = {
  name: 'Stays one line',
  play: async ({ canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole('button').map((b) => b.getBoundingClientRect().top)
    await expect(new Set(buttons).size).toBe(1)
  },
}
