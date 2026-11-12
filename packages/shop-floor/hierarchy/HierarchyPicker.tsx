// Pick from the merchandise hierarchy (#1175): Division → Sub-division → Category, then that
// category's subcategories. One or several; choices are kept across categories, so it works as a
// filter. Native selects and checkboxes, so Tab, the arrow keys and Space work as everywhere else.
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../src/Button'
import { Field, Select } from '../src/Field'
import { Notice } from '../src/Notice'
import { Skeleton } from '../src/Skeleton'
import { HIERARCHY_LEVELS, type HierarchyNode } from './HierarchyPath'

export interface HierarchyLeaf { code: string; name: string; disabled?: boolean }

const distinct = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b))
const show = (value: string, level: number) => value || HIERARCHY_LEVELS[level].empty

/** The first node under what is given, level by level: an unknown start falls back to the first. */
function settle(levels: HierarchyNode[], want: Partial<HierarchyNode>): HierarchyNode | null {
  const divisions = distinct(levels.map(l => l.division))
  const division = divisions.includes(want.division ?? '\u0000') ? want.division! : divisions[0]
  if (division === undefined) return null
  const subdivisions = distinct(levels.filter(l => l.division === division).map(l => l.subdivision))
  const subdivision = subdivisions.includes(want.subdivision ?? '\u0000') ? want.subdivision! : subdivisions[0]
  const categories = distinct(levels.filter(l => l.division === division && l.subdivision === subdivision).map(l => l.category))
  const category = categories.includes(want.category ?? '\u0000') ? want.category! : categories[0]
  return { division, subdivision, category }
}

export function HierarchyPicker<L extends HierarchyLeaf>({ label, levels, start, loadLeaves, multiple = true, selected, onChange, onNodeChange, annotate }: {
  /** What the list of subcategories is for, said to screen readers. */
  label: string
  /** Every category, each with its division and sub-division. */
  levels: HierarchyNode[]
  /** Where it opens; the rest of the path is filled from the first choices under it. */
  start?: Partial<HierarchyNode> | null
  loadLeaves: (node: HierarchyNode) => Promise<L[]>
  /** Several at once (checkboxes), or one (radio buttons). */
  multiple?: boolean
  /** The chosen subcategories, from any category. */
  selected: L[]
  onChange: (leaves: L[]) => void
  /** The category being looked at, for a filter that takes a whole node. */
  onNodeChange?: (node: HierarchyNode) => void
  /** A line under each subcategory, such as where it is now. */
  annotate?: (leaf: L) => ReactNode
}) {
  const id = useId()
  const [node, setNode] = useState<HierarchyNode | null>(() => settle(levels, start ?? {}))
  useEffect(() => { setNode(current => settle(levels, current ?? start ?? {})) }, [levels]) // eslint-disable-line react-hooks/exhaustive-deps
  const [leaves, setLeaves] = useState<L[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!node) return
    onNodeChange?.(node)
    let live = true
    setLeaves(null)
    setFailed(false)
    loadLeaves(node).then(found => { if (live) setLeaves(found) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [node?.division, node?.subdivision, node?.category, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  const divisions = useMemo(() => distinct(levels.map(l => l.division)), [levels])
  const subdivisions = useMemo(() => distinct(levels.filter(l => l.division === node?.division).map(l => l.subdivision)), [levels, node?.division])
  const categories = useMemo(() => distinct(levels.filter(l => l.division === node?.division && l.subdivision === node?.subdivision).map(l => l.category)), [levels, node?.division, node?.subdivision])
  const chosen = new Set(selected.map(leaf => leaf.code))
  const toggle = (leaf: L) => onChange(multiple
    ? (chosen.has(leaf.code) ? selected.filter(s => s.code !== leaf.code) : [...selected, leaf])
    : [leaf])
  if (!node) return <p className="fd-muted" data-testid="hierarchy-empty">There are no subcategories to choose from.</p>
  const pickers: [string, string[], string, (value: string) => void][] = [
    [HIERARCHY_LEVELS[0].label, divisions, node.division, value => setNode(settle(levels, { division: value }))],
    [HIERARCHY_LEVELS[1].label, subdivisions, node.subdivision, value => setNode(settle(levels, { division: node.division, subdivision: value }))],
    [HIERARCHY_LEVELS[2].label, categories, node.category, value => setNode({ ...node, category: value })],
  ]
  return (
    <div className="flex flex-col gap-3" data-testid="hierarchy-picker">
      <div className="grid gap-3 sm:grid-cols-3">
        {pickers.map(([name, options, value, set], level) => (
          <Field key={name} label={name}>
            <Select value={value} onChange={event => set(event.target.value)}>
              {options.map(option => <option key={option} value={option}>{show(option, level)}</option>)}
            </Select>
          </Field>
        ))}
      </div>
      <fieldset className="flex flex-col gap-1" aria-describedby={`${id}-count`}>
        <legend className="sr-only">{label}: {show(node.category, 2)}</legend>
        {failed && <Notice tone="negative"><span>These couldn't load. <Button variant="quiet" onClick={() => setAttempt(n => n + 1)}>Try again</Button></span></Notice>}
        {!failed && !leaves && <Skeleton label="Opening the subcategories" lines={3} />}
        {leaves?.length === 0 && <p className="fd-muted">This category has no subcategories.</p>}
        {leaves && leaves.length > 0 && (
          <ul className="flex flex-col divide-y divide-border" data-testid="hierarchy-leaves">
            {leaves.map(leaf => (
              <li key={leaf.code}>
                <label className={`flex min-h-control items-start gap-3 py-2 ${leaf.disabled ? 'cursor-default text-ink-muted' : 'cursor-pointer'}`} data-testid="hierarchy-leaf">
                  <input type={multiple ? 'checkbox' : 'radio'} name={id} className="mt-0.5 size-5 shrink-0 accent-action"
                    checked={chosen.has(leaf.code)} disabled={leaf.disabled} onChange={() => toggle(leaf)} />
                  <span className="min-w-0 break-words">
                    {leaf.name}
                    {annotate && <span className="block text-sm text-ink-muted">{annotate(leaf)}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <p id={`${id}-count`} className="sr-only" aria-live="polite">{selected.length === 1 ? '1 chosen' : `${selected.length} chosen`}</p>
    </div>
  )
}
