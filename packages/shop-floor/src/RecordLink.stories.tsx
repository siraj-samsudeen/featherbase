import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { rowHref } from 'shared'
import { RecordLink, RecordPagesProvider } from './RecordLink'

/**
 * **Every Featherbase record shown on any screen is a RecordLink. A plain-text record name is a bug.**
 * (The owner's navigation rule, 16-Nov-2026: "everything that is a record in FB has to be presented as a
 * link".)
 *
 * One record (a person, a store, a section, a department, a ticket) as a link to it: its readable name,
 * then who or what it is (`detail`, #1216's identity line, "E1001 · Team Leader · Lakeside"), after a
 * middle dot or under the name with `layout="two-lines"`. It opens the app's own page for that Table
 * when the app maps one (`RecordPagesProvider`), else the Featherbase record. Only a record the viewer may
 * not open (`canOpen={false}`) is drawn as plain text, in the same words. Never pass an opaque id as the
 * name. For a field value with Go there and Filter actions in a drill pane, use LinkChip.
 */
const meta = {
  title: 'Shop floor/RecordLink',
  component: RecordLink,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { table: 'Employee', rowId: 'E1001', name: 'Kumar', detail: 'E1001 · Team Leader · Lakeside' },
} satisfies Meta<typeof RecordLink>
export default meta
type Story = StoryObj<typeof meta>

export const Inline: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link')).toHaveAttribute('href', rowHref('Employee', 'E1001'))
  },
}

export const TwoLines: Story = { args: { layout: 'two-lines' } }

export const NotOpenToTheViewer: Story = {
  args: { canOpen: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link')).toBeNull()
  },
}

export const OnTheAppsOwnPage: Story = {
  args: { table: 'dash.section', rowId: 'S7', name: 'Sarees', detail: 'Lakeside', onNavigate: fn() },
  decorators: [(Story) => (
    <RecordPagesProvider pageFor={(table, id) => (table === 'dash.section' ? `/dash/?view=sections&section=${id}` : undefined)}>
      <Story />
    </RecordPagesProvider>
  )],
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('link'))
    await expect(args.onNavigate).toHaveBeenCalledWith('/dash/?view=sections&section=S7')
  },
}
