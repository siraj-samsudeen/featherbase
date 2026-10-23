import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PrincipalName, isOpaqueId, usePrincipalName } from '../lib/people'
import { ApiError, api, getSessionUser, listResource } from '../lib/api'

interface CommentRow {
  row_id: string
  content: string
  created_by: string
  created_at: string
}

// UI-018: a comment box on every row. Comments are Comment rows linked
// by ref_table/ref_name; @mentions autocomplete from the user list and
// render highlighted.
export function Comments({ table, name }: { table: string; name: string }) {
  const queryClient = useQueryClient()
  const me = getSessionUser()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null)
  // A name-only mention that several people share notifies nobody; say so.
  const [mentionWarning, setMentionWarning] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const comments = useQuery({
    queryKey: ['comments', table, name],
    queryFn: () =>
      listResource<CommentRow>('Comment', {
        filters: [
          ['ref_table', '=', table],
          ['ref_name', '=', name],
        ],
        fields: ['row_id', 'content', 'created_by', 'created_at'],
        order_by: 'created_at asc',
        limit_page_length: 200,
      }),
  })

  // @mention candidates from the people list, filtered by the token being
  // typed. person-rename: ids are opaque, so a mention names the person —
  // `@username`, or `@[Full Name]` for someone without one (the server
  // resolves both; never a row id). Built-in accounts are not offered.
  const users = useQuery({
    queryKey: ['mention-users'],
    enabled: mention !== null,
    queryFn: () =>
      listResource<{ row_id: string; full_name: string | null; username: string | null }>('Person', {
        fields: ['row_id', 'full_name', 'username'],
        filters: [['built_in', '=', false], ['replaced_by', '=', null]],
        order_by: 'full_name asc',
        limit_page_length: 500,
      }),
  })
  const candidates = useMemo(() => {
    if (!mention) return []
    const q = mention.q.toLowerCase()
    // Staff ids are employee codes (person-identities), so the name is shown
    // and searched too; the mention itself stays the id.
    return (users.data?.data ?? [])
      // A person with neither a username nor a name cannot be mentioned:
      // a mention never carries a row id.
      .filter((u) => Boolean(u.username || u.full_name?.trim()))
      .filter((u) => (u.username ?? '').toLowerCase().includes(q) || (u.full_name ?? '').toLowerCase().includes(q))
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
    const fold = (n: string | null) => (n ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    const named = user.startsWith('[') ? fold(user.slice(1, -1)) : null
    const twins = named ? (users.data?.data ?? []).filter((u) => fold(u.full_name) === named).length : 0
    setMentionWarning(
      twins > 1
        ? `${twins} people are named ${user.slice(1, -1)}, so this mention will notify nobody. Ask them to set a username, or mention them by it.`
        : null,
    )
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
      await api.post('/api/save_row', {
        table: 'Comment',
        row: { ref_table: table, ref_name: name, content },
      })
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: ['comments', table, name] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Comment failed')
    } finally {
      setPosting(false)
    }
  }

  // Render @mentions as highlighted spans.
  function renderContent(text: string) {
    // `@username` or `@[Full Name]` (person-rename: never a row id).
    // A mention starts a word: `name@gmail.com` is an address, not a mention.
    const parts = text.split(/((?<![\w.@-])@\[[^\]\n]{1,140}\]|(?<![\w.@-])@[\w.-]+)/g)
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
          <div key={c.row_id} className="flex gap-2" data-testid="comment-item">
            <AuthorInitials id={c.created_by} />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--color-ink-muted)]">
                <span className="font-medium text-[var(--color-ink)]" data-testid="comment-author"><PrincipalName id={c.created_by} /></span>{' '}
                <span data-testid="comment-time">{new Date(c.created_at).toLocaleString()}</span>
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
          placeholder={`Comment as ${me?.row_id ?? 'you'}… use @ to mention`}
          className="fc-input resize-none"
          data-testid="comment-input"
        />
        {mention && candidates.length > 0 && (
          <div className="fc-card absolute z-20 mt-1 w-56 overflow-hidden py-1" data-testid="mention-list">
            {candidates.map((u) => (
              <button
                key={u.row_id}
                onClick={() => applyMention(mentionToken(u))}
                data-testid="mention-option"
                className="block w-full px-3 py-1 text-left text-sm hover:bg-[var(--color-brand-tint)]"
              >
                {u.full_name && u.username ? `${u.full_name} · @${u.username}` : u.full_name || u.username}
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
        {mentionWarning && (
          <p className="mb-1 text-xs text-[var(--color-warning,#b45309)]" data-testid="mention-warning" role="status">
            {mentionWarning}
          </p>
        )}
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

/** What a mention of this person looks like in the comment text. */
export function mentionToken(u: { full_name: string | null; username: string | null }): string {
  return u.username ? u.username : `[${(u.full_name ?? '').trim()}]`
}

const initialsOf = (name: string) =>
  name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

/** The author's initials — from their name, never from an opaque id. */
function AuthorInitials({ id }: { id: string }) {
  const name = usePrincipalName(id)
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] text-[10px] font-semibold text-white"
      data-testid="comment-initials"
    >
      {name ? initialsOf(name) : isOpaqueId(id) ? '·' : initialsOf(id)}
    </span>
  )
}
