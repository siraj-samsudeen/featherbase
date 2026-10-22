import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'

// person-resolution D3/D12: every identifier a person has had — employee
// codes, record numbers, phone, addresses — each with its period, where it
// came from and whether it is verified. What the viewer may not see is left
// out by the server (restricted values, hidden record numbers). Values fed by
// another system are read-only here; the person can add their own phone.

interface Identifier {
  id: string
  system: string
  system_label: string
  assigner: string
  value: string | null
  valid_from: string | null
  valid_to: string | null
  current: boolean
  verified: boolean
  source: string
  worker_type: string | null
  editable: boolean
}

const today = () => new Date().toISOString().slice(0, 10)

function period(i: Identifier): string {
  const from = i.valid_from ?? 'before Featherbase'
  return i.current ? `since ${from}` : `${from} – ${i.valid_to}`
}

export function PersonIdentifiers({ person, replacedBy }: { person: string; replacedBy?: string | null }) {
  const qc = useQueryClient()
  const key = ['person-identifiers', person]
  const { data } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<{ identifiers: Identifier[]; addable: { row_id: string; label: string }[] }>(`/api/people/${encodeURIComponent(person)}/identifiers`),
  })
  const addable = data?.addable ?? []
  const [error, setError] = useState<string | null>(null)
  const done = () => {
    setError(null)
    void qc.invalidateQueries({ queryKey: key })
  }
  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : 'That did not work')
  const add = useMutation({
    mutationFn: ({ body }: { body: Record<string, string>; form: HTMLFormElement }) =>
      api.post(`/api/people/${encodeURIComponent(person)}/identifiers`, body),
    onSuccess: (_r, { form }) => {
      form.reset()
      done()
    },
    onError: fail,
  })
  const end = useMutation({
    mutationFn: (id: string) => api.patch(`/api/identifiers/${encodeURIComponent(id)}`, { valid_to: today() }),
    onSuccess: done,
    onError: fail,
  })

  const groups = new Map<string, Identifier[]>()
  for (const i of data?.identifiers ?? []) groups.set(i.system_label, [...(groups.get(i.system_label) ?? []), i])

  function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    add.mutate({ body: { system: String(f.get('system')), value: String(f.get('value')).trim() }, form: e.currentTarget })
  }

  return (
    <section className="fc-card p-3" data-testid="person-identifiers">
      <h3 className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Identifiers</h3>
      {replacedBy && (
        <p className="mb-2 rounded bg-[var(--color-surface-muted,#f5f5f5)] px-2 py-1 text-xs text-[var(--color-ink)]" data-testid="replaced-banner">
          This record was merged into {replacedBy}. Open that record to make changes.
        </p>
      )}
      {groups.size === 0 && <p className="text-xs text-[var(--color-ink-muted)]">None recorded.</p>}
      {[...groups].map(([label, rows]) => (
        <div key={label} className="mb-2" data-testid={`identifier-group-${rows[0].system}`}>
          <div className="text-xs font-medium text-[var(--color-ink-muted)]">{label}</div>
          <ul className="space-y-1 text-sm">
            {rows.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-2" data-testid={`identifier-${i.id}`}>
                <span className="min-w-0">
                  <span className={i.current ? 'font-medium' : 'text-[var(--color-ink-muted)] line-through'}>{i.value}</span>
                  {i.assigner && <span className="text-xs text-[var(--color-ink-muted)]"> · {i.assigner}</span>}
                  <span className="block text-xs text-[var(--color-ink-muted)]">
                    {period(i)} · {i.source}
                    {i.worker_type ? ` · ${i.worker_type}` : ''}
                    {i.verified ? '' : ' · not verified'}
                  </span>
                </span>
                {i.current && i.editable && !replacedBy && (
                  <button type="button" className="text-xs text-[var(--color-danger)] hover:underline" onClick={() => end.mutate(i.id)}>
                    End
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!replacedBy && addable.length > 0 && (
        <form className="mt-2 space-y-2" onSubmit={onAdd} data-testid="add-identifier-form">
          <select name="system" className="fc-input" aria-label="Identifier" defaultValue={addable.some((s) => s.row_id === 'phone') ? 'phone' : addable[0].row_id}>
            {addable.map((s) => (
              <option key={s.row_id} value={s.row_id}>{s.label}</option>
            ))}
          </select>
          <input name="value" className="fc-input" aria-label="Value" placeholder="Value" required />
          <button type="submit" className="fc-btn w-full justify-center">Add</button>
        </form>
      )}
      {error && (
        <p className="mt-2 text-xs text-[var(--color-danger)]" data-testid="identifier-error">
          {error}
        </p>
      )}
    </section>
  )
}
