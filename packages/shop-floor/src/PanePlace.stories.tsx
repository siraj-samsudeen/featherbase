import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { Button } from './Button'
import { DrillPane, PaneSection } from './DrillPane'
import { PanePlace, resolvePanePlace, SplitWithPane, type PanePlaceValue } from './PanePlace'

/** The place chooser driving a split with a pane, as the Admin list holds them. */
function Split({ initial = 'auto' }: { initial?: PanePlaceValue }) {
  const [place, setPlace] = useState<PanePlaceValue>(initial)
  const [open, setOpen] = useState(true)
  const resolved = resolvePanePlace(place, window.innerWidth)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <PanePlace value={place} resolved={resolved} onChange={setPlace} />
        {!open && <Button onClick={() => setOpen(true)}>Open the pane again</Button>}
      </div>
      <div className="flex h-[30rem] min-w-0 overflow-hidden rounded-card border border-border">
        <SplitWithPane place={resolved} pane={open
          ? <DrillPane kind="Store" title="1501 Attakulangara" place={resolved} onClose={() => setOpen(false)}>
              <PaneSection title="Points at"><p className="text-sm text-ink">Area: Thiruvananthapuram South</p></PaneSection>
            </DrillPane>
          : null}>
          <ul className="flex flex-col gap-2 p-4 text-sm text-ink">
            <li>1501 Attakulangara</li><li>1515 Kattakada</li><li>1622 Thampanoor</li>
          </ul>
        </SplitWithPane>
      </div>
    </div>
  )
}

/**
 * Where the drill pane sits: Auto / Right / Bottom, Auto naming where it resolved ("Auto (right)").
 * `resolvePanePlace(value, width)` turns the choice into a place (right from 1200px wide). `SplitWithPane` lays
 * the content and the pane out at that place: right, sticky and about 40% wide; or bottom, docked in the room
 * below; focus returns to the opener when the pane closes.
 */
const meta = {
  title: 'Shop floor/PanePlace',
  component: PanePlace,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { value: 'auto', resolved: 'right', onChange: () => {} },
  render: (args) => <Split initial={args.value} />,
} satisfies Meta<typeof PanePlace>
export default meta
type Story = StoryObj<typeof meta>

export const Auto: Story = {
  name: 'Auto (right at 1280)',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Auto (right)' })).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByTestId('split-with-pane')).toHaveAttribute('data-pane', 'right')
    await userEvent.click(canvas.getByRole('button', { name: 'Bottom' }))
    await expect(canvas.getByTestId('split-with-pane')).toHaveAttribute('data-pane', 'bottom')
  },
}

export const Bottom: Story = {
  args: { value: 'bottom' },
  play: async ({ canvasElement }) => {
    const split = within(canvasElement).getByTestId('split-with-pane')
    await expect(split.scrollWidth).toBeLessThanOrEqual(split.clientWidth)
  },
}

export const ClosedAndReopened: Story = {
  name: 'Closed, then opened again',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Close' }))
    await expect(canvas.getByTestId('split-with-pane')).not.toHaveAttribute('data-pane')
    await userEvent.click(canvas.getByRole('button', { name: 'Open the pane again' }))
    await expect(canvas.getByRole('complementary', { name: '1501 Attakulangara' })).toBeVisible()
  },
}
