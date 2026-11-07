import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_LINK_FORMAT, LINK_FORMATS, LINK_FORMAT_LABELS, rowDisplayTitle, type LinkFormat } from 'shared'
import { ApiError, api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta } from '../lib/meta'
import { linkedRowText } from '../lib/relations'
import { buttonClasses, cardClasses, inputClasses, labelClasses } from '@featherbase/shop-floor'

/** #1020: how links to this Table's rows read, everywhere they show. */
export function TableLinkFormat({ table }: { table: string }) {
  const meta = useMeta(table)
  const queryClient = useQueryClient()
  const [format, setFormat] = useState<LinkFormat>(DEFAULT_LINK_FORMAT)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const columns = (meta.data?.columns ?? []).filter((c) => !NO_COLUMN_TYPES.has(c.column_type) && !c.hidden)
  const sample = useQuery({
    queryKey: ['link-format-sample', table],
    enabled: Boolean(meta.data),
    queryFn: () => listResource<Record<string, unknown> & { row_id: string }>(table, {
      fields: ['row_id', ...columns.map((c) => c.column_name)],
      limit_page_length: 1,
    }),
  })

  useEffect(() => {
    if (!meta.data) return
    setFormat(meta.data.link_format ?? DEFAULT_LINK_FORMAT)
  }, [meta.data])

  if (!meta.data) return null
  const dirty = format !== (meta.data.link_format ?? DEFAULT_LINK_FORMAT)
  const row = sample.data?.data[0]
  const chosen = { ...meta.data, link_format: format }
  const preview = row ? linkedRowText(chosen, row.row_id, rowDisplayTitle(chosen, row, row.row_id)) : null

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await api.put(`/api/table_def/${encodeURIComponent(table)}`, { link_format: format })
      await queryClient.invalidateQueries({ queryKey: ['meta', table] })
      setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cardClasses('p-4')} data-testid="link-format">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">How links to this Table read</h2>
        <div className="flex items-center gap-3">
          {saved && !dirty && <span className="text-sm text-positive" data-testid="link-format-saved">Saved</span>}
          <button type="button" className={buttonClasses({ variant: 'primary' })} data-testid="link-format-save" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <label className={labelClasses('m-0 block max-w-xs')}>
        How links read
        <select className={inputClasses('mt-1')} value={format} onChange={(e) => { setFormat(e.target.value as LinkFormat); setSaved(false) }}>
          {LINK_FORMATS.map((f) => <option key={f} value={f}>{LINK_FORMAT_LABELS[f]}</option>)}
        </select>
      </label>
      {preview && <p className="mt-3 text-sm text-ink-muted" data-testid="link-format-preview">A link reads: <span className="text-ink">{preview}</span></p>}
      <p className="mt-3 text-xs text-ink-subtle">
        The code is the row's ID, when people use it as a code. A row with no separate code shows its name, and a generated ID is never shown.
      </p>
      {error && <p className="mt-3 text-sm text-negative" data-testid="link-format-error">{error}</p>}
    </div>
  )
}
