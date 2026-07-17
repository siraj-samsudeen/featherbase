import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api, ApiError } from '../lib/api'

// UI-027: a Workspace renders its configured shortcuts as navigable cards.

interface Shortcut {
  label: string
  type?: string // doctype | report | dashboard | url
  link_to: string
}
interface WorkspaceDoc {
  name: string
  label?: string
  icon?: string
  shortcuts?: Shortcut[] | string
}

function routeFor(s: Shortcut): string {
  const to = s.link_to
  switch (s.type) {
    case 'dashboard':
      return `/desk/dashboard/${encodeURIComponent(to)}`
    case 'report':
      return `/desk/query-report/${encodeURIComponent(to)}`
    case 'url':
      return to
    case 'doctype':
    default:
      return `/desk/${encodeURIComponent(to)}`
  }
}

function parseShortcuts(raw: Shortcut[] | string | undefined): Shortcut[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw)
      return Array.isArray(p) ? p : []
    } catch {
      return []
    }
  }
  return []
}

export function WorkspaceView({ name }: { name: string }) {
  const navigate = useNavigate()
  const ws = useQuery({
    queryKey: ['workspace', name],
    queryFn: () => api.get<WorkspaceDoc>(`/api/resource/Workspace/${encodeURIComponent(name)}`),
  })

  if (ws.isError)
    return (
      <div className="fc-card p-4 text-sm text-red-600" data-testid="workspace-error">
        {ws.error instanceof ApiError ? ws.error.message : 'Workspace not found'}
      </div>
    )
  if (!ws.data) return <div className="p-4 text-[var(--color-ink-faint)]">Loading…</div>

  const shortcuts = parseShortcuts(ws.data.shortcuts)

  return (
    <div data-testid="workspace" className="space-y-4">
      <h1 className="text-lg font-semibold text-[var(--color-ink)]" data-testid="workspace-title">
        {ws.data.icon ? `${ws.data.icon} ` : ''}
        {ws.data.label || ws.data.name}
      </h1>

      {shortcuts.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-faint)]">No shortcuts configured.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="workspace-shortcuts">
          {shortcuts.map((s) => (
            <button
              key={s.label}
              data-testid={`shortcut-${s.label}`}
              onClick={() => navigate({ to: routeFor(s) })}
              className="fc-card p-4 text-left transition hover:border-[var(--color-brand)]"
            >
              <div className="text-sm font-medium text-[var(--color-ink)]">{s.label}</div>
              <div className="mt-1 text-xs text-[var(--color-ink-muted)]">{s.type ?? 'doctype'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
