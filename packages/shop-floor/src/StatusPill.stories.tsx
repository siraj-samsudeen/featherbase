import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { StatusPill } from './StatusPill'

/**
 * A short status in words ("Overdue", "Done", "No target set") as a coloured pill; the colour only repeats the
 * words. Tones: `negative`, `caution`, `positive`, `opportunity`, `missing`, `neutral` (the default). It never
 * wraps, so keep the words short. For a sales achievement, pick the tone with `achievementTone(pct)`.
 * `pillClasses()` gives the shape alone for a pill of another colour.
 */
const meta = {
  title: 'Shop floor/StatusPill',
  component: StatusPill,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { children: 'In progress' },
} satisfies Meta<typeof StatusPill>
export default meta
type Story = StoryObj<typeof meta>

export const Neutral: Story = {}
export const Negative: Story = { args: { tone: 'negative', children: 'Overdue' } }
export const Caution: Story = { args: { tone: 'caution', children: 'Near target' } }
export const Positive: Story = { args: { tone: 'positive', children: 'Done' } }
export const Opportunity: Story = { args: { tone: 'opportunity', children: 'Opportunity' } }
export const Missing: Story = { args: { tone: 'missing', children: 'No target set' } }

export const AllTones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusPill tone="negative">Overdue</StatusPill>
      <StatusPill tone="caution">Near target</StatusPill>
      <StatusPill tone="positive">Done</StatusPill>
      <StatusPill tone="opportunity">Opportunity</StatusPill>
      <StatusPill tone="missing">No target set</StatusPill>
      <StatusPill>In progress</StatusPill>
    </div>
  ),
}

export const LongWordsStayOneLine: Story = {
  name: 'Long words stay one line',
  args: { tone: 'caution', children: 'Awaiting second-level approval from the regional office' },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByText(/Awaiting/)
    await expect(pill.getBoundingClientRect().height).toBeLessThan(28)
  },
}
