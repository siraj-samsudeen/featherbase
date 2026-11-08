import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { FieldGrid, type FieldGridGroup } from './FieldGrid'

const BIN_FIELDS: FieldGridGroup[] = [
  { title: 'Location', fields: [
    { label: 'Depot', value: 'Riverside depot' },
    { label: 'Aisle', value: 'Aisle 4 · A-04' },
    { label: 'Temperature zone', value: '', empty: true },
  ] },
  { title: 'Handling', fields: [
    { label: 'Opened on', value: '05-Feb-2019' },
    { label: 'Insured value', value: '₹12,45,000.00' },
    { label: 'Instructions', long: true, value: 'Stack cartons no more than four high. Keep the walkway beside the bin clear for the pallet jack. Heavy drums go on the floor level only, never above. Report any spill at once to the depot lead and fence the area off until it is cleaned. Fragile goods are marked with a red label and go on the top shelf.' },
    { label: 'Hazard class', value: '', empty: true },
    { label: 'Supervisor note', value: '', empty: true },
  ] },
]

const meta = {
  title: 'Shop floor/FieldGrid',
  component: FieldGrid,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A row's fields, read only: label and value in two columns, in titled groups. Every `empty` field gathers under one closed " +
          '"n empty fields"; a `long` value is clamped to three lines with Show more. Long codes wrap rather than widen the page. Use it to ' +
          'show a row in a drill pane or a summary; editing goes through the Admin form view.',
      },
    },
  },
  decorators: [(Story) => <div className="max-w-xl"><Story /></div>],
  args: { groups: BIN_FIELDS },
} satisfies Meta<typeof FieldGrid>
export default meta
type Story = StoryObj<typeof meta>

export const Grouped: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('3 empty fields')).toBeVisible()
  },
}

export const LongValueOpens: Story = {
  name: 'A long value opens with Show more',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const more = canvas.getByRole('button', { name: 'Show more' })
    await userEvent.click(more)
    await expect(canvas.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  },
}

export const NoGroupTitles: Story = {
  args: { groups: [{ fields: [{ label: 'Store', value: '1501 Attakulangara' }, { label: 'Area Manager', value: 'Meena S' }, { label: 'Opened on', value: '05-Feb-2019' }] }] },
}

export const AllEmpty: Story = {
  name: 'Every field empty',
  args: { groups: [{ title: 'Handling', fields: [{ label: 'Hazard class', value: '', empty: true }, { label: 'Supervisor note', value: '', empty: true }] }] },
}

export const LongCodeWraps: Story = {
  name: 'A long code wraps, never widens the grid',
  args: { groups: [{ fields: [{ label: 'Serial', value: 'DG-SET-0042-KIRLOSKAR-62.5KVA-SERIAL-KOEL2019110400042-WARRANTY-EXTENDED' }, { label: 'Asset', value: 'Kirloskar 62.5 kVA generator' }] }] },
  decorators: [(Story) => <div className="max-w-xs"><Story /></div>],
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector('dl')!
    await expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth)
  },
}
