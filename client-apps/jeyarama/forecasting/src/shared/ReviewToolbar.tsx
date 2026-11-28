// The review's one row of toggles (TL-7..TL-12) and the parts legend under it. Each toggle is Shop Floor's
// Segmented with a hover; a page shows the toggles it needs, in this order.
import type { ReactNode } from 'react'
import { Segmented } from '@featherbase/shop-floor'
import { Hover } from './Hover'
import { PARTS } from './model'

export type Measure = 'all' | 'vq' | 'v' | 'q'
export type GroupView = 'band' | 'one' | 'off'
export type Shape = 'bar' | 'donut'
export interface ViewChoices { measure: Measure; groups: GroupView; shape: Shape; aop: boolean }
export const DEFAULT_VIEW: ViewChoices = { measure: 'all', groups: 'one', shape: 'bar', aop: false }
export type Toggle = keyof ViewChoices

/** The managers' default: Value · Qty (their figures run to crores), groups as one row, bars, AOP always shown. */
export const MANAGER_VIEW: ViewChoices = { measure: 'vq', groups: 'one', shape: 'bar', aop: true }

/** One toggle of the row: a label and Shop Floor's Segmented, with a hover that says what it does. A page draws its
 *  own toggles (View, Inside a store, Sort) with this, so they read as the shared ones do. */
export function ToolbarChoice<T extends string>({ label, hover, value, onChange, options }: {
  label: string; hover: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]
}) {
  return <Hover text={hover}><span className="fr-toolbar-label">{label}</span><Segmented label={label} value={value} onChange={onChange} options={options} /></Hover>
}

export function ReviewToolbar({ value, onChange, toggles = ['measure', 'groups', 'shape', 'aop'], lead, trail, wrap = false }: {
  value: ViewChoices; onChange: (next: ViewChoices) => void; toggles?: Toggle[]
  /** The page's own toggles, before the shared ones (View) and after them (Sort). */
  lead?: ReactNode; trail?: ReactNode
  /** Wrap onto a second row rather than scroll (the managers' pages, whose rows carry more toggles). */
  wrap?: boolean
}) {
  const set = <K extends Toggle>(k: K) => (v: ViewChoices[K]) => onChange({ ...value, [k]: v })
  const one = <T extends string>(label: string, hover: string, v: T, on: (v: T) => void, options: { value: T; label: string }[]) => (
    <ToolbarChoice key={label} label={label} hover={hover} value={v} onChange={on} options={options} />)
  const all: Record<Toggle, () => ReactNode> = {
    measure: () => one('Show', 'Value, quantity and average selling price', value.measure, set('measure'),
      [{ value: 'all', label: 'All three' }, { value: 'vq', label: 'Value · Qty' }, { value: 'v', label: 'Value' }, { value: 'q', label: 'Qty' }]),
    groups: () => one('Groups', 'Subcategories that moved in opposite directions: on top with their subcategories, as one row, or tagged on each subcategory', value.groups, set('groups'),
      [{ value: 'band', label: 'On top' }, { value: 'one', label: 'One row' }, { value: 'off', label: 'Tagged' }]),
    shape: () => one('Built from', 'How Feather Forecast built each number', value.shape, set('shape'), [{ value: 'bar', label: 'Bar' }, { value: 'donut', label: 'Donut' }]),
    aop: () => one('AOP', 'Show the annual plan', value.aop ? 'on' : 'off', v => onChange({ ...value, aop: v === 'on' }), [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]),
  }
  return <div className={wrap || lead || trail ? "fr-toolbar fr-toolbar-wrap" : "fr-toolbar"}>{lead}{toggles.map(t => all[t]())}{trail}</div>
}

/** The four parts' colours, and what clicking a row does. */
export function PartsLegend({ hint = 'Click any row for how Feather Forecast built it and what other models say.' }: { hint?: string }) {
  return (
    <div className="fr-legend">
      {PARTS.map(p => <span key={p.key} style={{ ['--c' as string]: p.color }}>{p.label}</span>)}
      {hint && <span>{hint}</span>}
    </div>
  )
}
