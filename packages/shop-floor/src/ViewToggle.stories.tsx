import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { ViewToggle, type ViewMode } from './ViewToggle'

const SHELVES = [
  { name: 'Top shelf', code: 'S-1', load: 'Light cartons', checked: '02-Nov-2026' },
  { name: 'Middle shelf', code: 'S-2', load: 'Pallet jacks', checked: '28-Oct-2026' },
  { name: 'Floor level', code: 'S-3', load: 'Drums', checked: '15-Oct-2026' },
]

function Shelves({ initial = 'table' }: { initial?: ViewMode }) {
  const [view, setView] = useState<ViewMode>(initial)
  return (
    <div className="flex flex-col gap-2">
      <ViewToggle value={view} onChange={setView} />
      {view === 'compact'
        ? <ul data-testid="shelves" className="flex flex-col divide-y divide-border rounded-card border border-border text-sm">
            {SHELVES.map((s) => <li key={s.code} className="flex flex-col px-3 py-2"><span className="font-medium">{s.name} · {s.code}</span><span className="text-ink-muted">{s.load}</span></li>)}
          </ul>
        : <table data-testid="shelves" className="w-full rounded-card border border-border text-sm">
            <thead className="bg-subtle text-left"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Load</th><th className="px-3 py-2">Last checked</th></tr></thead>
            <tbody>{SHELVES.map((s) => <tr key={s.code} className="border-t border-border"><td className="px-3 py-2">{s.name} · {s.code}</td><td className="px-3 py-2">{s.load}</td><td className="px-3 py-2">{s.checked}</td></tr>)}</tbody>
          </table>}
    </div>
  )
}

const meta = {
  title: 'Shop floor/ViewToggle',
  component: ViewToggle,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Table / Compact for a related list: every column, or the name and a few key fields. A `Segmented` with those two choices; the ' +
          'caller holds `value` and draws the list in that shape. Use it above a list of related rows (a drill pane, a row page).',
      },
    },
  },
  args: { value: 'table', onChange: () => {} },
  render: (args) => <Shelves initial={args.value} />,
} satisfies Meta<typeof ViewToggle>
export default meta
type Story = StoryObj<typeof meta>

export const Table: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Compact' }))
    await expect(canvas.getByTestId('shelves').tagName).toBe('UL')
  },
}

export const Compact: Story = { args: { value: 'compact' } }
