// UI Lab examples for relational navigation (#910). Invented data: a depot
// with aisles, bins and shelves. Every example keeps its own state.
import { useState } from 'react'
import {
  Button,
  DrillPane,
  FieldGrid,
  GroupChip,
  LinkChip,
  PanePlace,
  PaneSection,
  PathBar,
  RecentPaths,
  resolvePanePlace,
  SplitWithPane,
  TreeOutline,
  ViewToggle,
  type FieldGridGroup,
  type PanePlaceValue,
  type TreeNode,
  type ViewMode,
} from '@featherbase/shop-floor'

const SHELVES = [
  { name: 'Top shelf', code: 'S-1', load: 'Light cartons', checked: '02-Nov-2026' },
  { name: 'Middle shelf', code: 'S-2', load: 'Pallet jacks', checked: '28-Oct-2026' },
  { name: 'Floor level', code: 'S-3', load: 'Drums', checked: '15-Oct-2026' },
]

const BIN_FIELDS: FieldGridGroup[] = [
  { title: 'Location', fields: [
    { label: 'Depot', value: 'Riverside depot' },
    { label: 'Aisle', value: 'Aisle 4 · A-04' },
    { label: 'Temperature zone', value: '', empty: true },
  ] },
  { title: 'Handling', fields: [
    { label: 'Opened on', value: '05-Feb-2019' },
    { label: 'Insured value', value: '₹12,45,000.00' },
    { label: 'Instructions', long: true, value: 'Stack cartons no more than four high. Keep the walkway beside the bin clear for the pallet jack. Heavy drums go on the floor level only, never above. Report any spill at once to the depot lead and fence the area off until it is cleaned. Fragile goods are marked with a red label and go on the top shelf.' },
    { label: 'Hazard class', value: '', empty: true },
    { label: 'Supervisor note', value: '', empty: true },
  ] },
]

function BinPane({ place, onClose }: { place: 'right' | 'bottom'; onClose: () => void }) {
  const [group, setGroup] = useState('shelf')
  const [view, setView] = useState<ViewMode>('table')
  const [filtered, setFiltered] = useState('')
  return (
    <DrillPane kind="Bin" title="North bay · B-104" place={place} onClose={onClose}
      actions={<><Button variant="quiet">Open row page</Button><Button variant="quiet">Edit</Button></>}>
      <PaneSection title="Points at">
        <dl className="grid grid-cols-[minmax(5rem,max-content)_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-muted">Aisle</dt>
          <dd><LinkChip label="Aisle 4" code="A-04" onOpen={() => {}} onGoThere={() => {}} onFilter={() => setFiltered('Aisle: Aisle 4')} /></dd>
          <dt className="text-ink-muted">Depot</dt>
          <dd><LinkChip label="Riverside depot" onOpen={() => {}} onGoThere={() => {}} filterDisabledReason="This list has no Depot column" /></dd>
          <dt className="text-ink-muted">Owner</dt>
          <dd><LinkChip label="Restricted owner" unreadable /></dd>
        </dl>
        {filtered && <p className="text-sm text-ink-muted">The list behind would now be filtered by {filtered}.</p>}
      </PaneSection>
      <PaneSection title="Pointed at by">
        <div className="flex flex-wrap gap-2">
          <GroupChip label="Fields" selected={group === 'fields'} onSelect={() => setGroup('fields')} />
          <GroupChip label="Shelf" count={SHELVES.length} selected={group === 'shelf'} onSelect={() => setGroup('shelf')} />
          <GroupChip label="Stock count" count={1240} selected={group === 'count'} onSelect={() => setGroup('count')} />
        </div>
        {group === 'fields' && <FieldGrid groups={BIN_FIELDS} />}
        {group === 'shelf' && <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Shelf · 3 rows</h4>
            <div className="flex items-center gap-2"><ViewToggle value={view} onChange={setView} /><Button variant="quiet">Open as list</Button></div>
          </div>
          <ShelfRows view={view} />
        </>}
        {group === 'count' && <p className="text-sm text-ink-muted">Stock counts would list here, 20 at a time.</p>}
      </PaneSection>
    </DrillPane>
  )
}

function ShelfRows({ view }: { view: ViewMode }) {
  if (view === 'compact') return (
    <ul className="flex flex-col divide-y divide-border rounded-card border border-border text-sm">
      {SHELVES.map((shelf) => <li key={shelf.code} className="flex flex-col px-3 py-2">
        <span className="font-medium">{shelf.name} · {shelf.code}</span>
        <span className="text-ink-muted">{shelf.load}</span>
      </li>)}
    </ul>
  )
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-sm">
        <thead className="bg-subtle text-left"><tr><th className="px-3 py-2 font-semibold">Name</th><th className="px-3 py-2 font-semibold">Load</th><th className="px-3 py-2 font-semibold">Last checked</th></tr></thead>
        <tbody>{SHELVES.map((shelf) => <tr key={shelf.code} className="border-t border-border">
          <td className="px-3 py-2 font-medium">{shelf.name} · {shelf.code}</td><td className="px-3 py-2">{shelf.load}</td><td className="px-3 py-2">{shelf.checked}</td>
        </tr>)}</tbody>
      </table>
    </div>
  )
}

export function DrillPaneDemo() {
  const [place, setPlace] = useState<PanePlaceValue>('auto')
  const [open, setOpen] = useState(true)
  const resolved = resolvePanePlace(place, typeof window === 'undefined' ? 1200 : window.innerWidth)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <PanePlace value={place} resolved={resolved} onChange={setPlace} />
        {!open && <Button onClick={() => setOpen(true)}>Open the pane again</Button>}
      </div>
      <div className="flex h-[36rem] min-w-0 overflow-hidden rounded-card border border-border">
        <SplitWithPane place={resolved} pane={open ? <BinPane place={resolved} onClose={() => setOpen(false)} /> : null}>
          <div className="p-4 text-sm">
            <h3 className="font-semibold">Bins</h3>
            <p className="text-ink-muted">The list the pane was opened from. Press Escape inside the pane to close it.</p>
          </div>
        </SplitWithPane>
      </div>
    </div>
  )
}

const ALL_STEPS = [
  { key: 'home', label: 'Home' },
  { key: 'bins', kindLabel: 'List', label: 'Bins' },
  { key: 'aisle', kindLabel: 'Filter', label: 'Aisle: Aisle 4' },
  { key: 'bin', label: 'North bay · B-104' },
  { key: 'shelf', label: 'Top shelf · S-1' },
]

export function PathBarDemo() {
  const [current, setCurrent] = useState(ALL_STEPS.length - 1)
  const [picked, setPicked] = useState('')
  return (
    <div className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-card border border-border">
      <PathBar steps={ALL_STEPS} current={current} onStep={setCurrent}
        onBack={() => setCurrent(Math.max(0, current - 1))} onForward={() => setCurrent(Math.min(ALL_STEPS.length - 1, current + 1))}
        onCopyLink={() => {}}
        recent={<RecentPaths onPick={setPicked} paths={[
          { key: 'r1', label: 'Bins › Aisle 4 › North bay · B-104' },
          { key: 'r2', label: 'Depots › Riverside depot › Aisle 2' },
          { key: 'r3', label: 'Shelves › Floor level · S-3' },
        ]} />} />
      <p className="px-4 pb-3 text-sm text-ink-muted">{picked ? `Would restore recent path ${picked}.` : 'Back, Forward and the steps move along the path.'}</p>
    </div>
  )
}

export function ChipsDemo() {
  const [group, setGroup] = useState('shelf')
  const [said, setSaid] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <LinkChip label="Aisle 4" code="A-04" kind="Aisle" onOpen={() => setSaid('Opened Aisle 4')} onGoThere={() => setSaid('Went to Aisle 4')} onFilter={() => setSaid('Filtered by Aisle 4')} />
        <LinkChip label="Riverside depot" onOpen={() => setSaid('Opened Riverside depot')} onGoThere={() => setSaid('Went to Riverside depot')} filterDisabledReason="This list has no Depot column" />
        <LinkChip label="Restricted owner" unreadable />
      </div>
      <div className="flex flex-wrap gap-2">
        {[['fields', 'Fields'], ['shelf', 'Shelf', 3], ['count', 'Stock count', 125000]].map(([id, label, count]) => (
          <GroupChip key={id} label={label as string} count={count as number | undefined} selected={group === id} onSelect={() => setGroup(id as string)} />
        ))}
      </div>
      <p role="status" className="text-sm text-ink-muted">{said}</p>
    </div>
  )
}

export function FieldGridDemo() {
  return <div className="max-w-xl"><FieldGrid groups={BIN_FIELDS} /></div>
}

export function TreeDemo() {
  const [expanded, setExpanded] = useState(new Set(['shelves', 's1']))
  const [selected, setSelected] = useState('bin')
  const [all, setAll] = useState(false)
  const counts = Array.from({ length: all ? 8 : 3 }, (_, i) => ({ id: `c${i + 1}`, label: `Count ${String(i + 1).padStart(2, '0')}-Nov-2026`, kind: 'Stock count' }))
  const nodes: TreeNode[] = [
    { id: 'h-to', label: 'Links to', heading: true },
    { id: 'aisle', label: 'Aisle 4', code: 'A-04', kind: 'Aisle', hasChildren: true, loading: expanded.has('aisle') },
    { id: 'depot', label: 'Riverside depot', kind: 'Depot' },
    { id: 'bin', label: 'North bay', code: 'B-104', kind: 'Bin' },
    { id: 'h-from', label: 'Linked from', heading: true },
    { id: 'shelves', label: 'Shelf', group: true, count: 3, children: [
      { id: 's1', label: 'Top shelf', code: 'S-1', kind: 'Shelf', children: [
        { id: 's1-counts', label: 'Stock count', group: true, count: 8, children: counts,
          more: { shown: counts.length, total: 8, onShowAll: () => setAll(true) } },
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

export function ViewToggleDemo() {
  const [view, setView] = useState<ViewMode>('table')
  return <div className="flex flex-col gap-2"><ViewToggle value={view} onChange={setView} /><ShelfRows view={view} /></div>
}
