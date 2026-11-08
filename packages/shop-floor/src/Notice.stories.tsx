import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Notice } from './Notice'

const meta = {
  title: 'Shop floor/Notice',
  component: Notice,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'An inline message about the screen it sits on, in words: `info` (the default) for guidance, `caution` for a mode or a risk, ' +
          '`positive` for a finished action, `negative` for a failure (announced as an alert). Use it for a lasting message on the page; ' +
          'use a toast (`useToast`) for a short confirmation of what just happened, and `EmptyState` for a list with nothing in it.',
      },
    },
  },
  args: { children: 'Forgot your password? Reset it in StyleHR, or ask your Store Manager.' },
} satisfies Meta<typeof Notice>
export default meta
type Story = StoryObj<typeof meta>

export const Info: Story = {}
export const Caution: Story = { args: { tone: 'caution', children: "Test mode: StyleHR is not asked. Enter an employee code to open that person's view." } }
export const Positive: Story = { args: { tone: 'positive', children: 'Your password has been updated.' } }

export const Negative: Story = {
  args: { tone: 'negative', children: "The report couldn't load right now. Try again in a few minutes." },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent("couldn't load")
  },
}

export const LongText: Story = {
  name: 'Long text wraps inside the notice',
  args: {
    tone: 'caution',
    children:
      'The stock count for 1515 Kattakada was started on 02-Nov-2026 and is still open. Close it before starting a new one, or ask the ' +
      'Area Manager to cancel it: https://example.invalid/stores/1515/stock-counts/2026-11-02/open-count-reference-without-any-spaces',
  },
  play: async ({ canvasElement }) => {
    const notice = within(canvasElement).getByRole('status')
    await expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth)
  },
}
