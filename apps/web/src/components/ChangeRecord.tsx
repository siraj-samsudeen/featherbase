import { Link as RouterLink } from '@tanstack/react-router'
import { PrincipalName } from '../lib/people'
import { cardClasses, fmtInstant } from '@featherbase/shop-floor'
import { useChangeFormat, type ChangeData } from '../lib/change-format'
import { AgentMark } from './AgentMark'

// #825: a Version row is one change to one row of another Table. It reads as
// that change: who changed which row and when, then one line per field with
// its value before and after, in the changed Table's own words. The stored
// JSON stays below, collapsed (FormView's raw details).
export function ChangeRecord({ values }: { values: Record<string, unknown> }) {
  const table = String(values.ref_table ?? '')
  const row = String(values.ref_name ?? '')
  const data = (values.data && typeof values.data === 'object' ? values.data : {}) as ChangeData
  const format = useChangeFormat(table, '—')
  const changed = Array.isArray(data.changed) ? data.changed : []
  const source = data.import_revert ? `Undo of import ${data.import_revert}` : data.import_run ? `Import ${data.import_run}` : null
  return (
    <section data-testid="change-record" className={cardClasses('mb-4 overflow-hidden')}>
      <header data-testid="change-header" className="border-b border-border p-4 text-sm text-ink-muted">
        <h2 className="m-0 mb-1 text-xs font-semibold text-ink-subtle">Changes</h2>
        <div className="text-base font-semibold text-ink">
          {table}
          {row && (
            <>
              {' · '}
              <RouterLink to="/featherbase/admin/table/$table/row/$name" params={{ table, name: row }} search={{ prefill: undefined }} className="text-action hover:underline">
                {row}
              </RouterLink>
            </>
          )}
        </div>
        <div className="mt-1">
          Changed by <span className="font-medium text-ink"><PrincipalName id={String(values.created_by ?? '')} /></span>
          <AgentMark label={data.agent?.token_label} />
          {' · '}
          <span className="whitespace-nowrap">{fmtInstant(values.created_at as string | undefined)}</span>
          {source && <>{' · '}<span className="break-all">{source}</span></>}
        </div>
      </header>
      {data.resolution && (
        <p data-testid="change-resolution" className="m-0 border-b border-border px-4 py-3 text-sm text-ink">
          {format.label(data.resolution.field)}:{' '}
          {data.resolution.decision === 'keep'
            ? `kept the current value instead of ${format.value(data.resolution.field, data.resolution.incoming)}`
            : 'accepted the source; future imports can update this field'}
        </p>
      )}
      {changed.length === 0 ? (
        <p className="m-0 px-4 py-3 text-sm text-ink-muted">No field changes</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-subtle">
              <th scope="col" className="w-1/4 px-4 py-2 font-semibold">Field</th>
              <th scope="col" className="px-4 py-2 font-semibold">Before</th>
              <th scope="col" className="px-4 py-2 font-semibold">After</th>
            </tr>
          </thead>
          <tbody>
            {changed.map(([column, before, after], i) => (
              <tr key={i} data-testid="change-row" className="border-t border-border align-top">
                <td className="px-4 py-2 font-medium text-ink [overflow-wrap:anywhere]">{format.label(column)}</td>
                <td className="px-4 py-2 text-ink-muted [overflow-wrap:anywhere]">{format.value(column, before)}</td>
                <td className="px-4 py-2 text-ink [overflow-wrap:anywhere]">{format.value(column, after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
