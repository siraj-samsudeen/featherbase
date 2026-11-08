import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { ListChecks, Search } from './icons'

const meta = {
  title: 'Shop floor/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What an empty list or screen says instead of a blank space: a title plus a `body` (why it is empty), an `action` (the way ' +
          'forward), or both; a title alone does not type-check. Use it whenever a list, search or section has nothing to show. ' +
          '`DataList` shows one by itself from its `empty` prop.',
      },
    },
  },
  args: { title: 'No checklists yet', body: 'Runs you start appear here, newest first.' },
} satisfies Meta<typeof EmptyState>
export default meta
type Story = StoryObj<typeof meta>

export const WithBody: Story = {}

export const WithAction: Story = {
  args: { body: undefined, action: <Button variant="primary">Start a checklist</Button> },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Start a checklist' })).toBeVisible()
  },
}

export const WithBodyAndAction: Story = {
  args: { icon: ListChecks, action: <Button variant="primary">Start a checklist</Button> },
}

export const NoSearchResults: Story = {
  name: 'No search results',
  args: { icon: Search, title: 'No matching stores', body: 'Try another store code or name, or clear the search.' },
}
