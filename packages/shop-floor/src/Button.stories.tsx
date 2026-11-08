import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Button, buttonClasses, iconButtonClasses } from './Button'
import { ChevronDown, ExternalLink, Plus, X } from './icons'

/**
 * The one button of every screen. `primary` for the single main action of a screen or dialog, `secondary` (the
 * default) for the others, `quiet` for low-weight actions inside cards and panes, `danger` for deleting or
 * discarding. `loading` shows a spinner, keeps the label and refuses clicks; `block` fills the width (a sign-in
 * form). For a router Link or an anchor that must read as a button, use `buttonClasses()` on that element
 * instead; for an icon-only control, `iconButtonClasses()` with an aria-label.
 */
const meta = {
  title: 'Shop floor/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { children: 'Save checklist' },
} satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { variant: 'primary', icon: <Plus aria-hidden size={18} />, children: 'Start a checklist' } }
export const Secondary: Story = { args: { variant: 'secondary', children: 'Export to Excel' } }
export const Quiet: Story = { args: { variant: 'quiet', children: 'See all' } }
export const Danger: Story = { args: { variant: 'danger', children: 'Delete store' } }

export const Loading: Story = {
  args: { variant: 'primary', loading: true, children: 'Saving' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Saving' })
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
  },
}

export const Disabled: Story = { args: { disabled: true, children: 'Submit for approval' } }

export const Block: Story = {
  name: 'Block (fills the width)',
  args: { variant: 'primary', block: true, children: 'Sign in' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Sign in' })
    await expect(button.getBoundingClientRect().width).toBe(button.parentElement!.getBoundingClientRect().width)
  },
}

export const MenuOpen: Story = {
  name: 'Opens a menu (pressed while open)',
  args: { 'aria-expanded': true, 'aria-haspopup': 'menu', children: <>More actions <ChevronDown aria-hidden data-chevron size={16} /></> },
}

export const LongLabelStaysOneLine: Story = {
  name: 'A long label stays one line',
  args: { children: 'Send the October stock count to the regional office' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button')
    // One line of text inside the control height.
    await expect(button.getBoundingClientRect().height).toBeLessThan(48)
  },
}

/** Every variant side by side, as a toolbar would hold them. */
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" icon={<Plus aria-hidden size={18} />}>Start a checklist</Button>
      <Button>Secondary</Button>
      <Button variant="quiet">Quiet</Button>
      <Button variant="danger">Delete</Button>
      <Button variant="primary" loading>Saving</Button>
      <Button disabled>Disabled</Button>
    </div>
  ),
}

export const LinkAsButton: Story = {
  name: 'A link that reads as a button (buttonClasses)',
  render: () => (
    <a href="#full-report" className={buttonClasses()}>
      <ExternalLink aria-hidden size={18} />
      Open the full report
    </a>
  ),
}

export const IconOnly: Story = {
  name: 'Icon only (iconButtonClasses)',
  render: () => (
    <button type="button" aria-label="Close" className={iconButtonClasses()}>
      <X aria-hidden size={18} />
    </button>
  ),
}
