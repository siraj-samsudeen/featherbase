import { useMemo, useRef, useState } from 'react'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { isOpaqueId, usePrincipalName } from '../lib/people'
import { ApiError, api, getSessionUser, listResource } from '../lib/api'
import { useWhoAmI } from '../lib/session'
import { buttonClasses, cardClasses, inputClasses } from '@featherbase/shop-floor'

interface CommentRow {
  row_id: string
  content: string
  created_by: string
  created_at: string
}

export interface VersionRow {
  created_by: string
  created_at: string
  data: {
    changed?: [string, unknown, unknown][]
    created?: boolean
    import_run?: string
    resolution?: { field: string; decision: 'keep' | 'source'; incoming: unknown }
    // #859: a retirement or reactivation, with the reason given to retire.
    retirement?: { action: 'retired' | 'reactivated'; reason?: string }
    // #1083 (D8): made by an agent through /mcp, with this access token.
    agent?: { token_id: string; token_label: string }
  } | null
}

/** A row's comments and edits, oldest first — one query, read by this panel
 *  and by the activity timeline beside it (they share the cache key). It
 *  goes through the row's own access (#342): the server opens the row first
 *  and leaves out changes to columns the reader cannot see. */
export function activityQuery(table: string, name: string) {
  return queryOptions({
    queryKey: ['activity', table, name],
    queryFn: () =>
      api.get<{ created?: { created_by?: string; created_at?: string }; comments: CommentRow[]; versions: VersionRow[] }>(
        `/api/activity/${encodeURIComponent(table)}/${encodeURIComponent(name)}`,
      ),
  })
}

// UI-018: a comment box on every row. Comments are Comment rows linked
// by ref_table/ref_name; @mentions autocomplete from the user list and
// render highlighted.
export function Comments({ table, name }: { table: string; name: string }) {
  const queryClient = useQueryClient()
  const me = getSessionUser()
  // #909: the box names the person by name, never by an internal id.
  const whoami = useWhoAmI().data
  const myName = whoami?.full_name?.trim() || (me && !isOpaqueId(me.row_id) ? me.row_id : null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null)
  // A name-only mention that several people share notifies nobody; say so.
  const [mentionWarning, setMentionWarning] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  function applyMention(user: string, mention: { q: string; at: number }) {
    const fold = (n: string | null) => (n ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    const named = user.startsWith('[') ? fold(user.slice(1, -1)) : null
    // Called from an offered person, so the people list has loaded.
    const twins = named ? users.data!.data.filter((u) => fold(u.full_name) === named).length : 0
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
    setPosting(true)
    setError(null)
    try {
      await api.post('/api/save_row', {
        table: 'Comment',
        row: { ref_table: table, ref_name: name, content },
      })
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: ['activity', table, name] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Comment failed')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className={cardClasses('p-4')} data-testid="comments-panel">
      <div className="mb-3 text-xs font-semibold text-ink-subtle">
        Comments
      </div>

      <div className="relative">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={onChange}
          rows={2}
          placeholder={myName ? `Comment as ${myName}… use @ to mention` : 'Write a comment… use @ to mention'}
          className={inputClasses('resize-none')}
          data-testid="comment-input"
        />
        {mention && candidates.length > 0 && (
          <div className={cardClasses('absolute z-20 mt-1 w-56 overflow-hidden py-1')} data-testid="mention-list">
            {candidates.map((u) => (
              <button
                key={u.row_id}
                onClick={() => applyMention(mentionToken(u), mention)}
                data-testid="mention-option"
                className="block w-full px-3 py-1 text-left text-sm hover:bg-action-tint"
              >
                {u.full_name && u.username ? `${u.full_name} · @${u.username}` : u.full_name || u.username}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-negative" data-testid="comment-error">
          {error}
        </p>
      )}
      <div className="mt-2 flex justify-end">
        {mentionWarning && (
          <p className="mb-1 text-xs text-caution" data-testid="mention-warning" role="status">
            {mentionWarning}
          </p>
        )}
        <button
          onClick={post}
          disabled={posting || !draft.trim()}
          data-testid="comment-submit"
          className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}
        >
          {posting ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  )
}

/** What a mention of this person looks like in the comment text. Only people
 *  with a username or a name are offered (candidates). */
function mentionToken(u: { full_name: string | null; username: string | null }): string {
  return u.username ? u.username : `[${u.full_name!.trim()}]`
}

const initialsOf = (name: string) =>
  name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

/** The author's initials — from their name, never from an opaque id. */
export function AuthorInitials({ id }: { id: string }) {
  const name = usePrincipalName(id)
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-action text-xs font-semibold text-action-ink"
      data-testid="comment-initials"
    >
      {name ? initialsOf(name) : isOpaqueId(id) ? '·' : initialsOf(id)}
    </span>
  )
}
