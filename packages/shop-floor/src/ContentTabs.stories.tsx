import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { ContentTabs } from './ContentTabs'
import { TextInput } from './Field'

type Props = ComponentProps<typeof ContentTabs>

/** The tabs with their own state, as a screen holds them. */
function Tabs(props: Omit<Props, 'value' | 'onChange'> & { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? props.tabs[0].id)
  return <ContentTabs {...props} value={value} onChange={setValue} />
}

const STORE_TABS: Props['tabs'] = [
  { id: 'details', label: 'Details', content: <p className="text-sm text-ink">1501 Attakulangara · opened 05-Feb-2019 · Area Manager: Meena S</p> },
  { id: 'staff', label: 'Staff', content: <p className="text-sm text-ink">18 people on the roster this week.</p> },
  { id: 'notes', label: 'Notes', content: <TextInput aria-label="Store note" placeholder="Type a note, then switch tabs and back" /> },
]

/**
 * Sections of one page as tabs (Details, Staff, Notes), with arrow, Home and End keys between them. Hidden
 * panels stay mounted, so a draft or a search inside one survives switching. The caller holds `value`. Use it to
 * split a page into sections; for moving between pages on a phone use `TabBar`, and for a small exclusive choice
 * that changes a view use `Segmented`.
 */
const meta = {
  title: 'Shop floor/ContentTabs',
  component: ContentTabs,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { label: 'Store', tabs: STORE_TABS, value: 'details', onChange: () => {} },
  render: (args) => <Tabs label={args.label} tabs={args.tabs} initial={args.value} />,
} satisfies Meta<typeof ContentTabs>
export default meta
type Story = StoryObj<typeof meta>

export const ThreeSections: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Details' }))
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Staff' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('18 people')
  },
}

export const DraftSurvivesSwitching: Story = {
  name: 'A draft in a hidden tab survives switching',
  args: { value: 'notes' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Store note' }), 'AC in billing not cooling')
    await userEvent.click(canvas.getByRole('tab', { name: 'Details' }))
    await userEvent.click(canvas.getByRole('tab', { name: 'Notes' }))
    await expect(canvas.getByRole('textbox', { name: 'Store note' })).toHaveValue('AC in billing not cooling')
  },
}

export const ManyTabs: Story = {
  name: 'Many tabs scroll in their own strip',
  args: {
    tabs: ['Details', 'Staff', 'Stock counts', 'Goods receipts', 'Transfers out', 'Transfers in', 'Assets', 'Maintenance', 'Electricity bills', 'Audit findings', 'Customer complaints', 'Notes']
      .map((label) => ({ id: label.toLowerCase().replace(/ /g, '-'), label, content: <p className="text-sm text-ink">{label} of 1501 Attakulangara.</p> })),
  },
  decorators: [(Story) => <div className="max-w-2xl"><Story /></div>],
  play: async ({ canvasElement }) => {
    // The strip scrolls; the page around it does not.
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}
