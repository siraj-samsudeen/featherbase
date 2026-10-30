import { Button, StatusPill } from '@featherbase/shop-floor'
import { useQuery } from '@tanstack/react-query'
import { api, getSessionUser } from './api'
import { lastChanged, needsAttention, questionState, useDiscussions, useMembers } from './discussions'

export function Attention({ tasks, onOpen }: { tasks: { row_id: string; task_title: string }[]; onOpen: (task: string, question: string) => void }) {
  const me = getSessionUser()?.row_id ?? ''
  const messages = useDiscussions()
  const members = useMembers()
  const seen = useQuery({ queryKey: ['task-management', 'discussion-seen'], queryFn: () => api.get<{ settings: Record<string, number> | null }>('/api/user_settings/tasker.discussion-seen') })
  const all = messages.data?.data ?? []
  const roots = all.filter(message => !message.parent_message && needsAttention(message, all, me))
    .sort((a, b) => lastChanged(b, all) - lastChanged(a, all))
  return <section aria-label="Needs your attention" className="mb-6 space-y-3">
    <h3 className="font-semibold">Needs your attention</h3>
    {messages.error && <p role="alert">Could not load questions: {messages.error.message}</p>}
    {messages.isPending && <p role="status">Loading questions…</p>}
    {!messages.isPending && !messages.error && !roots.length && <p className="text-ink-muted">No questions need your attention.</p>}
    {roots.map(root => <div key={root.row_id} className="rounded-card border border-border bg-surface p-4 space-y-2">
      <p className="text-ink-muted">{tasks.find(task => task.row_id === root.task)?.task_title ?? 'Task'} · {members.data?.data.find(member => member.row_id === root.created_by)?.full_name ?? (root.created_by === me ? 'You' : 'Former member')}</p>
      <Button variant="quiet" className="text-left justify-start" onClick={() => onOpen(root.task, root.row_id)}>{root.body}</Button>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="caution">{questionState(root, all) === 'review' ? 'Review answer' : root.reply_needed_from ? 'Reply needed from you' : 'Open to anyone'}</StatusPill>
        {lastChanged(root, all) > (seen.data?.settings?.[root.row_id] ?? 0) && <span className="text-action">Unread</span>}
      </div>
    </div>)}
  </section>
}
