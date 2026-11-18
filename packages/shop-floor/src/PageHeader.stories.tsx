import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { PageHeader } from './PageHeader'
import { Button } from './Button'

/**
 * The top of every page (#1288): breadcrumb, a Title Case title with its count beside it, the page's actions on
 * the title's row (at most one primary, before More), and at most one muted status line. No border: spacing only.
 * Say each number once: the status line never repeats what the count says.
 */
const meta = {
  title: 'Shop floor/PageHeader',
  component: PageHeader,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { title: 'Site' },
} satisfies Meta<typeof PageHeader>
export default meta
type Story = StoryObj<typeof meta>

export const PlainList: Story = {
  args: {
    breadcrumb: <><a href="#organisation">Organisation</a> / Site</>,
    count: <span>146 total</span>,
    actions: <><Button variant="primary">New Site</Button><Button>More</Button></>,
  },
  play: async ({ canvasElement }) => {
    const header = within(canvasElement).getByTestId('page-header')
    await expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent('Site')
    await expect(within(header).getByTestId('page-header-count')).toHaveTextContent('146 total')
    await expect(within(header).queryByTestId('page-header-status')).toBeNull()
  },
}

export const WithStatusLine: Story = {
  args: {
    breadcrumb: <><a href="#home">Home</a> / People and access</>,
    title: 'Leavers Who Can Still Sign In',
    count: <span>5 can still sign in</span>,
    actions: <><Button>Refresh Now</Button><Button>More</Button></>,
    status: <>Leaver job: Off · last run never · Checked 18-Nov-2026 13:05</>,
  },
  play: async ({ canvasElement }) => {
    const header = within(canvasElement).getByTestId('page-header')
    await expect(within(header).getByTestId('page-header-status')).toHaveTextContent('Checked 18-Nov-2026 13:05')
    await expect(within(header).getByTestId('page-header-actions')).toHaveTextContent('Refresh NowMore')
  },
}

export const TitleOnly: Story = {
  args: { title: 'Instance Health' },
  play: async ({ canvasElement }) => {
    const header = within(canvasElement).getByTestId('page-header')
    for (const part of ['page-header-breadcrumb', 'page-header-count', 'page-header-actions', 'page-header-status'])
      await expect(within(header).queryByTestId(part)).toBeNull()
  },
}
