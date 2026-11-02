import { useQuery } from '@tanstack/react-query'
import type { PersonOption } from './people'
import { api, listAllResources } from './api'

export interface Message {
  row_id: string
  task: string
  kind: 'Update' | 'Question' | 'Reply'
  body: string
  parent_message: string | null
  reply_needed_from: string | null
  reply_cycle: number
  resolved: boolean
  created_by: string
  created_at: string
  updated_at: string
}
export const discussionKey = ['task-management', 'discussions']
export function useDiscussions() {
  return useQuery({ queryKey: discussionKey, queryFn: () => listAllResources<Message>('tasker.discussion', {
    fields: ['row_id', 'task', 'kind', 'body', 'parent_message', 'reply_needed_from', 'resolved', 'reply_cycle', 'created_by', 'created_at', 'updated_at'],
    order_by: 'created_at asc', limit_page_length: 200,
  }), refetchInterval: 15000 })
}
export function repliesTo(root: Message, all: Message[]) {
  return all.filter(message => message.parent_message === root.row_id).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.row_id.localeCompare(b.row_id))
}
export function questionState(root: Message, all: Message[]): 'update' | 'waiting' | 'review' | 'resolved' {
  if (root.kind !== 'Question') return 'update'
  if (root.resolved) return 'resolved'
  const last = repliesTo(root, all).filter(reply => reply.reply_cycle === root.reply_cycle).at(-1)
  return last && last.created_by !== root.created_by ? 'review' : 'waiting'
}
export function needsAttention(root: Message, all: Message[], person: string) {
  const state = questionState(root, all)
  return state === 'review' ? root.created_by === person
    : state === 'waiting' && root.created_by !== person && (!root.reply_needed_from || root.reply_needed_from === person)
}
export function lastChanged(root: Message, all: Message[]) {
  return Math.max(...[root, ...repliesTo(root, all)].map(message => Date.parse(message.updated_at)))
}

export function useMembers() {
  return useQuery({ queryKey: ['task-management', 'members'], queryFn: () => api.get<{ data: PersonOption[] }>('/api/table_members/tasker.discussion') })
}
