import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { fmtDate } from '@featherbase/shop-floor'
import { PrincipalLink } from '../lib/people'
import { Button, Notice, Select, TextInput, cardClasses } from '@featherbase/shop-floor'
import { Plus } from 'lucide-react'
import { RowMenu } from './RowMenu'
import { NO_AUTOFILL_FIELD, NO_AUTOFILL_FORM } from '../lib/no-autofill'

// person-resolution D3/D12: every identifier a person has had — employee
// codes, record numbers, phone, addresses — each with its period, where it
// came from and whether it is verified. What the viewer may not see is left
// out by the server (restricted values, hidden record numbers). Values fed by
// another system are read-only here — except that, until the roster sync
// runs, a System Manager may record or end an employee code by hand with a
// note (review B-M6); the person can add their own phone.

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
  note_required?: boolean
}

interface Addable {
  row_id: string
  label: string
  note_required?: boolean
}

/** Where a value came from, in words (the stored codes are for machines). */
const SOURCES: Record<string, string> = {
  'sign-in': 'from a sign-in',
  'person-email': 'the person’s email',
  'self-email': 'their own email',
  self: 'added by the person',
  manual: 'recorded by hand',
  migration: 'carried over at the upgrade',
  'stylehr-roster-sync': 'StyleHR roster',
}
function sourceLabel(source: string): string {
  return SOURCES[source] ?? source
}
/** #1235 item 11: an address copied from the person's own email needs no
 *  source; its label ("Email address") already says it. */
const SAID_BY_THE_LABEL = new Set(['person-email', 'self-email'])

function period(i: Identifier): string {
  const from = i.valid_from ? fmtDate(i.valid_from) : 'before Featherbase'
  return i.current ? `since ${from}` : `${from} – ${fmtDate(i.valid_to)}`
}

export function PersonIdentifiers({ person, replacedBy }: { person: string; replacedBy?: string | null }) {
  const qc = useQueryClient()
  const key = ['person-identifiers', person]
  const { data } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<{ identifiers: Identifier[]; addable: Addable[] }>(`/api/people/${encodeURIComponent(person)}/identifiers`),
  })
  const addable = data?.addable ?? []
  const [chosen, setChosen] = useState<string | null>(null)
  const system = chosen ?? (addable.some((s) => s.row_id === 'phone') ? 'phone' : addable[0]?.row_id)
  const needsNote = addable.find((s) => s.row_id === system)?.note_required === true
  const [error, setError] = useState<string | null>(null)
  // #1235 item 10: the add form opens from the card header, on one line.
  const [adding, setAdding] = useState(false)
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
      setAdding(false)
      done()
    },
    onError: fail,
  })
  const end = useMutation({
    // The server ends it today by its own clock.
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api.patch(`/api/identifiers/${encodeURIComponent(id)}`, note ? { end: true, note } : { end: true }),
    onSuccess: done,
    onError: fail,
  })

  const groups = new Map<string, Identifier[]>()
  for (const i of data?.identifiers ?? []) groups.set(i.system_label, [...(groups.get(i.system_label) ?? []), i])

  function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body: Record<string, string> = { system: String(f.get('system')), value: String(f.get('identifier_value')).trim() }
    const note = String(f.get('note') ?? '').trim()
    if (note) body.note = note
    add.mutate({ body, form: e.currentTarget })
  }

  return (
    // #1267: the history behind the person's email and codes, folded so the
    // page shows the email once; opening it shows every period.
    <details className={cardClasses('group p-4')} data-testid="person-identifiers">
      <summary className="cursor-pointer list-none rounded text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-focus" data-testid="identifier-history-toggle">
        Identifier History <span aria-hidden className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">▸</span>
      </summary>
      <div className="mb-2 mt-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Identifiers</h3>
        {/* Stays while the form is open, so the header never changes height. */}
        {!replacedBy && addable.length > 0 && (
          <Button variant="quiet" icon={<Plus aria-hidden size={16} />} aria-label="Add an identifier" aria-expanded={adding} onClick={() => setAdding(true)}>
            Add
          </Button>
        )}
      </div>
      {replacedBy && (
        <div className="mb-2" data-testid="replaced-banner">
          <Notice>
          This record was merged into <PrincipalLink id={replacedBy} />. Open that record to make changes.
          </Notice>
        </div>
      )}
      {groups.size === 0 && <p className="text-sm text-ink-muted">None recorded.</p>}
      {[...groups].map(([label, rows]) => (
        <div key={label} className="mb-2" data-testid={`identifier-group-${rows[0].system}`}>
          <div className="text-sm font-medium text-ink-muted">{label}</div>
          <ul className="space-y-1 text-sm">
            {rows.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-2" data-testid={`identifier-${i.id}`}>
                <span className="min-w-0">
                  {/* A long address breaks anywhere rather than run under End at phone width (#502). */}
                  <span className={i.current ? 'font-medium wrap-anywhere' : 'text-ink-muted line-through wrap-anywhere'}>{i.value}</span>
                  {i.assigner && <span className="text-sm text-ink-muted"> · {i.assigner}</span>}
                  <span className="block text-sm text-ink-muted">
                    {period(i)}
                    {SAID_BY_THE_LABEL.has(i.source) ? '' : ` · ${sourceLabel(i.source)}`}
                    {i.worker_type ? ` · ${i.worker_type}` : ''}
                    {i.verified ? '' : ' · not verified'}
                  </span>
                </span>
                {i.current && i.editable && !replacedBy && (
                  <RowMenu
                    name={`${label} ${i.value}`}
                    items={[{
                      label: 'End',
                      tone: 'negative',
                      disabled: end.isPending,
                      onSelect: () => {
                        if (!i.note_required) {
                          if (window.confirm(`End ${label} ${i.value}?`)) end.mutate({ id: i.id })
                          return
                        }
                        // By hand while the roster sync is frozen: say why. The
                        // question doubles as the confirm.
                        const note = window.prompt('Why are you ending this by hand? (kept with the record)')?.trim()
                        if (note) end.mutate({ id: i.id, note })
                      },
                    }]}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!replacedBy && addable.length > 0 && adding && (
        <form className="mt-2 space-y-2" onSubmit={onAdd} data-testid="add-identifier-form" {...NO_AUTOFILL_FORM}>
          <div className="flex flex-wrap items-center gap-2" data-testid="add-identifier-row">
            <Select name="system" aria-label="Identifier" value={system} onChange={(e) => setChosen(e.target.value)} wrapperClassName="w-48 shrink-0">
              {addable.map((s) => (
                <option key={s.row_id} value={s.row_id}>{s.label}</option>
              ))}
            </Select>
            <TextInput name="identifier_value" aria-label="Value" placeholder="Value" required autoFocus className="min-w-40 flex-1" {...NO_AUTOFILL_FIELD} />
            <Button type="submit" variant="primary" loading={add.isPending}>Add</Button>
            <Button variant="quiet" onClick={() => { setAdding(false); setError(null) }}>Cancel</Button>
          </div>
          {needsNote && (
            <TextInput
              name="note"
              aria-label="Note"
              placeholder="Why by hand? e.g. joiner, mailed by HR on 23-Oct"
              required
              data-testid="identifier-note"
            />
          )}
        </form>
      )}
      {error && (
        <div className="mt-2" data-testid="identifier-error">
          <Notice tone="negative">
          {error}
          </Notice>
        </div>
      )}
    </details>
  )
}
