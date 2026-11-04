import type { ReadingPresentation as Presentation } from 'shared'
import type { TableMeta } from '../lib/meta'
import { formatValue, useSettings } from '../lib/settings'
import { useI18n } from '../lib/i18n'
import { cardClasses } from '@featherbase/shop-floor'

/** The same reading surface for any configured read-only Table. Never parse body HTML. */
export function ReadingPresentation({ presentation, meta, values }: {
  presentation: Presentation
  meta: TableMeta
  values: Record<string, unknown>
}) {
  const settings = useSettings()
  const { t } = useI18n()
  function column(name: string) {
    return meta.columns.find(f => f.column_name === name && !f.hidden)
      ?? (name === 'created_at' || name === 'updated_at'
        ? { label: name === 'created_at' ? 'Created' : 'Updated', column_type: 'Datetime' }
        : undefined)
  }
  function text(name: string) {
    const field = column(name)
    return field ? formatValue(field.column_type, values[name], settings) : ''
  }
  return (
    <article data-testid="reading-presentation" className={cardClasses('mb-4 overflow-hidden')}>
      <header className="border-b border-border p-6">
        {presentation.notice && <p className="mb-4 text-sm text-ink-muted" role="note">{t(presentation.notice)}</p>}
        <h2 className="mb-5 text-2xl font-semibold text-ink">{text(presentation.title) || t('Untitled')}</h2>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {presentation.headers.map(name => {
            const field = column(name)
            return field && <div key={name} className="contents">
              <dt className="text-ink-muted">{t(field.label || name)}</dt>
              <dd data-testid={`reading-header-${name}`} className="m-0 text-ink">{text(name) || '—'}</dd>
            </div>
          })}
        </dl>
      </header>
      <div className="p-6">
        <p data-testid="reading-body" className="m-0 whitespace-pre-wrap text-base leading-7 text-ink [overflow-wrap:anywhere]">
          {text(presentation.body) || t('No message body')}
        </p>
      </div>
      {presentation.attachment_names && column(presentation.attachment_names) && (
        <footer className="border-t border-border px-6 py-4 text-sm">
          <h3 className="mb-1 font-semibold text-ink">{t(column(presentation.attachment_names)!.label || presentation.attachment_names)}</h3>
          <p className="m-0 text-ink-muted">{text(presentation.attachment_names) || t('No attachments')}</p>
        </footer>
      )}
    </article>
  )
}
