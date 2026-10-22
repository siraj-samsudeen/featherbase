import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { PrincipalName } from '../lib/people'

// person-resolution D3: find a person by an exact identifier — the employee
// code HR mails for a joiner, a correction or a leaver (docs/DEPLOY.md). The
// server tidies the typed value by the system's rule, answers only people the
// viewer may read, and refuses restricted systems to anyone without the
// restricted tier. A merged-away record answers with its survivor.

interface Found {
  person_id: string
  resolved_to: string
  replaced: boolean
  current: boolean
  assigner: string
}

export function FindPerson() {
  const systems = useQuery({
    queryKey: ['identifier-systems-for-find'],
    queryFn: () => api.get<{ data: { row_id: string; label: string }[] }>(`/api/table/${encodeURIComponent('Identifier System')}?limit=100`),
  })
  const options = systems.data?.data ?? []
  const [system, setSystem] = useState<string | null>(null)
  const chosen = system ?? (options.some((s) => s.row_id === 'stylehr-employee-code') ? 'stylehr-employee-code' : options[0]?.row_id)
  const [found, setFound] = useState<Found[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onFind(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = String(new FormData(e.currentTarget).get('value') ?? '').trim()
    if (!chosen || !value) return
    setError(null)
    try {
      const res = await api.get<{ people: Found[] }>(`/api/identifiers?system=${encodeURIComponent(chosen)}&value=${encodeURIComponent(value)}`)
      setFound(res.people)
    } catch (err) {
      setFound(null)
      setError(err instanceof ApiError ? err.message : 'That search did not work')
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4" data-testid="find-person">
      <h1 className="text-lg font-semibold text-[var(--color-ink)]">Find a person by identifier</h1>
      <p className="text-sm text-[var(--color-ink-muted)]">
        Type the exact value — an employee code, a phone number, an address. Old values find the person too.
      </p>
      <form className="flex flex-wrap gap-2" onSubmit={onFind}>
        <select className="fc-input" aria-label="Identifier" value={chosen ?? ''} onChange={(e) => setSystem(e.target.value)}>
          {options.map((s) => (
            <option key={s.row_id} value={s.row_id}>{s.label}</option>
          ))}
        </select>
        <input name="value" className="fc-input min-w-0 flex-1" aria-label="Value" placeholder="e.g. RR-10104" required />
        <button type="submit" className="fc-btn-primary">Find</button>
      </form>
      {error && <p className="text-sm text-[var(--color-danger)]" data-testid="find-person-error">{error}</p>}
      {found && found.length === 0 && <p className="text-sm text-[var(--color-ink-muted)]" data-testid="find-person-none">Nobody you can see holds that value.</p>}
      {found && found.length > 0 && (
        <ul className="space-y-1" data-testid="find-person-results">
          {found.map((f) => (
            <li key={`${f.person_id}-${f.assigner}-${String(f.current)}`} className="text-sm">
              <Link to="/featherbase/admin/$table/$name" params={{ table: 'Person', name: f.resolved_to }} search={{ prefill: undefined }} className="font-medium text-[var(--color-brand)] hover:underline">
                <PrincipalName id={f.resolved_to} />
              </Link>
              <span className="text-xs text-[var(--color-ink-muted)]">
                {f.current ? ' · holds it now' : ' · held it before'}
                {f.assigner ? ` · firm ${f.assigner}` : ''}
                {f.replaced ? ' · found through a merged-away record' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
