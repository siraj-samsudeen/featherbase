// Feather Ask's server entry. The platform loads this file (built to dist/server.mjs)
// and calls actions.ask for POST /api/app_actions/ask/ask, reads.think for POST /api/app_reads/ask/think.
import { MAX_ANSWER_LENGTH, MAX_QUESTION_LENGTH, MAX_STEPS_LENGTH, type Reply, type Step, type Thought } from '../shared/reply'
import { answer, MAX_STEPS, SUMMARY_LENGTH, type McpTools } from './agent'
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

/** The answer think gave, which the page passes on as { kind, text }. Not signed (task 2.4
 *  decides): a person could save any answer, but only to their own chat. */
function answerFrom(ctx: Asked): Reply {
  const given = (ctx.payload as { answer?: { kind?: unknown; text?: unknown } } | null)?.answer
  if (given?.kind !== 'answer' && given?.kind !== 'cannot') ctx.reject('Ask has no answer to save')
  if (typeof given.text !== 'string' || !given.text.trim()) ctx.reject('Ask has no answer to save')
  if (given.text.length > MAX_ANSWER_LENGTH) ctx.reject(`Keep the answer under ${MAX_ANSWER_LENGTH} characters`)
  return { kind: given.kind, text: given.text }
}

/** The steps behind the answer, which the page passes on from think: at most MAX_STEPS, each a
 *  tool, its arguments and a short summary. Unsigned, like the answer. */
function stepsFrom(ctx: Asked): Step[] {
  const steps = (ctx.payload as { steps?: unknown } | null)?.steps
  if (!Array.isArray(steps) || steps.length > MAX_STEPS) ctx.reject('Ask has no steps to save')
  if (JSON.stringify(steps).length > MAX_STEPS_LENGTH) ctx.reject('The steps behind this answer are too long to save')
  return steps.map((given: Partial<Step> | null) => {
    const { tool, args, summary, refused } = given ?? {}
    const isArgs = typeof args === 'object' && args !== null && !Array.isArray(args)
    if (typeof tool !== 'string' || !isArgs || typeof summary !== 'string' || summary.length > SUMMARY_LENGTH)
      ctx.reject('Ask has no steps to save')
    return refused === true ? { tool, args, summary, refused } : { tool, args, summary }
  })
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

/** Save the question with its answer and the steps behind it, in its chat. */
async function storeChat(ctx: ActionContext, chat: string, question: string, { answer, steps }: Thought) {
  await ctx.documents.create('ask.question', { chat, question, answer: answer.text, answer_kind: answer.kind, steps })
}

export const actions = {
  // Saves the question with the answer think gave and the steps behind it. The platform runs
  // an action in one transaction: the chat, the question and its answer are saved together,
  // or not at all. So every save is awaited before returning.
  async ask(ctx: ActionContext) {
    const question = questionFrom(ctx)
    const thought = { answer: answerFrom(ctx), steps: stepsFrom(ctx) }
    const chat = await chatFor(ctx, question)
    await storeChat(ctx, chat, question, thought)
    return { chat, ...thought }
  },
}

export const reads = {
  // Outbound: the platform runs it after its transaction has closed, so the model's slow
  // thinking holds no database connection. It saves nothing: the page passes its answer and
  // steps to the ask action.
  async think(ctx: ReadContext): Promise<Thought> {
    const question = questionFrom(ctx)
    if (!ctx.featherbaseMcp) return { answer: { kind: 'cannot', text: "Ask can't look at your data from here." }, steps: [] }
    return answer(question, standIn, ctx.featherbaseMcp)
  },
}
