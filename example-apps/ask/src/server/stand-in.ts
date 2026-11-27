import type { Model } from './agent'

// Each word the stand-in knows, with the Table it counts and what it calls the rows.
const RULES = [
  { word: /\bchats?\b/i, table: 'ask.chat', noun: 'chat' },
  { word: /\btickets?\b/i, table: 'tickets.ticket', noun: 'ticket' },
]

/** The stand-in model, until step 3 brings a real one: fixed word rules that make the
 *  same tool calls a real model would. */
export const standIn: Model = {
  async next(question, _tools, done) {
    const rule = RULES.find((r) => r.word.test(question))
    if (!rule) return { kind: 'cannot', text: "I can't answer that yet. Try: How many chats do I have?" }
    const last = done[done.length - 1]
    if (!last) return { kind: 'call', call: { name: 'query_rows', args: { table: rule.table, limit: 1 } } }
    if (last.refused) return { kind: 'cannot', text: `I couldn't answer that: ${last.result}` }
    const { total } = last.result as { total: number }
    return { kind: 'answer', text: `You have ${total} ${rule.noun}${total === 1 ? '' : 's'}.` }
  },
}