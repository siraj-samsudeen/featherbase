import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useIsSystemManager } from '../lib/session'
import { Button, Card } from './ui'

// person-resolution D2: on an Identifier System form, each Advanced setting
// shows the default its kind gives it, with "Revert to default" where it
// differs, and says why an option is refused (Tableau-style: detected,
// labelled, revertible).
const LABELS: Record<string, string> = {
  normalise: 'Normalise',
  one_holder_at_a_time: 'One holder at a time',
  one_per_person: 'One per person',
  assigner_scoped: 'Scoped by assigner',
  edited_by: 'Edited by',
  retain_after_leaving_days: 'Retain after leaving (days)',
  match: 'Match',
  sensitivity: 'Sensitivity',
}

const shown = (v: unknown) => (v === true ? 'on' : v === false ? 'off' : v == null ? '—' : String(v))

export function IdentifierSystemDefaults({ systemKey }: { systemKey: string }) {
  const isManager = useIsSystemManager()
  const qc = useQueryClient()
  const key = ['identifier-system-defaults', systemKey]
  const { data } = useQuery({
    queryKey: key,
    enabled: isManager,
    queryFn: () =>
      api.get<{ preset: Record<string, unknown>; differs: string[]; forbidden: { field: string; reason: string }[]; assurance: string }>(
        `/api/identifier_systems/${encodeURIComponent(systemKey)}/defaults`,
      ),
  })
  const revert = useMutation({
    mutationFn: async (field: string) => {
      const url = `/api/table/${encodeURIComponent('Identifier System')}/${encodeURIComponent(systemKey)}`
      const row = await api.get<{ updated_at: string }>(url)
      return api.patch(url, { [field]: data!.preset[field], updated_at: row.updated_at })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries()
    },
  })
  if (!isManager || !data) return null
  return (
    <Card className="p-3" data-testid="identifier-system-defaults">
      <h3 className="mb-1 text-sm font-semibold text-ink">Defaults for this kind</h3>
      <p className="mb-2 text-sm text-ink-muted">Assurance: {data.assurance} (from the kind)</p>
      <ul className="space-y-1 text-sm">
        {Object.keys(LABELS).map((field) => (
          <li key={field} className="flex items-start justify-between gap-2" data-testid={`default-${field}`}>
            <span>
              <span className="font-medium">{LABELS[field]}</span>{' '}
              <span className="text-sm text-ink-muted">default {shown(data.preset[field])}</span>
              {data.forbidden
                .filter((f) => f.field === field)
                .map((f) => (
                  <span key={f.reason} className="block text-sm text-ink-muted">{f.reason}</span>
                ))}
            </span>
            {data.differs.includes(field) && (
              <Button variant="quiet" onClick={() => revert.mutate(field)}>
                Revert to default
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
