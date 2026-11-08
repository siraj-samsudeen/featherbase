import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Button } from './Button'
import { Card } from './Card'
import { EmptyState } from './EmptyState'
import { Skeleton } from './Skeleton'

const meta = {
  title: 'Shop floor/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A bordered surface for one group of related content: a Home card, a report section, a form block. Give it a `title` (it becomes ' +
          'a named region) and optional header `actions`; leave both out for a plain surface and pad it yourself (`className="p-4"`). ' +
          'Do not put a whole list or table screen in a card: screens use the full canvas. `cardClasses()` gives the look to another element.',
      },
    },
  },
  args: { title: 'Checklists', children: <p className="p-4 text-sm text-ink">Opening checklist for 1501 Attakulangara, due by 10:00.</p> },
} satisfies Meta<typeof Card>
export default meta
type Story = StoryObj<typeof meta>

export const Titled: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Checklists' })).toBeVisible()
  },
}

export const WithActions: Story = { args: { actions: <Button variant="quiet">See all</Button> } }

export const Untitled: Story = { args: { title: undefined, className: 'p-4', children: <p className="text-sm text-ink">A plain surface with no header.</p> } }

export const WithEmptyState: Story = {
  name: 'Holding an empty state',
  args: {
    actions: <Button variant="quiet">See all</Button>,
    children: (
      <EmptyState title="No checklists yet" body="Runs you start appear here, newest first." action={<Button variant="primary">Start a checklist</Button>} />
    ),
  },
}

export const Loading: Story = {
  name: 'Holding a loading placeholder',
  args: { title: undefined, className: 'p-4', children: <Skeleton label="Loading your numbers" lines={4} /> },
}

export const LongTitle: Story = {
  name: 'A long title keeps the actions in view',
  args: {
    title: 'Pending goods receipts from the Kanchipuram silk weavers co-operative for the Deepavali season',
    actions: <Button variant="quiet">See all</Button>,
  },
  decorators: [(Story) => <div className="max-w-md"><Story /></div>],
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole('region')
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
    await expect(within(card).getByRole('button', { name: 'See all' })).toBeVisible()
  },
}
