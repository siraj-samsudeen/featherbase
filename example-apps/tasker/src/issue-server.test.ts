import { describe, expect, it } from 'vitest'
import { runEscalation } from './issue-server'

// The escalation job reads issues through the platform's documents API, the runtime boundary.
function owner(openIssues: number) {
  const ids = Array.from({ length: openIssues }, (_, index) => `ISSUE-${String(index + 1).padStart(5, '0')}`)
  const updated: Record<string, unknown>[] = []
  const documents = {
    list: async (_table: string, args: { limit_start?: number; limit_page_length?: number } = {}) =>
      ids.slice(args.limit_start ?? 0, (args.limit_start ?? 0) + (args.limit_page_length ?? 20)).map(row_id => ({ row_id })),
    get: async (_table: string, id: string) => ({ row_id: id, updated_at: `${id}-version` }),
    update: async (_table: string, values: Record<string, unknown>) => { updated.push(values); return values },
  }
  return { documents, updated }
}

describe('the escalation job', () => {
  it('checks every open issue of an owner with more than one page of them', async () => {
    const { documents, updated } = owner(201)
    let result = ''
    await runEscalation({
      now: '2026-11-09T10:00:00.000Z',
      documents: { forEachOwner: async (callback) => callback({ user: 'meena@example.com', documents }) },
      setResult: (text) => { result = text },
    })
    expect(result).toBe('Checked 201 open issues')
    expect(updated).toHaveLength(201)
    expect(updated[200]).toEqual({ row_id: 'ISSUE-00201', updated_at: 'ISSUE-00201-version', checked_at: '2026-11-09T10:00:00.000Z' })
  })
})
