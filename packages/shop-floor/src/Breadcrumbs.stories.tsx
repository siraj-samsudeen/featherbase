import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Breadcrumbs } from './Breadcrumbs'

/**
 * Where this page sits, as links back up the way: give each earlier item an `href` that keeps its context
 * (filters, tab) and the last item none, which marks it the current page. Use it at the top of a page reached by
 * drilling down. For the path a person walked through linked rows (with Back and Forward), use `PathBar`.
 */
const meta = {
  title: 'Shop floor/Breadcrumbs',
  component: Breadcrumbs,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { items: [{ label: 'Library', href: '#library' }, { label: 'Navigation examples' }] },
} satisfies Meta<typeof Breadcrumbs>
export default meta
type Story = StoryObj<typeof meta>

export const TwoLevels: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'Breadcrumb' })
    await expect(within(nav).getByText('Navigation examples')).toHaveAttribute('aria-current', 'page')
  },
}

export const Deep: Story = {
  args: {
    items: [
      { label: 'Stores', href: '#stores' },
      { label: 'Kerala', href: '#kerala' },
      { label: '1501 Attakulangara', href: '#store-1501' },
      { label: 'Stock counts', href: '#counts' },
      { label: '02-Nov-2026' },
    ],
  },
}

export const LongLabelsWrap: Story = {
  name: 'Long labels wrap, never scroll sideways',
  args: {
    items: [
      { label: 'Assets', href: '#assets' },
      { label: 'Generator sets at the Thampanoor Junction store, opposite the central bus stand', href: '#gensets' },
      { label: 'DG-SET-0042-KIRLOSKAR-62.5KVA-SERIAL-KOEL2019110400042' },
    ],
  },
  decorators: [(Story) => <div className="max-w-md"><Story /></div>],
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation')
    await expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth)
  },
}
