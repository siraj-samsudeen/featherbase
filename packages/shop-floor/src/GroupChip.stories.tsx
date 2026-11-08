import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { GroupChip } from './GroupChip'

const GROUPS: [string, string, number | undefined][] = [['fields', 'Fields', undefined], ['shelf', 'Shelf', 3], ['count', 'Stock count', 125000], ['spare', 'Spare shelf', 0]]

function Groups() {
  const [group, setGroup] = useState('shelf')
  return (
    <div className="flex flex-wrap gap-2">
      {GROUPS.map(([id, label, count]) => <GroupChip key={id} label={label} count={count} selected={group === id} onSelect={() => setGroup(id)} />)}
    </div>
  )
}

const meta = {
  title: 'Shop floor/GroupChip',
  component: GroupChip,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One group of related rows with its count ("Shelf 3"), pressed while chosen. A row of them picks which related rows a pane or ' +
          'row page shows ("Pointed at by"); a group with no rows stays listed, quieter. One is chosen at a time; the caller holds which.',
      },
    },
  },
  args: { label: 'Shelf', count: 3, selected: false, onSelect: fn() },
} satisfies Meta<typeof GroupChip>
export default meta
type Story = StoryObj<typeof meta>

export const WithCount: Story = {}
export const Selected: Story = { args: { selected: true } }
export const NoCount: Story = { args: { label: 'Fields', count: undefined } }
export const Empty: Story = { name: 'No rows (quieter)', args: { label: 'Spare shelf', count: 0 } }
export const LargeCount: Story = { args: { label: 'Stock count', count: 125000 } }

export const ARowOfGroups: Story = {
  name: 'A row of groups, one chosen',
  render: () => <Groups />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Stock count/ }))
    await expect(canvas.getByRole('button', { name: /Stock count/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByRole('button', { name: /^Shelf/ })).toHaveAttribute('aria-pressed', 'false')
  },
}
