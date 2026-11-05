import { Segmented } from './Segmented'

export type ViewMode = 'table' | 'compact'

/** A related list's look: every column (Table) or the name and a few key fields (Compact). */
export function ViewToggle({ value, onChange, label = 'View' }: {
  value: ViewMode
  onChange: (value: ViewMode) => void
  label?: string
}) {
  return <Segmented label={label} value={value} onChange={onChange}
    options={[{ value: 'table', label: 'Table' }, { value: 'compact', label: 'Compact' }]} />
}
