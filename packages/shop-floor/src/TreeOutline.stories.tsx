import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { Button } from './Button'
import { TreeOutline, type TreeNode } from './TreeOutline'

/** The tree around one bin, with its own open lines and selection. */
function AroundBin({ open = ['shelves', 's1'], loading = false }: { open?: string[]; loading?: boolean }) {
  const [expanded, setExpanded] = useState(new Set(open))
  const [selected, setSelected] = useState('bin')
  const [all, setAll] = useState(false)
  const counts = Array.from({ length: all ? 8 : 3 }, (_, i) => ({ id: `c${i + 1}`, label: `Count ${String(i + 1).padStart(2, '0')}-Nov-2026`, kind: 'Stock count' }))
  const nodes: TreeNode[] = [
    { id: 'h-to', label: 'Links to', heading: true },
    { id: 'aisle', label: 'Aisle 4', code: 'A-04', kind: 'Aisle', hasChildren: true, loading: loading || expanded.has('aisle') },
    { id: 'depot', label: 'Riverside depot', kind: 'Depot' },
    { id: 'bin', label: 'North bay', code: 'B-104', kind: 'Bin' },
    { id: 'h-from', label: 'Linked from', heading: true },
    { id: 'shelves', label: 'Shelf', group: true, count: 3, children: [
      { id: 's1', label: 'Top shelf', code: 'S-1', kind: 'Shelf', children: [
        { id: 's1-counts', label: 'Stock count', group: true, count: 8, children: counts, more: { shown: counts.length, total: 8, onShowAll: () => setAll(true) } },
      ] },
      { id: 's2', label: 'Middle shelf', code: 'S-2', kind: 'Shelf' },
      { id: 's3', label: 'Floor level', code: 'S-3', kind: 'Shelf' },
    ] },
  ]
  return (
    <div className="rounded-card border border-border p-3">
      <TreeOutline label="Around North bay" nodes={nodes} expanded={expanded} selected={selected} onActivate={setSelected}
        onToggle={(id) => setExpanded((was) => { const next = new Set(was); if (next.has(id)) next.delete(id); else next.add(id); return next })}
        renderActions={(node) => node.id === selected && node.id !== 'bin' && !node.group
          ? <Button variant="secondary" className="min-h-8 px-2 text-xs" onClick={() => setSelected('bin')}>Focus here</Button> : null} />
    </div>
  )
}

/**
 * An expandable outline of related rows (an ARIA tree): what a row links to and what links to it, grouped with
 * counts, opened level by level. Captions (`heading`) are not lines; a line can show `loading` while its
 * children arrive, and a capped group says "first 20 · show all 40" (`more`). One line is in the tab order: Up
 * and Down move, Right opens, Left closes, Enter activates. The caller holds `expanded` and `selected`. Use it
 * for a tree view of a row; for one level of related rows use `GroupChip`s.
 */
const meta = {
  title: 'Shop floor/TreeOutline',
  component: TreeOutline,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: () => <AroundBin />,
} satisfies Meta<typeof TreeOutline>
export default meta
// Each story renders its own tree, which keeps its state.
type Story = StoryObj

export const AroundOneRow: Story = {
  name: 'Around one row',
  play: async ({ canvasElement }) => {
    const tree = within(within(canvasElement).getByRole('tree', { name: 'Around North bay' }))
    await expect(tree.getByRole('treeitem', { name: 'Top shelf · S-1' })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(tree.getByRole('treeitem', { name: 'Stock count 8' }).querySelector('div')!)
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.click(await tree.findByRole('button', { name: 'show all 8' }))
    await expect(tree.getByText('Count 08-Nov-2026')).toBeVisible()
  },
}

export const Keyboard: Story = {
  name: 'Moved through with the keyboard',
  play: async ({ canvasElement }) => {
    const tree = within(canvasElement)
    const bin = tree.getByRole('treeitem', { name: 'North bay · B-104' })
    bin.focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(tree.getByRole('treeitem', { name: 'Shelf 3' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(tree.getByRole('treeitem', { name: 'Shelf 3' })).toHaveAttribute('aria-expanded', 'false')
  },
}

export const Collapsed: Story = { render: () => <AroundBin open={[]} /> }
export const Loading: Story = { name: 'A line loading its children', render: () => <AroundBin open={['aisle']} loading /> }
