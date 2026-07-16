import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, getSessionUser, listResource } from '../lib/api'

interface CommentRow {
  name: string
  content: string
  owner: string
  creation: string
}

// UI-018: a comment box on every document. Comments are Comment docs linked
// by ref_doctype/ref_name; @mentions autocomplete from the user list and
// render highlighted.
export function Comments({ doctype, name }: { doctype: string; name: string }) {
  const queryClient = useQueryClient()
  const me = getSessionUser()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const comments = useQuery({
    queryKey: ['comments', doctype, name],
    queryFn: () =>
      listResource<CommentRow>('Comment', {
        filters: [
          ['ref_doctype', '=', doctype],
          ['ref_name', '=', name],
        ],
        fields: ['name', 'content', 'owner', 'creation'],
        order_by: 'creation asc',
        limit_page_length: 200,
      }),
  })

  // @mention candidates from the user list, filtered by the token being typed.
  const users = useQuery({
    queryKey: ['mention-users'],
    enabled: mention !== null,
    queryFn: () =>
      listResource<{ name: string }>('User', {
        fields: ['name'],
        order_by: 'name asc',
        limit_page_length: 500,
      }),
  })
  const candidates = useMemo(() => {
    if (!mention) return []
    const q = mention.q.toLowerCase()
    return (users.data?.data ?? [])
      .map((u) => u.name)
      .filter((n) => n.toLowerCase().includes(q))
      .slice(0, 6)
  }, [mention, users.data])

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setDraft(value)
    // Detect an in-progress @mention: an @ token up to the caret.
    const caret = e.target.selectionStart
    const upto = value.slice(0, caret)
    const m = upto.match(/@([\w.@-]*)$/)
    setMention(m ? { q: m[1], at: caret - m[0].length } : null)
  }

  function applyMention(user: string) {
    if (!mention) return
    const before = draft.slice(0, mention.at)
    const after = draft.slice(mention.at + mention.q.length + 1)
    const next = `${before}@${user} ${after}`
    setDraft(next)
    setMention(null)
    inputRef.current?.focus()
  }

  async function post() {
    const content = draft.trim()
    if (!content) return
    setPosting(true)
    setError(null)
    try {
      await api.post('/api/save_doc', {
        doctype: 'Comment',
        doc: { ref_doctype: doctype, ref_name: name, content },
      })
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: ['comments', doctype, name] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Comment failed')
    } finally {
      setPosting(false)
    }
  }

  const initials = (u: string) =>
    u.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')

  // Render @mentions as highlighted spans.
  function renderContent(text: string) {
    const parts = text.split(/(@[\w.@-]+)/g)
    return parts.map((p, i) =>
      p.startsWith('@') ? (
        <span key={i} className="font-medium text-[var(--color-brand)]">
          {p}
        </span>
      ) : (
        <span key={i}>{p}</span>
      ),
    )
  }

  return (
    <div className="fc-card p-4" data-testid="comments-panel">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        Comments
      </div>

      <div className="mb-3 space-y-3" data-testid="comment-list">
        {comments.data?.data.length === 0 && (
          <p className="text-xs text-[var(--color-ink-faint)]">No comments yet</p>
        )}
        {comments.data?.data.map((c) => (
          <div key={c.name} className="flex gap-2" data-testid="comment-item">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] text-[10px] font-semibold text-white">
              {initials(c.owner)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--color-ink-muted)]">
                <span className="font-medium text-[var(--color-ink)]">{c.owner}</span>{' '}
                <span data-testid="comment-time">{new Date(c.creation).toLocaleString()}</span>
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-[var(--color-ink)]" data-testid="comment-content">
                {renderContent(c.content)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="relative">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={onChange}
          rows={2}
          placeholder={`Comment as ${me?.name ?? 'you'}… use @ to mention`}
          className="fc-input resize-none"
          data-testid="comment-input"
        />
        {mention && candidates.length > 0 && (
          <div className="fc-card absolute z-20 mt-1 w-56 overflow-hidden py-1" data-testid="mention-list">
            {candidates.map((u) => (
              <button
                key={u}
                onClick={() => applyMention(u)}
                data-testid="mention-option"
                className="block w-full px-3 py-1 text-left text-sm hover:bg-[var(--color-brand-tint)]"
              >
                {u}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-[var(--color-danger)]" data-testid="comment-error">
          {error}
        </p>
      )}
      <div className="mt-2 flex justify-end">
        <button
          onClick={post}
          disabled={posting || !draft.trim()}
          data-testid="comment-submit"
          className="fc-btn-primary disabled:opacity-40"
        >
          {posting ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  )
}
