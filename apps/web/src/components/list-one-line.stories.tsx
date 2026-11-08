import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MoreColumnsHint, OneLine, useMoreToTheRight } from './list-one-line'

const NOTE = 'The site sits beside the old canal road, past the second bus stop after Attakulangara junction; the gate is on the left.'

const meta = {
  title: 'Admin/List/OneLine',
  component: OneLine,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One list value on one line: as wide as its content up to a maximum (`className`, max-w-80 by default), clipped with an ellipsis ' +
          'past it, and its full text as a tooltip on hover only when it is clipped. `MoreColumnsHint` is the fade and arrow at the right ' +
          'edge of a list that scrolls sideways, shown while `useMoreToTheRight(box)` says there is more. The Admin list view uses both; ' +
          'use them in any table whose rows must stay one line.',
      },
    },
  },
  args: { children: NOTE },
} satisfies Meta<typeof OneLine>
export default meta
type Story = StoryObj<typeof meta>

export const Clipped: Story = {
  name: 'A long value is clipped, and shows in full on hover',
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByText(NOTE)
    await expect(box.getBoundingClientRect().width).toBeLessThanOrEqual(321)
    await expect(getComputedStyle(box).textOverflow).toBe('ellipsis')
    await userEvent.hover(box)
    await waitFor(() => expect(box).toHaveAttribute('title', NOTE))
  },
}

export const Fits: Story = {
  name: 'A short value gets no tooltip',
  args: { children: 'Tamil Nadu' },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByText('Tamil Nadu')
    await userEvent.hover(box)
    await expect(box).not.toHaveAttribute('title')
  },
}

export const Narrower: Story = { name: 'A narrower maximum', args: { className: 'max-w-40' } }

const STORES = ['1501 Attakulangara', '1515 Kattakada', '1622 Thampanoor']
const COLUMNS = ['Store', 'Area', 'Area Manager', 'Opened on', 'Floor area', 'GST number', 'Phone', 'Address', 'Generator', 'Last audit']

/** A table wider than its box, with the hint at its right edge. */
function WideTable() {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const more = useMoreToTheRight(box)
  return (
    <div className="relative max-w-3xl rounded-card border border-border">
      <div ref={setBox} data-testid="wide-scroll" className="overflow-x-auto">
        <table className="text-sm">
          <thead><tr>{COLUMNS.map((c) => <th key={c} className="px-3 py-2 text-left whitespace-nowrap">{c}</th>)}</tr></thead>
          <tbody>{STORES.map((s) => <tr key={s} className="border-t border-border">{COLUMNS.map((c) => <td key={c} className="px-3 py-2"><OneLine>{c === 'Store' ? s : `${c} of ${s}`}</OneLine></td>)}</tr>)}</tbody>
        </table>
      </div>
      {more && <MoreColumnsHint box={box} />}
    </div>
  )
}

export const MoreToTheRight: Story = {
  name: 'More columns to the right are signalled',
  render: () => <WideTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scroll = canvas.getByTestId('wide-scroll')
    await userEvent.click(await canvas.findByRole('button', { name: 'Show more columns' }))
    await waitFor(() => expect(scroll.scrollLeft).toBeGreaterThan(0))
    scroll.scrollLeft = scroll.scrollWidth
    await waitFor(() => expect(canvas.queryByTestId('list-more-columns')).toBeNull())
  },
}
