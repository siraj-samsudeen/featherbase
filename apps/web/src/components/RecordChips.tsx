import { choiceLabel } from 'shared'
import { useI18n } from '../lib/i18n'
import type { TableMeta } from '../lib/meta'
import { Indicator } from './Indicator'
import { isSourceColumn } from '../lib/column-kinds'

/**
 * #1348 board 3 (spec 16): under a record's name, its status and category chips, the same chips the list
 * draws. A Status column leads; a source, a blank value and a hidden field stay out.
 */
export function RecordChips({ meta, values }: { meta: TableMeta | undefined; values: Record<string, unknown> }) {
  const { t } = useI18n()
  const chips = (meta?.columns ?? [])
    .filter((c) => c.column_type === 'Choice' && !c.hidden && !isSourceColumn(c.column_name))
    .filter((c) => values[c.column_name] != null && String(values[c.column_name]).trim() !== '')
    .sort((a, b) => Number(b.column_name === 'status') - Number(a.column_name === 'status'))
  if (!chips.length) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="record-chips">
      {chips.map((c) => {
        const value = String(values[c.column_name])
        return <Indicator key={c.column_name} value={value} label={choiceLabel(value, c.choice_labels, t)} />
      })}
    </div>
  )
}
