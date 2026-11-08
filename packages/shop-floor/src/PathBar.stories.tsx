import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { PathBar, RecentPaths, type PathStep } from './PathBar'

const STEPS: PathStep[] = [
  { key: 'home', label: 'Home' },
  { key: 'bins', kindLabel: 'List', label: 'Bins' },
  { key: 'aisle', kindLabel: 'Filter', label: 'Aisle: Aisle 4' },
  { key: 'bin', label: 'North bay · B-104' },
  { key: 'shelf', label: 'Top shelf · S-1' },
]
const LONG_WALK: PathStep[] = [
  { key: 'home', label: 'Home' },
  { key: 'stores', kindLabel: 'List', label: 'Stores' },
  { key: 'kerala', kindLabel: 'Filter', label: 'State: Kerala' },
  { key: 's1501', label: '1501 Attakulangara' },
  { key: 'assets', kindLabel: 'List', label: 'Assets' },
  { key: 'dg', label: 'Kirloskar 62.5 kVA generator · DG-0042' },
  { key: 'jobs', kindLabel: 'List', label: 'Maintenance jobs' },
  { key: 'job', label: 'Oil and filter change · MJ-2026-1104' },
  { key: 'vendor', label: 'Sree Padmanabha Power Services' },
  { key: 'invoices', kindLabel: 'List', label: 'Vendor invoices' },
  { key: 'invoice', label: 'Invoice SPPS/2026/0981' },
  { key: 'payment', label: 'Payment run 07-Nov-2026' },
]
const RECENT = [
  { key: 'r1', label: 'Bins › Aisle 4 › North bay · B-104' },
  { key: 'r2', label: 'Depots › Riverside depot › Aisle 2' },
  { key: 'r3', label: 'Shelves › Floor level · S-3' },
]

/** A path the story can walk, with Back, Forward and the steps. */
function Walk({ steps = STEPS, at = steps.length - 1, recent = RECENT }: { steps?: PathStep[]; at?: number; recent?: typeof RECENT }) {
  const [current, setCurrent] = useState(at)
  return (
    <div className="flex min-w-0 flex-col rounded-card border border-border">
      <PathBar steps={steps} current={current} onStep={setCurrent}
        onBack={() => setCurrent(Math.max(0, current - 1))} onForward={() => setCurrent(Math.min(steps.length - 1, current + 1))}
        onCopyLink={() => {}} recent={<RecentPaths paths={recent} onPick={() => {}} />} />
    </div>
  )
}

const meta = {
  title: 'Shop floor/PathBar',
  component: PathBar,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The path a person walked through linked rows and lists: Back and Forward (disabled at the ends), each step as a button (the ' +
          'current one marked), Copy link with an inline "Copied", and a slot for `RecentPaths`, a menu of up to ten earlier paths. Steps ' +
          'show whole or not at all; those that do not fit sit behind a "…" menu on their side, and a single step wider than the bar is ' +
          'shortened at a word with its full name as its title. Use it above a screen reached by drilling through relations; for a fixed ' +
          'place in a hierarchy use `Breadcrumbs`.',
      },
    },
  },
  args: { steps: STEPS, current: STEPS.length - 1, onStep: fn(), onBack: fn(), onForward: fn(), onCopyLink: fn() },
  render: () => <Walk />,
} satisfies Meta<typeof PathBar>
export default meta
type Story = StoryObj<typeof meta>

/** At 1280 the bar is one line: buttons and path share a row. */
async function oneLine(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const back = canvas.getByRole('button', { name: 'Back' }).getBoundingClientRect()
  const path = canvas.getByRole('navigation', { name: 'Path' }).getBoundingClientRect()
  await expect(Math.abs(path.top + path.height / 2 - (back.top + back.height / 2))).toBeLessThan(2)
}

export const FiveSteps: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneLine(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Forward' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    await expect(canvas.getByRole('button', { name: 'North bay · B-104' })).toHaveAttribute('aria-current', 'step')
  },
}

export const CopyLink: Story = {
  name: 'Copy link says Copied',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Copy link' }))
    await expect(canvas.getByText('Copied')).toBeVisible()
  },
}

export const ManySteps: Story = {
  name: 'Many steps: the earlier ones wait behind …',
  render: () => <Walk steps={LONG_WALK} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const earlier = await canvas.findByRole('button', { name: 'Earlier steps' })
    await oneLine(canvasElement)
    await userEvent.click(earlier)
    await expect(canvas.getByRole('menuitem', { name: 'Home' })).toBeVisible()
  },
}

export const InTheMiddle: Story = {
  name: 'In the middle of a long walk: … on both sides',
  render: () => <Walk steps={LONG_WALK} at={5} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Later steps' })).toBeVisible())
    await expect(canvas.getByRole('button', { name: 'Earlier steps' })).toBeVisible()
  },
}

const HUGE = 'Kirloskar 62.5 kVA diesel generator set installed at the Thampanoor Junction store opposite the central bus stand, serviced by Sree Padmanabha Power Services under the annual maintenance contract signed on 01-Apr-2026 for three years'
export const OneHugeStep: Story = {
  name: 'One step wider than the bar is shortened, its name kept',
  render: () => <Walk steps={[{ key: 'home', label: 'Home' }, { key: 'dg', label: HUGE }]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const step = await canvas.findByRole('button', { name: HUGE })
    await waitFor(() => expect(step).toHaveAttribute('title', HUGE))
    await expect(step.textContent).toMatch(/…$/)
    const bar = canvas.getByRole('navigation', { name: 'Path' })
    await expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth)
  },
}

export const Recent: Story = {
  name: 'Recent paths menu',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Recent paths' }))
    await expect(within(canvas.getByRole('menu', { name: 'Recent paths' })).getAllByRole('menuitem')).toHaveLength(3)
  },
}

export const NoRecentPaths: Story = {
  render: () => <Walk recent={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Recent paths' }))
    await expect(canvas.getByText('No recent paths yet')).toBeVisible()
  },
}

export const FirstStep: Story = {
  name: 'At the first step',
  render: () => <Walk at={0} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Back' })).toBeDisabled()
  },
}
