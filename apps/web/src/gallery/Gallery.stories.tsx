// The component gallery (#380) and its relational demos (#910) as stories,
// the same components and data, so each gallery example has a story. The
// kit's own stories (packages/shop-floor/src/*.stories.tsx) show each
// component's states one by one; these show the gallery's combined demos.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Gallery } from './Gallery'
import { ChipsDemo, DrillPaneDemo, FieldGridDemo, PathBarDemo, TreeDemo, ViewToggleDemo } from './RelationalExamples'

const meta = {
  title: 'Gallery',
  component: Gallery,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The component gallery served at /gallery.html: every shared Shop Floor component live in the current theme, searchable by name ' +
          'or purpose. Each component also has its own stories under "Shop floor"; reach for those to pick a component, and for these to ' +
          'see the components working together (a drill pane with chips, a field grid and a view toggle; a path bar; a tree).',
      },
    },
  },
} satisfies Meta<typeof Gallery>
export default meta
type Story = StoryObj

export const Everything: Story = {
  name: 'The whole gallery',
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'Components' })).toBeVisible()
    // Desktop: nothing in the gallery pushes the page sideways.
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

export const Search: Story = {
  name: 'Searching the gallery',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search components' }), 'tree')
    await expect(canvas.getByRole('heading', { name: 'Tree outline' })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Buttons' })).toBeNull()
    await userEvent.clear(canvas.getByRole('searchbox', { name: 'Search components' }))
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search components' }), 'nothing like this')
    await expect(canvas.getByText('No matching components')).toBeVisible()
  },
}

export const DrillPane: Story = { name: 'Drill pane demo', render: () => <DrillPaneDemo /> }
export const PathBar: Story = { name: 'Path bar demo', render: () => <PathBarDemo /> }
export const Chips: Story = { name: 'Link and group chips demo', render: () => <ChipsDemo /> }
export const FieldGrid: Story = { name: 'Field grid demo', render: () => <FieldGridDemo /> }
export const Tree: Story = { name: 'Tree outline demo', render: () => <TreeDemo /> }
export const ViewToggle: Story = { name: 'Table or compact demo', render: () => <ViewToggleDemo /> }
