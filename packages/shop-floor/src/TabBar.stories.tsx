import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { ChartColumn, House, ListChecks, Target, UserRound } from './icons'
import { TabBar } from './TabBar'

const meta = {
  title: 'Shop floor/TabBar',
  component: TabBar,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "An app's main pages as tabs fixed to the bottom of a phone screen, within reach of a thumb: an icon over a one-line label, the " +
          'current page marked by a bar, a bolder label and `current`. Phone only: from the `sm` width up it is not drawn, and the page ' +
          'keeps its own navigation. Use 3 to 5 tabs. `preview` draws it in place at any width, as these stories do; leave it off in an app.',
      },
    },
  },
  decorators: [(Story) => <div className="mx-auto w-full max-w-sm overflow-hidden rounded-card border border-border"><Story /></div>],
  args: {
    preview: true,
    label: 'Example app',
    testId: 'story-tab-bar',
    tabs: [
      { label: 'Today', icon: House, href: '#today' },
      { label: 'Targets', icon: ChartColumn, href: '#targets', current: true },
      { label: 'Checklists', icon: ListChecks, href: '#checklists' },
      { label: 'Me', icon: UserRound, href: '#me' },
    ],
  },
} satisfies Meta<typeof TabBar>
export default meta
type Story = StoryObj<typeof meta>

export const FourTabs: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'Targets' })).toHaveAttribute('aria-current', 'page')
  },
}

export const LongLabelsTruncate: Story = {
  name: 'Long labels are cut to one line',
  args: {
    tabs: [
      { label: 'Today', icon: House, href: '#today', current: true },
      { label: 'Maintenance requests', icon: Target, href: '#maintenance' },
      { label: 'Opening and closing checklists', icon: ListChecks, href: '#checklists' },
      { label: 'Monthly sales targets', icon: ChartColumn, href: '#targets' },
      { label: 'Me', icon: UserRound, href: '#me' },
    ],
  },
  play: async ({ canvasElement }) => {
    const label = within(canvasElement).getByText('Opening and closing checklists')
    await expect(getComputedStyle(label).textOverflow).toBe('ellipsis')
    await expect(label.scrollWidth).toBeGreaterThan(label.clientWidth)
  },
}
