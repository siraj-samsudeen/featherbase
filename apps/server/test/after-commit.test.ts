// #426: an effect a document hook registers with afterDocumentCommit waits for
// the commit of the transaction it was registered in. Before this, a hook
// inside saveDoc's transaction ran its effect at once: a mention's realtime
// event reached the recipient while the Notification Log row was still
// uncommitted, and the unread count it triggered could read 0.
//
// `commit` here stands in for `sql.begin(...)`: it resolves when the
// transaction has committed and rejects when it rolled back.
import { describe, expect, test } from 'vitest'
import { afterCommitOf, afterDocumentCommit } from '../src/action-transaction'

describe('afterCommitOf', () => {
  test('an effect registered inside the transaction runs only after it commits', async () => {
    const order: string[] = []
    const result = await afterCommitOf(async () => {
      await afterDocumentCommit(async () => {
        order.push('effect')
      })
      order.push('still inside the transaction')
      await Promise.resolve()
      order.push('committed')
      return 'row'
    })
    expect(result).toBe('row')
    expect(order).toEqual(['still inside the transaction', 'committed', 'effect'])
  })

  test('a rolled-back transaction runs none of its effects', async () => {
    const ran: string[] = []
    await expect(
      afterCommitOf(async () => {
        await afterDocumentCommit(async () => {
          ran.push('effect')
        })
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')
    expect(ran).toEqual([])
  })

  test('inside an enclosing scope, effects wait for the OUTER commit', async () => {
    const order: string[] = []
    await afterCommitOf(async () => {
      await afterCommitOf(async () => {
        await afterDocumentCommit(async () => {
          order.push('effect')
        })
      })
      order.push('inner committed, outer still open')
    })
    expect(order).toEqual(['inner committed, outer still open', 'effect'])
  })

  test('a failing effect does not undo the committed result, and later effects still run', async () => {
    const ran: string[] = []
    const result = await afterCommitOf(async () => {
      await afterDocumentCommit(async () => {
        throw new Error('mail server down')
      })
      await afterDocumentCommit(async () => {
        ran.push('second')
      })
      return 'row'
    })
    expect(result).toBe('row')
    expect(ran).toEqual(['second'])
  })
})
