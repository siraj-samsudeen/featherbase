import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Select, inputClasses, fmtDateTime, StatusPill } from '@featherbase/shop-floor'
import { api, getSessionUser } from './api'
import { discussionKey, lastChanged, needsAttention, questionState, repliesTo, useDiscussions, useMembers, type Message } from './discussions'
import { Markdown } from './Markdown'

const seenKey = ['task-management', 'discussion-seen']
export function Discussion({ taskId, shared }: { taskId: string; shared: boolean }) {
  const me = getSessionUser()?.row_id ?? ''
  const [target, setTarget] = useState(() => new URLSearchParams(location.hash.slice(1)).get('question'))
  const lastScrolled = useRef<string | null>(null)
  useEffect(() => {
    const changed = () => setTarget(new URLSearchParams(location.hash.slice(1)).get('question'))
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const queryClient = useQueryClient()
  const messages = useDiscussions()
  const people = useMembers()
  const seen = useQuery({ queryKey: seenKey, queryFn: () => api.get<{ settings: Record<string, number> | null }>('/api/user_settings/tasker.discussion-seen') })
  const [kind, setKind] = useState<'Update' | 'Question'>('Update')
  const [body, setBody] = useState('')
  const [respondent, setRespondent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const all = messages.data?.data ?? []
  useEffect(() => {
    if (!target || lastScrolled.current === target) return
    const element = document.getElementById(`question-${target}`)
    if (element) {
      const panel = element.closest('.tasker-inspector, .tasker-focus-detail')
      if (panel) panel.scrollTop += element.getBoundingClientRect().top - panel.getBoundingClientRect().top - 20
      element.focus({ preventScroll: true })
      lastScrolled.current = target
    }
  }, [target, messages.dataUpdatedAt, taskId])
  const roots = all.filter(message => message.task === taskId && !message.parent_message).sort((a, b) =>
    Number(needsAttention(b, all, me)) - Number(needsAttention(a, all, me)) || lastChanged(b, all) - lastChanged(a, all))
  const name = (id: string) => people.data?.data.find(person => person.row_id === id)?.full_name || (id === me ? 'You' : 'Former member')
  async function save(row: Record<string, unknown>) {
    setBusy(true); setError('')
    try {
      await api.post('/api/save_row', { table: 'tasker.discussion', row })
      await queryClient.invalidateQueries({ queryKey: discussionKey })
      return true
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save message'); return false }
    finally { setBusy(false) }
  }
  async function markRead(root: Message) {
    try {
      const latest = await api.get<{ settings: Record<string, number> | null }>('/api/user_settings/tasker.discussion-seen')
      await api.put('/api/user_settings/tasker.discussion-seen', { ...latest.settings, [root.row_id]: lastChanged(root, all) })
      await queryClient.invalidateQueries({ queryKey: seenKey })
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not mark read') }
  }
  return <section aria-label="Task discussion" className="mt-6 space-y-4">
    <h3 className="font-semibold">Discussion</h3>
    {(error || messages.error) && <p role="alert">{error || messages.error?.message}</p>}
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault()
      if (await save({ task: taskId, kind, body: body.trim(), reply_needed_from: kind === 'Question' ? respondent || null : null })) setBody('')
    }}>
      <Field label="Message type"><Select value={kind} onChange={event => setKind(event.target.value as 'Update' | 'Question')}><option>Update</option><option>Question</option></Select></Field>
      {kind === 'Question' && <Field label="Reply needed from"><Select value={respondent} onChange={event => setRespondent(event.target.value)}><option value="">{shared ? 'Anyone' : 'Only you until shared'}</option>{shared && people.data?.data.filter(person => person.row_id !== me).map(person => <option key={person.row_id} value={person.row_id}>{person.full_name}</option>)}</Select></Field>}
      <Field label={kind === 'Question' ? 'Your question' : 'Your update'}><textarea className={inputClasses()} rows={3} value={body} onChange={event => setBody(event.target.value)} required /></Field>
      <Button type="submit" variant="primary" disabled={busy || !body.trim()}>Post {kind.toLowerCase()}</Button>
    </form>
    {messages.isPending && <p role="status">Loading discussion…</p>}
    {!messages.isPending && !roots.length && <p>No discussion yet. Post an update or ask a question.</p>}
    {roots.map(root => {
      const state = questionState(root, all)
      const unread = lastChanged(root, all) > (seen.data?.settings?.[root.row_id] ?? 0)
      return <article key={root.row_id} id={`question-${root.row_id}`} tabIndex={-1} className="rounded-card border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <strong>{name(root.created_by)}</strong>{' '}<span className="text-ink-muted">{root.kind === 'Question' ? 'asked' : 'commented'} · {fmtDateTime(new Date(root.created_at))}</span>
          <StatusPill tone={state === 'resolved' ? 'positive' : state === 'update' ? 'neutral' : 'caution'}>{state === 'waiting' ? 'Waiting for reply' : state === 'review' ? 'Needs asker’s review' : state === 'resolved' ? 'Resolved' : 'Update'}</StatusPill>
          {unread && <span className="text-action">Unread</span>}
        </div>
        <Markdown>{root.body}</Markdown>
        {root.kind === 'Question' && <p className="text-ink-muted">Reply needed from: {!shared ? 'Only you until this task is shared' : root.reply_needed_from ? name(root.reply_needed_from) : 'Anyone'}</p>}
        <ol className="space-y-3 border-l border-border pl-4">{repliesTo(root, all).map(reply => <li key={reply.row_id}><p><strong>{name(reply.created_by)}</strong> · {fmtDateTime(new Date(reply.created_at))}</p><Markdown>{reply.body}</Markdown></li>)}</ol>
        <div className="flex flex-wrap gap-2">
          {unread && <Button onClick={() => void markRead(root)}>Mark read</Button>}
          {root.kind === 'Question' && root.created_by === me && <Button disabled={busy} onClick={() => void save({ row_id: root.row_id, updated_at: root.updated_at, resolved: !root.resolved })}>{root.resolved ? 'Reopen question' : 'Mark answered'}</Button>}
        </div>
        {!root.resolved && <Reply key={root.row_id} root={root} busy={busy} save={save} />}
      </article>
    })}
  </section>
}
function Reply({ root, busy, save }: { root: Message; busy: boolean; save: (row: Record<string, unknown>) => Promise<boolean> }) {
  const [body, setBody] = useState('')
  return <form className="space-y-2" onSubmit={async event => {
    event.preventDefault()
    if (await save({ task: root.task, parent_message: root.row_id, kind: 'Reply', body: body.trim() })) setBody('')
  }}><Field label={`Reply to ${root.body}`}><textarea className={inputClasses()} value={body} onChange={event => setBody(event.target.value)} rows={2} required /></Field><Button type="submit" disabled={busy || !body.trim()}>Reply</Button></form>
}
