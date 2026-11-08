import type { Meta, StoryObj } from '@storybook/react-vite'
import { Logo } from './Logo'

const meta = {
  title: 'Admin/Logo',
  component: Logo,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The Featherbase mark: a notched feather on a tile in the action colour, legible down to 16px. Decorative (aria-hidden), so put ' +
          'the product name beside it in text. Sized by `className`; use it in the top bar and sign-in page only.',
      },
    },
  },
} satisfies Meta<typeof Logo>
export default meta
type Story = StoryObj<typeof meta>

export const TopBar: Story = { name: 'Top bar size (24px)' }
export const Favicon: Story = { name: 'Favicon size (16px)', args: { className: 'h-4 w-4' } }
export const Large: Story = { name: 'Sign-in size (48px)', args: { className: 'h-12 w-12' } }
