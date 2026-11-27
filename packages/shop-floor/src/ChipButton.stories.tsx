import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { ChipButton, ChoiceChip } from './ChipButton'

const REASONS = ['Stock arriving', 'Stock out or short', 'Display space', 'Other']

function Reasons() {
  const [picked, setPicked] = useState<string[]>(['Stock arriving'])
  const toggle = (r: string) => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))
  return <div className="flex flex-wrap gap-1.5">{REASONS.map((r) => <ChoiceChip key={r} picked={picked.includes(r)} onToggle={() => toggle(r)}>{r}</ChoiceChip>)}</div>
}

/**
 * ChipButton: a grey chip pressed for a quick fill ("= Last year"). ChoiceChip: one of several choices that can be
 * picked together; picked, it reads as an active FilterChip with a ✕, and its state is aria-pressed.
 */
const meta = {
  title: 'Shop floor/ChipButton',
  component: ChipButton,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { children: '= Last year' },
} satisfies Meta<typeof ChipButton>
export default meta
type Story = StoryObj<typeof meta>

export const QuickFill: Story = {}
export const Choices: Story = {
  render: () => <Reasons />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Display space' }))
    await expect(canvas.getByRole('button', { name: /Display space/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(canvas.getByRole('button', { name: /Stock arriving/ }))
    await expect(canvas.getByRole('button', { name: 'Stock arriving' })).toHaveAttribute('aria-pressed', 'false')
  },
}
