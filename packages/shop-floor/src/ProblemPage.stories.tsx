import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Button, buttonClasses } from './Button'
import { ProblemPage } from './ProblemPage'

/**
 * What a screen says when it cannot show what was asked for (#1327): `not-found`, `no-access` or `failed`,
 * each with a plain title and body and the one way forward. Use it for a missing record, report or page, a
 * refusal, and a load that failed, instead of a red line.
 */
const meta = {
  title: 'Shop floor/ProblemPage',
  component: ProblemPage,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    kind: 'not-found',
    title: 'This Site isn’t here',
    body: 'No Site has the ID “NOPE”. It may have been deleted, or the link is wrong.',
    action: <a href="#" className={buttonClasses()}>Back to Site</a>,
  },
} satisfies Meta<typeof ProblemPage>
export default meta
type Story = StoryObj<typeof meta>

export const NotFound: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'Back to Site' })).toBeVisible()
  },
}

export const NoAccess: Story = {
  args: {
    kind: 'no-access',
    title: 'You can’t open this Site',
    body: 'Your account can’t see it. Ask your administrator if you need it.',
    action: <a href="#" className={buttonClasses()}>Go to the Admin home</a>,
  },
}

export const Failed: Story = {
  name: 'Couldn’t open',
  args: {
    kind: 'failed',
    title: 'This Site couldn’t be opened',
    body: 'The server didn’t answer. Try again in a moment.',
    action: <Button>Try again</Button>,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toBeVisible()
  },
}
