import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { KindTag, LinkChip } from './LinkChip'

/**
 * A value that points at another row: its name and code ("Aisle 4 · A-04") as a button that opens it, an
 * optional `kind` tag naming its table, and optional small actions, Go there and Filter. Give
 * `filterDisabledReason` when the list behind cannot filter by it. A row the viewer may not read is
 * `unreadable`: it shows only "Not visible to you". Use it wherever a field links to a row (drill pane, row
 * page, tree).
 */
const meta = {
  title: 'Shop floor/LinkChip',
  component: LinkChip,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { label: 'Aisle 4', code: 'A-04', kind: 'Aisle', onOpen: fn(), onGoThere: fn(), onFilter: fn() },
} satisfies Meta<typeof LinkChip>
export default meta
type Story = StoryObj<typeof meta>

export const WithActions: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Aisle 4 · A-04' }))
    await expect(args.onOpen).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Filter' }))
    await expect(args.onFilter).toHaveBeenCalled()
  },
}

export const NameOnly: Story = { args: { code: undefined, kind: undefined, onGoThere: undefined, onFilter: undefined } }

export const NotOpenable: Story = { name: 'Plain text (nothing to open)', args: { onOpen: undefined, onGoThere: undefined, onFilter: undefined } }

export const FilterUnavailable: Story = {
  name: 'Filter unavailable, with the reason',
  args: { label: 'Riverside depot', code: undefined, kind: 'Depot', onFilter: undefined, filterDisabledReason: 'This list has no Depot column' },
  play: async ({ canvasElement }) => {
    const filter = within(canvasElement).getByRole('button', { name: 'Filter' })
    await expect(filter).toBeDisabled()
    await expect(filter).toHaveAccessibleDescription('This list has no Depot column')
  },
}

export const Unreadable: Story = {
  name: 'Not visible to you',
  args: { label: 'Restricted owner', unreadable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Not visible to you')).toBeVisible()
    await expect(canvas.queryByText(/Restricted owner/)).toBeNull()
  },
}

export const LongNameWraps: Story = {
  name: 'A long name wraps beside its actions',
  args: { label: 'Kirloskar 62.5 kVA diesel generator at Thampanoor Junction', code: 'DG-SET-0042-KOEL2019110400042', kind: 'Asset' },
  decorators: [(Story) => <div className="max-w-sm"><Story /></div>],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

export const Kind: Story = {
  name: 'KindTag on its own',
  render: () => <KindTag>Shelf</KindTag>,
}
