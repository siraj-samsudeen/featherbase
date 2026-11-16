// The merchandise hierarchy's shared parts (#1175): one path wording, one picker.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { HierarchyGroups, HierarchyPath, HierarchyPicker, hierarchyText, type HierarchyLeaf, type HierarchyNode } from '@featherbase/shop-floor/hierarchy'

const women = { division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' }
const leggings = (subdivision: string, code: string) => ({ code, name: 'Girls Leggings', division: 'Kids', subdivision, category: 'Bottoms' })

describe('hierarchy path', () => {
  test('in order, one separator, and a missing level says so', () => {
    expect(hierarchyText({ ...women, subcategory: 'Sarees' })).toBe('Women › Ethnic Wear › Sarees and Blouses › Sarees')
    expect(hierarchyText({ division: 'Kids', subdivision: '', category: 'Bottoms' })).toBe('Kids › No sub-division › Bottoms')
    render(<HierarchyPath path={women} />)
    expect(screen.getByTestId('hierarchy-path')).toHaveTextContent('Women›Ethnic Wear›Sarees and Blouses')
  })

  test('a shared path shows once; different paths group, telling two same names apart', () => {
    const list = (items: { code: string; name: string }[]) => <ul>{items.map(i => <li key={i.code}>{i.name}</li>)}</ul>
    const { unmount } = render(<HierarchyGroups items={[{ code: '1', name: 'Sarees', ...women }, { code: '2', name: 'Sari Blouses', ...women }]} pathOf={i => i}>{list}</HierarchyGroups>)
    expect(screen.getAllByTestId('hierarchy-path')).toHaveLength(1)
    expect(screen.queryAllByTestId('hierarchy-group')).toHaveLength(0)
    unmount()
    render(<HierarchyGroups items={[leggings('Girls Western', 'W'), leggings('Girls Ethnic', 'E')]} pathOf={i => i}>{list}</HierarchyGroups>)
    const groups = screen.getAllByTestId('hierarchy-group')
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['Kids › Girls Ethnic › Bottoms', 'Kids › Girls Western › Bottoms'])
    for (const group of groups) expect(within(group).getByText('Girls Leggings')).toBeInTheDocument()
  })
})

const LEVELS: HierarchyNode[] = [women, { ...women, category: 'Kurtis and Sets' }, { division: 'Kids', subdivision: 'Girls Ethnic', category: 'Bottoms' }]
const LEAVES: Record<string, (HierarchyLeaf & { where: string })[]> = {
  'Sarees and Blouses': [{ code: '1', name: 'Sarees', where: 'Already yours', disabled: true }, { code: '2', name: 'Sari Blouses', where: 'Not in any section' }],
  'Kurtis and Sets': [{ code: '3', name: 'Kurtis', where: 'Now in Silk · Bala Holder' }],
  Bottoms: [{ code: '4', name: 'Girls Leggings', where: 'Not in any section' }],
}

function Picker({ multiple = true, onPick = vi.fn(), onNode = vi.fn() }: { multiple?: boolean; onPick?: (codes: string[]) => void; onNode?: (node: HierarchyNode) => void }) {
  const [chosen, setChosen] = useState<(HierarchyLeaf & { where: string })[]>([])
  return <HierarchyPicker label="Subcategories to add" levels={LEVELS} start={{ division: 'Women', subdivision: 'Ethnic Wear' }} multiple={multiple}
    loadLeaves={async node => LEAVES[node.category]} selected={chosen} onNodeChange={onNode}
    onChange={leaves => { setChosen(leaves); onPick(leaves.map(l => l.code)) }} annotate={leaf => leaf.where} />
}

describe('hierarchy picker', () => {
  test('opens at the start, annotates each, and keeps choices across categories', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const onNode = vi.fn()
    render(<Picker onPick={onPick} onNode={onNode} />)
    expect(screen.getByLabelText('Division')).toHaveValue('Women')
    expect(screen.getByLabelText('Category')).toHaveValue('Kurtis and Sets')
    expect(await screen.findByText('Now in Silk · Bala Holder')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Kurtis/ }))
    await user.selectOptions(screen.getByLabelText('Category'), 'Sarees and Blouses')
    expect(await screen.findByRole('checkbox', { name: /^Sarees/ })).toBeDisabled()
    expect(screen.getByText('Already yours')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Sari Blouses/ }))
    expect(onPick).toHaveBeenLastCalledWith(['3', '2'])
    expect(onNode).toHaveBeenLastCalledWith(women)
    // Another division starts at its own first sub-division and category.
    await user.selectOptions(screen.getByLabelText('Division'), 'Kids')
    expect(screen.getByLabelText('Sub-division')).toHaveValue('Girls Ethnic')
    expect(await screen.findByRole('checkbox', { name: /Girls Leggings/ })).not.toBeChecked()
  })

  test('works by keyboard, and one at a time when asked', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Picker multiple={false} onPick={onPick} />)
    await screen.findByRole('radio', { name: /Kurtis/ })
    screen.getByLabelText('Category').focus()
    await user.keyboard('{Tab}')
    expect(screen.getByRole('radio', { name: /Kurtis/ })).toHaveFocus()
    await user.keyboard(' ')
    expect(onPick).toHaveBeenLastCalledWith(['3'])
    await user.selectOptions(screen.getByLabelText('Category'), 'Sarees and Blouses')
    await user.click(await screen.findByRole('radio', { name: /Sari Blouses/ }))
    expect(onPick).toHaveBeenLastCalledWith(['2'])
  })

  test('a category that fails to load offers to try again', async () => {
    const user = userEvent.setup()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(LEAVES.Bottoms)
    render(<HierarchyPicker label="Pick" levels={[LEVELS[2]]} loadLeaves={load} selected={[]} onChange={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Girls Leggings/ })).toBeInTheDocument())
  })
})
