import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { fmtCount } from './format'
import { ChevronRight, LoaderCircle } from './icons'
import { KindTag, nameAndCode } from './LinkChip'

export interface TreeNode {
  id: string
  label: string
  code?: string
  /** The row's table, shown as a small tag. */
  kind?: string
  /** A group line's row count. */
  count?: number
  /** A caption ("Links to", "Linked from"): not a line of the tree. */
  heading?: boolean
  /** A group of related rows: bold, with its count. */
  group?: boolean
  children?: TreeNode[]
  /** Opens even before its children are loaded. */
  hasChildren?: boolean
  loading?: boolean
  /** A capped group: "first 20 · show all 40". */
  more?: { shown: number; total: number; onShowAll: () => void }
}

interface Line { node: TreeNode; parent?: string; level: number }

const opens = (node: TreeNode) => node.hasChildren ?? !!node.children?.length

/** The lines a keyboard can reach, top to bottom: captions skipped, closed lines' children hidden. */
function visibleLines(nodes: TreeNode[], expanded: Set<string>, level = 1, parent?: string): Line[] {
  return nodes.flatMap((node) => {
    if (node.heading) return []
    const line = { node, parent, level }
    return expanded.has(node.id) && node.children ? [line, ...visibleLines(node.children, expanded, level + 1, node.id)] : [line]
  })
}

/**
 * An expandable outline of related rows (role tree). One line is in the tab
 * order; Up and Down move, Right opens or enters, Left closes or goes to the
 * parent, Enter activates.
 */
export function TreeOutline({ nodes, expanded, onToggle, selected, onActivate, renderActions, label }: {
  nodes: TreeNode[]
  expanded: Set<string>
  onToggle: (id: string) => void
  selected?: string
  onActivate: (id: string) => void
  renderActions?: (node: TreeNode) => ReactNode
  label: string
}) {
  const baseId = useId()
  const lines = visibleLines(nodes, expanded)
  const [focused, setFocused] = useState<string | undefined>(undefined)
  const active = lines.find((line) => line.node.id === focused)?.node.id
    ?? lines.find((line) => line.node.id === selected)?.node.id
    ?? lines[0]?.node.id
  const items = useRef(new Map<string, HTMLLIElement>())

  function move(id: string | undefined) {
    if (!id) return
    setFocused(id)
    items.current.get(id)?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>, line: Line) {
    if (event.target !== event.currentTarget) return
    const index = lines.indexOf(line)
    const { node } = line
    const open = expanded.has(node.id)
    let handled = true
    if (event.key === 'ArrowDown') move(lines[index + 1]?.node.id)
    else if (event.key === 'ArrowUp') move(lines[index - 1]?.node.id)
    else if (event.key === 'Home') move(lines[0]?.node.id)
    else if (event.key === 'End') move(lines.at(-1)?.node.id)
    else if (event.key === 'ArrowRight') {
      if (!opens(node)) handled = false
      else if (!open) onToggle(node.id)
      else move(lines[index + 1]?.level === line.level + 1 ? lines[index + 1].node.id : undefined)
    } else if (event.key === 'ArrowLeft') {
      if (open && opens(node)) onToggle(node.id)
      else move(line.parent)
    } else if (event.key === 'Enter') onActivate(node.id)
    else handled = false
    if (handled) event.preventDefault()
  }

  function render(list: TreeNode[], level: number, parent?: string): ReactNode {
    return list.map((node) => {
      if (node.heading) return (
        <li key={node.id} role="none" style={{ paddingInlineStart: `${(level - 1) * 1.25}rem` }}
          className="pt-3 pr-2 pb-1 text-sm text-ink-muted first:pt-0">{node.label}</li>
      )
      const line = lines.find((l) => l.node.id === node.id) ?? { node, parent, level }
      const open = expanded.has(node.id)
      const labelId = `${baseId}-${node.id}`
      const isSelected = node.id === selected
      return (
        <li key={node.id} role="treeitem" aria-level={level} aria-labelledby={labelId}
          aria-expanded={opens(node) ? open : undefined} aria-selected={isSelected}
          tabIndex={node.id === active ? 0 : -1}
          ref={(el) => { if (el) items.current.set(node.id, el); else items.current.delete(node.id) }}
          onFocus={(event) => { if (event.target === event.currentTarget) setFocused(node.id) }}
          onKeyDown={(event) => onKeyDown(event, line)}
          className="rounded-control focus-visible:outline-2 focus-visible:outline-focus"
        >
          <div onClick={() => { setFocused(node.id); onActivate(node.id) }}
            style={{ paddingInlineStart: `${(level - 1) * 1.25}rem` }}
            className={cx('flex min-h-control cursor-pointer items-center gap-2 rounded-control pr-2 hover:bg-subtle',
              isSelected && 'bg-action-tint')}
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center">
              {opens(node) && <button type="button" tabIndex={-1} aria-hidden
                onClick={(event) => { event.stopPropagation(); onToggle(node.id) }}
                className="inline-flex size-6 items-center justify-center rounded-control text-ink-muted hover:text-ink">
                <ChevronRight size={14} className={cx('transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
              </button>}
            </span>
            <span id={labelId} className={cx('min-w-0 text-sm wrap-anywhere', node.group ? 'font-semibold text-ink' : isSelected ? 'font-semibold text-action' : 'text-ink')}>
              {nameAndCode(node.label, node.code)}
              {node.count != null && <>{' '}<span className="font-normal text-ink-muted">{fmtCount(node.count)}</span></>}
            </span>
            {node.kind && <KindTag>{node.kind}</KindTag>}
            {renderActions && <span className="ml-auto flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>{renderActions(node)}</span>}
          </div>
          {open && (node.children?.length || node.loading || node.more) && (
            <ul role="group">
              {node.loading && <li role="none" style={{ paddingInlineStart: `${level * 1.25 + 2}rem` }}
                className="flex min-h-control items-center gap-2 text-sm text-ink-muted">
                <LoaderCircle aria-hidden size={14} className="animate-spin motion-reduce:animate-none" /> Loading
              </li>}
              {node.children && render(node.children, level + 1, node.id)}
              {node.more && node.more.shown < node.more.total && (
                <li role="none" style={{ paddingInlineStart: `${level * 1.25 + 2}rem` }} className="flex min-h-control items-center gap-1 text-sm text-ink-muted">
                  first {fmtCount(node.more.shown)} ·
                  <button type="button" onClick={node.more.onShowAll}
                    className="font-medium text-action hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                    show all {fmtCount(node.more.total)}
                  </button>
                </li>
              )}
            </ul>
          )}
        </li>
      )
    })
  }

  return <ul role="tree" aria-label={label} className="flex min-w-0 flex-col">{render(nodes, 1)}</ul>
}
