import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Button } from './Button'
import { DrillPane, PaneSection } from './DrillPane'
import { FieldGrid } from './FieldGrid'
import { GroupChip } from './GroupChip'
import { LinkChip } from './LinkChip'
import { SplitWithPane } from './PanePlace'

const POINTS_AT = (
  <PaneSection title="Points at">
    <dl className="grid grid-cols-[minmax(5rem,max-content)_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
      <dt className="text-ink-muted">Aisle</dt>
      <dd><LinkChip label="Aisle 4" code="A-04" onOpen={() => {}} onGoThere={() => {}} onFilter={() => {}} /></dd>
      <dt className="text-ink-muted">Depot</dt>
      <dd><LinkChip label="Riverside depot" onOpen={() => {}} onGoThere={() => {}} filterDisabledReason="This list has no Depot column" /></dd>
      <dt className="text-ink-muted">Owner</dt>
      <dd><LinkChip label="Restricted owner" unreadable /></dd>
    </dl>
  </PaneSection>
)
const POINTED_AT_BY = (
  <PaneSection title="Pointed at by">
    <div className="flex flex-wrap gap-2">
      <GroupChip label="Fields" selected onSelect={() => {}} />
      <GroupChip label="Shelf" count={3} onSelect={() => {}} />
      <GroupChip label="Stock count" count={1240} onSelect={() => {}} />
    </div>
    <FieldGrid groups={[{ fields: [{ label: 'Depot', value: 'Riverside depot' }, { label: 'Opened on', value: '05-Feb-2019' }, { label: 'Insured value', value: '₹12,45,000.00' }] }]} />
  </PaneSection>
)

/**
 * The side or bottom pane that shows one row without leaving the list: its table (`kind`) above its name, the
 * pane's `actions`, a Close button, and the content in `PaneSection`s ("Points at", "Pointed at by"). It takes
 * focus when it opens and Escape closes it. Put it in `SplitWithPane` as the `pane`, at the `place` that
 * `resolvePanePlace` gives (right on a wide window, bottom otherwise); `PanePlace` lets the person choose.
 */
const meta = {
  title: 'Shop floor/DrillPane',
  component: DrillPane,
  tags: ['autodocs'],
  args: {
    kind: 'Bin',
    title: 'North bay · B-104',
    place: 'right',
    onClose: fn(),
    actions: <><Button variant="quiet">Open row page</Button><Button variant="quiet">Edit</Button></>,
    children: <>{POINTS_AT}{POINTED_AT_BY}</>,
  },
  render: (args) => (
    <div className="flex h-[36rem] min-w-0 overflow-hidden rounded-card border border-border">
      <SplitWithPane place={args.place} pane={<DrillPane {...args} />}>
        <div className="p-4 text-sm"><h3 className="font-semibold">Bins</h3><p className="text-ink-muted">The list the pane was opened from.</p></div>
      </SplitWithPane>
    </div>
  ),
} satisfies Meta<typeof DrillPane>
export default meta
type Story = StoryObj<typeof meta>

export const OnTheRight: Story = {
  play: async ({ canvasElement, args }) => {
    const pane = within(canvasElement).getByRole('complementary', { name: 'North bay · B-104' })
    await expect(pane).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalled()
  },
}

export const AtTheBottom: Story = { args: { place: 'bottom' } }

export const NoActions: Story = { args: { actions: undefined } }

export const LongTitleWraps: Story = {
  name: 'A long title wraps beside Close',
  args: { kind: 'Asset', title: 'Kirloskar 62.5 kVA diesel generator set at the Thampanoor Junction store, opposite the central bus stand · DG-SET-0042' },
  play: async ({ canvasElement }) => {
    const pane = within(canvasElement).getByRole('complementary')
    await expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth)
    await expect(within(pane).getByRole('button', { name: 'Close' })).toBeVisible()
  },
}
