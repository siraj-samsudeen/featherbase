import { describe, expect, it, vi } from 'vitest'
vi.mock('./api', () => ({ api: {}, listAllResources: vi.fn() }))
const { hasUnreadActivity } = await import('./discussions')
import type { Message } from './discussions'

const message = (row: Partial<Message>): Message => ({
  row_id: 'DISC-1', task: 'TASK-1', kind: 'Question', body: 'Which billing type?', parent_message: null,
  reply_needed_from: null, reply_cycle: 0, resolved: false, created_by: 'siraj',
  created_at: '2026-11-04T07:00:00Z', updated_at: '2026-11-04T07:00:00Z', ...row,
})

describe('unread discussion activity', () => {
  it('does not mark your own question unread for you', () => {
    const question = message({})
    expect(hasUnreadActivity(question, [question], 'siraj', 0)).toBe(false)
    expect(hasUnreadActivity(question, [question], 'shahul', 0)).toBe(true)
  })

  it('marks a reply from someone else unread until it has been seen', () => {
    const question = message({})
    const reply = message({ row_id: 'DISC-2', kind: 'Reply', parent_message: 'DISC-1', created_by: 'shahul', created_at: '2026-11-04T07:05:00Z', updated_at: '2026-11-04T07:05:00Z' })
    expect(hasUnreadActivity(question, [question, reply], 'siraj', 0)).toBe(true)
    expect(hasUnreadActivity(question, [question, reply], 'siraj', Date.parse('2026-11-04T07:05:00Z'))).toBe(false)
  })

  it('does not mark a question unread when only you changed it, such as resolving it', () => {
    const question = message({ resolved: true, updated_at: '2026-11-04T07:10:00Z' })
    const reply = message({ row_id: 'DISC-2', kind: 'Reply', parent_message: 'DISC-1', created_by: 'shahul', created_at: '2026-11-04T07:05:00Z', updated_at: '2026-11-04T07:05:00Z' })
    expect(hasUnreadActivity(question, [question, reply], 'siraj', Date.parse('2026-11-04T07:05:00Z'))).toBe(false)
  })
})
