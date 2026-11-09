import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { buttonClasses } from '@featherbase/shop-floor'
import { ActionDisclosure } from './ActionDisclosure'

const ACTIONS = (
  <>
    <button type="button" className={buttonClasses({ variant: 'quiet', className: 'justify-start' })}>Duplicate</button>
    <button type="button" className={buttonClasses({ variant: 'quiet', className: 'justify-start' })}>Export to Excel</button>
    <a href="#history" className={buttonClasses({ variant: 'quiet', className: 'justify-start' })}>See the history</a>
    <button type="button" className={buttonClasses({ variant: 'danger', className: 'justify-start' })}>Retire this store</button>
  </>
)

/**
 * A button ("More actions") that opens a small panel of further actions below it: the less used actions of a
 * form or list, kept out of the toolbar. The links and buttons inside keep their own keyboard behaviour; Escape
 * or focus leaving closes it and returns focus to the button. Open state can be held by the caller (`open`,
 * `onOpenChange`).
 */
const meta = {
  title: 'Admin/ActionDisclosure',
  component: ActionDisclosure,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="flex h-72 justify-end"><Story /></div>],
  args: { label: 'More actions', children: ACTIONS },
} satisfies Meta<typeof ActionDisclosure>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'More actions' })
    await userEvent.click(button)
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('button', { name: 'Retire this store' })).toBeVisible()
  },
}

export const EscapeCloses: Story = {
  name: 'Escape closes it and returns focus',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'More actions' })
    await userEvent.click(button)
    await userEvent.tab()
    await userEvent.keyboard('{Escape}')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).toHaveFocus()
  },
}
