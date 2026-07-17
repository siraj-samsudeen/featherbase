import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'

// UI-017: free-form tags on a document.
export function Tags({ doctype, name }: { doctype: string; name: string }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const tags = useQuery({
    queryKey: ['tags', doctype, name],
    queryFn: () => api.get<{ tags: string[] }>(`/api/tags/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`),
  })

  async function add() {
    const tag = draft.trim()
    if (!tag) return
    setError(null)
    try {
      await api.post('/api/tags', { doctype, name, tag })
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: ['tags', doctype, name] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add tag failed')
    }
  }

  async function remove(tag: string) {
    try {
      await api.delete(
        `/api/tags/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
      )
      await queryClient.invalidateQueries({ queryKey: ['tags', doctype, name] })
    } catch {
      // ignore
    }
  }

  return (
    <div className="fc-card p-4" data-testid="tags-panel">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        Tags
      </div>
      <div className="mb-2 flex flex-wrap gap-1" data-testid="tag-list">
        {tags.data?.tags.length === 0 && (
          <span className="text-xs text-[var(--color-ink-faint)]">No tags</span>
        )}
        {tags.data?.tags.map((t) => (
          <span
            key={t}
            className="fc-pill bg-[var(--color-brand-tint)] text-[var(--color-brand)]"
            data-testid="tag-chip"
          >
            {t}
            <button
              onClick={() => remove(t)}
              aria-label={`Remove ${t}`}
              className="ml-1 text-[var(--color-brand)] hover:text-[var(--color-danger)]"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add tag…"
          className="fc-input flex-1"
          data-testid="tag-input"
        />
        <button onClick={add} disabled={!draft.trim()} className="fc-btn disabled:opacity-40" data-testid="tag-add">
          Add
        </button>
      </div>
      {error && (
        <p className="mt-1 text-xs text-[var(--color-danger)]" data-testid="tag-error">
          {error}
        </p>
      )}
    </div>
  )
}
