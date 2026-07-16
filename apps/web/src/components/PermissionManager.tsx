import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'

// SET-003: edit the DocPerm matrix (roles × actions) for a DocType at
// permlevel 0. System-Manager-only; changes take effect immediately because
// the server reads DocPerm live on every request.

const FLAGS = [
  { key: 'can_read', label: 'Read' },
  { key: 'can_write', label: 'Write' },
  { key: 'can_create', label: 'Create' },
  { key: 'can_delete', label: 'Delete' },
  { key: 'can_submit', label: 'Submit' },
  { key: 'can_cancel', label: 'Cancel' },
  { key: 'can_amend', label: 'Amend' },
] as const

type Flags = Record<string, boolean>
interface PermsResponse {
  doctype: string
  roles: string[]
  perms: (Flags & { name: string; role: string })[]
}

export function PermissionManager({ doctype }: { doctype: string }) {
  const q = useQuery({
    queryKey: ['permissions', doctype],
    queryFn: () => api.get<PermsResponse>(`/api/permissions/${encodeURIComponent(doctype)}`),
  })
  const [matrix, setMatrix] = useState<Record<string, Flags>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState(0)

  useEffect(() => {
    if (!q.data) return
    const next: Record<string, Flags> = {}
    for (const role of q.data.roles) {
      const existing = q.data.perms.find((p) => p.role === role)
      next[role] = Object.fromEntries(
        FLAGS.map((f) => [f.key, existing ? Boolean(existing[f.key]) : false]),
      )
    }
    setMatrix(next)
    setDirty(new Set())
  }, [q.data])

  function toggle(role: string, key: string) {
    setMatrix((m) => ({ ...m, [role]: { ...m[role], [key]: !m[role][key] } }))
    setDirty((d) => new Set(d).add(role))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      for (const role of dirty)
        await api.post(`/api/permissions/${encodeURIComponent(doctype)}`, { role, ...matrix[role] })
      setDirty(new Set())
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (q.isError)
    return (
      <div className="fc-card p-4 text-sm text-red-600" data-testid="perm-error">
        {q.error instanceof ApiError ? q.error.message : 'Cannot load permissions'}
      </div>
    )
  if (!q.data) return <div className="p-4 text-[var(--color-ink-faint)]">Loading…</div>

  return (
    <div data-testid="permission-manager" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-ink)]">Permissions — {doctype}</h1>
        <div className="flex items-center gap-3">
          {savedAt > 0 && !dirty.size && (
            <span className="text-sm text-green-700" data-testid="perm-saved">
              Saved
            </span>
          )}
          <button
            className="fc-btn fc-btn-primary"
            data-testid="perm-save"
            disabled={saving || !dirty.size}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="fc-card p-3 text-sm text-red-600" data-testid="perm-save-error">
          {error}
        </div>
      )}

      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-ink-muted)]">
              <th className="px-3 py-2 font-medium">Role</th>
              {FLAGS.map((f) => (
                <th key={f.key} className="px-3 py-2 text-center font-medium">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data.roles.map((role) => (
              <tr key={role} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-3 py-2 font-medium text-[var(--color-ink)]">{role}</td>
                {FLAGS.map((f) => (
                  <td key={f.key} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      data-testid={`perm-${role}-${f.key}`}
                      checked={matrix[role]?.[f.key] ?? false}
                      onChange={() => toggle(role, f.key)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
