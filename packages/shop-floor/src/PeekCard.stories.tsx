import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { CountChip } from './GroupChip'
import { PeekCard } from './PeekCard'

/**
 * The shared peek card (#1349, #1289): hovering, or focusing, a count shows its first rows and the way to all of
 * them, without leaving the page. Leaving, or Escape, closes it.
 */
const meta = {
  title: 'Shop floor/PeekCard',
  component: PeekCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    label: 'Sections in Bayside',
    delay: 0,
    trigger: <CountChip count={3} label="Sections" href="#sections" />,
    children: <>
      <b className="text-sm font-semibold">Sections in Bayside</b>
      <div className="flex flex-wrap gap-1.5 text-[13px]">
        <a href="#a" className="rounded-full bg-subtle px-2.5 py-0.5">Footwear</a>
        <a href="#b" className="rounded-full bg-subtle px-2.5 py-0.5">Kids</a>
        <a href="#c" className="rounded-full bg-subtle px-2.5 py-0.5">Watches</a>
      </div>
      <a href="#sections" className="text-[13px] text-action">Open all 3 as a list</a>
    </>,
  },
} satisfies Meta<typeof PeekCard>
export default meta
type Story = StoryObj<typeof meta>

export const OnHover: Story = {
  name: 'A count and its card',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(canvas.getByRole('link', { name: '3 Sections' }))
    await waitFor(() => expect(canvas.getByRole('dialog', { name: 'Sections in Bayside' })).toBeInTheDocument())
  },
}
