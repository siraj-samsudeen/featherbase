import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { rowHref } from 'shared'
import { PersonLabel } from './PersonLabel'

/**
 * **Every person is named so they can be told apart (#1345).** One component for every surface that names a
 * person: search, pickers, reference cells, record headers, Recently Opened and activity lines. The name is a
 * RecordLink to the Person; beside it, in muted text, `employee code · role · place`. No surface builds its own.
 *
 * - `stacked` puts the words on a second line (search, pickers, headers); they wrap on a phone.
 * - `inline` puts them after the name (reference cells, activity); a narrow space drops the role first, then
 *   the place, never the code.
 * - Several current codes: the main one, then a `+1 code` chip listing the others.
 * - No code: `role · place`. Nothing at all: the email. Former staff: `Former Staff · left … · code`.
 * - The server works the values out, and leaves out any part the viewer may not read. Made-up people.
 */
const meta = {
  title: 'Shop floor/PersonLabel',
  component: PersonLabel,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { rowId: 'psn_madeupmadeupmadeupaa', name: 'Arun Prakash', label: { code: 'TN-10001', role: 'Store Manager', place: 'Lakeside', email: 'arun.prakash@example.test' } },
} satisfies Meta<typeof PersonLabel>
export default meta
type Story = StoryObj<typeof meta>

export const Stacked: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('link')).toHaveAttribute('href', rowHref('Person', 'psn_madeupmadeupmadeupaa'))
    await expect(c.getByTestId('person-meta')).toHaveTextContent('TN-10001 · Store Manager · Lakeside')
  },
}

export const Inline: Story = { args: { layout: 'inline' } }

export const InANarrowCell: Story = {
  args: { layout: 'inline' },
  decorators: [(Story) => <div style={{ width: '13rem' }}><Story /></div>],
}

export const SeveralCodes: Story = {
  args: { label: { code: 'TN-10002', role: 'Cashier', place: 'Hill Road', more_codes: [{ code: 'TN-10001', table: 'Employee', row_id: 'TN-10001' }] } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('person-more-codes')).toHaveTextContent('+1 code')
  },
}

export const NoCode: Story = { args: { label: { role: 'Area Manager', place: 'North Cluster' } } }

export const OnlyAnEmail: Story = {
  args: { name: 'Visiting Auditor', label: { email: 'auditor@example.test' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('person-meta')).toHaveTextContent('auditor@example.test')
  },
}

export const FormerStaff: Story = { args: { label: { code: 'TN-10003', standing: 'left', left_on: '2026-08-31' } } }

export const Consultant: Story = { args: { name: 'Kavya Iyer', label: { standing: 'consultant', company: 'Made-up Advisory' } } }

export const TwoWhoReadTheSame: Story = {
  args: { withEmail: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('person-meta')).toHaveTextContent('arun.prakash@example.test')
  },
}

export const NotOpenToTheViewer: Story = {
  args: { canOpen: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link')).toBeNull()
  },
}
