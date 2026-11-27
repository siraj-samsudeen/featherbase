// Feather Ask's server entry. The platform loads this file (built to dist/server.mjs)
// and calls actions.ask for POST /api/app_actions/ask/ask, reads.think for POST /api/app_reads/ask/think.
import { MAX_QUESTION_LENGTH, type Reply } from '../shared/reply'
import { answer, type McpTools } from './agent'
import { reply } from './reply'
import { standIn } from './stand-in'

type Row = Record<string, unknown>

// An action may write: its context adds documents, which act as the person asking,
// under Ask's permissions (own rows only). Apps never import platform code.
type ActionContext = {
  user: string
  payload: unknown
  reject(message: string): never
  documents: {
    get(table: string, id: string): Promise<Row>
    create(table: string, row: Row): Promise<Row>
  }
}

// A read may not write. Ask's think read is outbound and declares featherbaseMcp, so the
// platform hands it Featherbase's read-only tools, run with the person's own credential.
// No credential (a read the server starts itself): no tools.
type ReadContext = {
  user: string
  payload: unknown
  reject(message: string): never
  featherbaseMcp?: McpTools
}

// Must equal featherbase.json's platformVersion, or the platform won't load the app.
export const platformVersion = '2026-10'

// A chat's title is its first question, cut to what a Data column holds.
const TITLE_LENGTH = 140

// What the action and the read both have: the page's payload, and a way to refuse it.
type Asked = { payload: unknown; reject(message: string): never }

/** The question from the page's payload: a non-empty string of reasonable length. */
function questionFrom(ctx: Asked): string {
  const question = (ctx.payload as { question?: unknown } | null)?.question
  if (typeof question !== 'string' || !question.trim()) ctx.reject('Type a question first')
  if (question.length > MAX_QUESTION_LENGTH) ctx.reject(`Keep the question under ${MAX_QUESTION_LENGTH} characters`)
  return question.trim()
}

/** The chat this question goes in: the one the page names, or a new one titled by the question. */
async function chatFor(ctx: ActionContext, question: string): Promise<string> {
  const chat = (ctx.payload as { chat?: unknown }).chat
  if (chat === undefined) {
    const title = question.replace(/\s+/g, ' ').slice(0, TITLE_LENGTH)
    return String((await ctx.documents.create('ask.chat', { title })).row_id)
  }
  if (typeof chat !== 'string') ctx.reject('Unknown chat')
  // Own rows only: someone else's chat is not found, so nobody adds to it.
  await ctx.documents.get('ask.chat', chat)
  return chat
}

/** Save the question with its answer, in its chat. */
async function storeChat(ctx: ActionContext, chat: string, question: string, answer: Reply) {
  await ctx.documents.create('ask.question', { chat, question, answer: answer.text, answer_kind: answer.kind })
}

export const actions = {
  // The platform runs an action in one transaction: the chat, the question and its
  // answer are saved together, or not at all. So every save is awaited before returning.
  async ask(ctx: ActionContext) {
    const question = questionFrom(ctx)
    const chat = await chatFor(ctx, question)
    const answer = reply(question)
    await storeChat(ctx, chat, question, answer)
    return { chat, answer }
  },
}

export const reads = {
  // Outbound: the platform runs it after its transaction has closed, so the model's slow
  // thinking holds no database connection. It saves nothing; the ask action does (step 2.2).
  async think(ctx: ReadContext): Promise<Reply> {
    const question = questionFrom(ctx)
    if (!ctx.featherbaseMcp) return { kind: 'cannot', text: "Ask can't look at your data from here." }
    return answer(question, standIn, ctx.featherbaseMcp)
  },
}
