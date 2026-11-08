import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from './Button'
import { ToastProvider, useToast } from './Toast'

function Triggers() {
  const toast = useToast()
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast({ tone: 'positive', message: 'Checklist saved' })}>Show a confirmation</Button>
      <Button onClick={() => toast({ message: 'Stock count moved to 03-Nov-2026' })}>Show information</Button>
      <Button variant="danger" onClick={() => toast({ tone: 'negative', message: 'Could not save. Check your connection and try again.' })}>
        Show a failure
      </Button>
    </div>
  )
}

const meta = {
  title: 'Shop floor/Toast',
  component: ToastProvider,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A short confirmation of what just happened ("Checklist saved"), in a corner of the screen. Mount `ToastProvider` once near the ' +
          'root and call `useToast()({ tone, message })` below it. `positive` and `info` leave after 5 seconds (paused while pointed at or ' +
          'focused); `negative` is an alert that stays until dismissed. For a message that belongs to the page, use `Notice`.',
      },
    },
  },
  args: { children: <Triggers /> },
} satisfies Meta<typeof ToastProvider>
export default meta
type Story = StoryObj<typeof meta>

export const Confirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show a confirmation' }))
    const region = canvas.getByRole('region', { name: 'Notifications' })
    await waitFor(() => expect(within(region).getByRole('status')).toHaveTextContent('Checklist saved'))
  },
}

export const Failure: Story = {
  name: 'A failure stays until dismissed',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show a failure' }))
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveTextContent('Could not save')
    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(canvas.queryByRole('alert')).toBeNull())
  },
}
