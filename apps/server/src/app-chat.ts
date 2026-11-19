// An app's chat panel: a person's conversations, and the answer to each thing
// they say in the mode they chose (chat-declaration.ts). This is where a
// message is routed: to SQL over the person's own rows (agent), to a plan
// drawn as a report (reports), to the help (ask), or to a request sent for a
// person to review (action). A mode is used only by a person who holds one of its roles, held
// directly or through a binding, and never by standing: an administrator gets
// a mode by being given its role like anyone else.
//
// Conversations are kept on the platform (chat_session, chat_message), each
// answer as it was shown, and are read back only by their owner.
import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { readVariable } from './env'
import { getRoles } from './permissions'
import { CHAT_MODES, type ChatMode } from './chat-declaration'
import { answerRequest, decideRequest, ownRequests, requestsToReview, type RequestReply } from './chat-requests'
import { answerHelp } from './help'
import { planModel } from './plan-model'
import { askPackageQuestion, packageChat, packageDimensionValues } from './runtime-packages'
import { MAX_HISTORY, MAX_QUESTION_LENGTH, type Turn } from './semantic-question'

/** What a mode is called on the panel. */
const LABELS: Record<ChatMode, string> = { agent: 'Agent', reports: 'Reports', ask: 'Ask', action: 'Action' }
/** How many of a session's messages are read back at once, the latest ones. */
export const MAX_MESSAGES = 200
/** How many rows of an answer the language model is shown to write about. */
export const WRITTEN_ROWS = 40
const MAX_TITLE = 60
/** The most messages one person sends to the chats in 24 hours, unless CHAT_DAILY_MESSAGES says otherwise. */
export const DEFAULT_DAILY_MESSAGES = 200

interface Table { columns: { name: string }[]; rows: unknown[][]; truncated?: boolean }
/** What was answered, as the panel draws it. */
export type Reply =
  | { kind: 'figures'; question: string; model: string; sql: string; text?: string; result: Table }
  | { kind: 'report'; question: string; model: string; plan: unknown; result: Table }
  | { kind: 'help'; text: string; sources: { source: string; heading: string }[] }
  | { kind: 'clarify'; question: string; text: string }
  | { kind: 'refused'; text: string }
  | RequestReply

function declared(app: string) {
  const chat = packageChat(app)
  if (!chat) throw new AppError('NotFoundError', `${app} has no chat`)
  return chat
}

/** The modes of the app's chat this person may use, in the panel's order. */
export async function chatModes(app: string, user: string) {
  const chat = declared(app)
  const held = new Set(await getRoles(user))
  const modes = CHAT_MODES.filter(mode => chat.modes[mode]?.roles.some(role => held.has(role))).map(mode => ({ mode, label: LABELS[mode] }))
  return { title: chat.title, modes,
    // Whether this person reviews what others send, and, for one who may send, what can be sent.
    review: Boolean(chat.modes.action?.reviewers.some(role => held.has(role))),
    ...(modes.some(({ mode }) => mode === 'action')
      ? { requests: chat.modes.action!.requests.map(({ name, title, description }) => ({ name, title, description })) } : {}) }
}

/** The person's own requests to the app and, for a reviewer, the requests of others that are waiting. */
export async function chatRequests(app: string, user: string) {
  const { review } = await chatModes(app, user)
  return { mine: await ownRequests(app, user), ...(review ? { review: await requestsToReview(app, user) } : {}) }
}

/** A reviewer approves or rejects a request that is waiting; what is left to review comes back. */
export async function decideChatRequest(app: string, id: unknown, input: unknown, user: string) {
  if (!(await chatModes(app, user)).review) throw new AppError('PermissionError', 'You do not review the requests of this chat')
  await decideRequest(app, id, input, user)
  return chatRequests(app, user)
}

const sessionRow = (row: { id: string | number; title: string; updated_at: Date }) => ({ id: Number(row.id), title: row.title, updated_at: row.updated_at.toISOString() })

/** The person's conversations with the app, the latest first. */
export async function chatSessions(app: string, user: string) {
  declared(app)
  const rows = await sql<{ id: string; title: string; updated_at: Date }[]>`
    select id, title, updated_at from chat_session where app = ${app} and owner = ${user} and closed_at is null order by updated_at desc, id desc limit 100`
  return { sessions: rows.map(sessionRow) }
}

// A conversation of this person's with this app, still open. Another person's, or one that is not there, is not found.
async function ownSession(app: string, id: unknown, user: string) {
  const number = typeof id === 'string' && /^\d{1,15}$/.test(id) ? Number(id) : id
  const [row] = Number.isSafeInteger(number) ? await sql<{ id: string; title: string; updated_at: Date }[]>`
    select id, title, updated_at from chat_session where id = ${number as number} and app = ${app} and owner = ${user} and closed_at is null` : []
  if (!row) throw new AppError('NotFoundError', 'That conversation was not found')
  return sessionRow(row)
}

const messageRow = (row: { id: string | number; role: string; mode: string; content: unknown; created_at: Date }) =>
  ({ id: Number(row.id), role: row.role, mode: row.mode, content: row.content, at: row.created_at.toISOString() })

/** One conversation, with its messages, oldest first. */
export async function chatSession(app: string, id: unknown, user: string) {
  declared(app)
  const session = await ownSession(app, id, user)
  const rows = await sql<{ id: string; role: string; mode: string; content: unknown; created_at: Date }[]>`
    select id, role, mode, content, created_at from chat_message where session = ${session.id} order by id desc limit ${MAX_MESSAGES}`
  return { session, messages: rows.reverse().map(messageRow) }
}

/** Removes a conversation from the person's list. It is kept, and no longer read back. */
export async function closeChatSession(app: string, id: unknown, user: string) {
  declared(app)
  const session = await ownSession(app, id, user)
  await sql`update chat_session set closed_at = now() where id = ${session.id}`
  return chatSessions(app, user)
}

const sent = z.object({ payload: z.object({
  mode: z.enum(CHAT_MODES), text: z.string().trim().min(1).max(MAX_QUESTION_LENGTH), session: z.number().int().positive().optional(),
}).strict() }).strict()

// The earlier questions about figures in this conversation, each with what answered it, so "and by section?" follows on.
async function earlierTurns(session: number): Promise<Turn[]> {
  const rows = await sql<{ content: Reply }[]>`
    select content from chat_message where session = ${session} and role = 'assistant' and mode in ('agent', 'reports')
      and content->>'kind' in ('figures', 'report', 'clarify') order by id desc limit ${MAX_HISTORY}`
  return rows.reverse().map(({ content }): Turn => content.kind === 'figures' ? { question: content.question, model: content.model, sql: content.sql }
    : content.kind === 'report' ? { question: content.question, model: content.model, plan: content.plan }
      : { question: (content as { question: string }).question, clarify: (content as { text: string }).text })
}

const cellText = (value: unknown) => value === null || value === undefined ? '' : String(value)

/**
 * A short answer in words, written by the language model from the answer's
 * own table. This is the one place a person's figures are sent to the
 * language model: the rows of this answer, which are theirs to see, and no
 * others. CHAT_WRITTEN_ANSWERS=off leaves the table to speak for itself. A
 * failure here is not a failure of the answer: the table is still shown.
 */
export async function writtenAnswer(question: string, result: Table): Promise<string | undefined> {
  if (readVariable('CHAT_WRITTEN_ANSWERS')?.trim().toLowerCase() === 'off' || !result.rows.length) return undefined
  const shown = result.rows.slice(0, WRITTEN_ROWS)
  const more = result.rows.length > shown.length || result.truncated
  try {
    const text = await planModel().complete({
      system: [
        'You answer a store manager\'s question in two or three plain sentences, from the table you are given and nothing else.',
        'Amounts of money are Indian rupees: write them with ₹ and Indian digit grouping (₹19,62,013), without paise unless under ₹100.',
        'Say the most useful thing first. Never state a figure that is not in the table, and do not guess at causes.',
        'An empty cell means there is no figure: say so if it matters, never call it zero.',
        'Plain text only: no headings, lists, bold or tables.',
      ].join('\n'),
      question: [`Question: ${question}`, '', result.columns.map(column => column.name).join(' | '), ...shown.map(row => row.map(cellText).join(' | ')),
        ...(more ? ['(more rows not shown)'] : [])].join('\n'),
    })
    return text.trim().slice(0, 1200) || undefined
  } catch (error) {
    console.warn(`[chat] no written answer: ${(error as Error).message}`)
    return undefined
  }
}

// The answer to one message in its mode. A question that cannot be answered is a reply that says why, not a failure.
async function answer(app: string, mode: ChatMode, text: string, session: number, user: string): Promise<Reply> {
  const chat = declared(app)
  try {
    if (mode === 'action')
      return await answerRequest({ app, action: chat.modes.action!, text, session, user, language: planModel, names: model => packageDimensionValues(app, model, user) })
    if (mode === 'ask') {
      const help = await answerHelp({ payload: { question: text } })
      return { kind: 'help', text: help.answer, sources: help.sources }
    }
    const asked = await askPackageQuestion(app, chat.modes[mode]!.model, { payload: { question: text } }, user,
      { paths: [mode === 'agent' ? 'sql' : 'plan'], history: await earlierTurns(session), record: false }) as unknown as
      { question: string; clarify?: string; model?: string; sql?: string; plan?: unknown; result?: Table | null }
    if (asked.clarify) return { kind: 'clarify', question: asked.question, text: asked.clarify }
    if (!asked.result) return { kind: 'refused', text: 'The figures are being prepared. Try again in a few minutes.' }
    if (mode === 'reports') return { kind: 'report', question: asked.question, model: asked.model!, plan: asked.plan, result: asked.result }
    const written = await writtenAnswer(asked.question, asked.result)
    return { kind: 'figures', question: asked.question, model: asked.model!, sql: asked.sql!, ...(written ? { text: written } : {}), result: asked.result }
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    return { kind: 'refused', text: error.message }
  }
}

/**
 * Takes what the person said in a mode, answers it, and keeps both in the
 * conversation (a new one when none is named). Refused outright when the
 * person does not hold the mode.
 */
export async function sendChat(app: string, input: unknown, user: string) {
  const parsed = sent.safeParse(input)
  if (!parsed.success)
    throw new AppError('ValidationError', `Expected { payload: { mode, text, session? } }: a mode of ${CHAT_MODES.join(', ')} and 1 to ${MAX_QUESTION_LENGTH} characters of text`)
  const { mode, text, session: named } = parsed.data.payload
  if (!(await chatModes(app, user)).modes.some(allowed => allowed.mode === mode))
    throw new AppError('PermissionError', `You do not have the ${LABELS[mode]} mode of this chat`)
  // A person's messages of the last 24 hours, across their conversations: a limit on what one person can spend.
  const set = readVariable('CHAT_DAILY_MESSAGES')?.trim()
  const daily = set === undefined || set === '' || !Number.isFinite(Number(set)) ? DEFAULT_DAILY_MESSAGES : Math.floor(Number(set))
  if (daily >= 1) {
    const [{ said: today }] = await sql<{ said: number }[]>`
      select count(*)::int as said from chat_message m join chat_session s on s.id = m.session
      where s.owner = ${user} and m.role = 'user' and m.created_at > now() - interval '24 hours'`
    if (today >= daily) throw new AppError('RateLimitError', `You have sent ${daily} messages in the last 24 hours, the most one person may. Try again later.`)
  }
  const session = named === undefined
    ? sessionRow((await sql<{ id: string; title: string; updated_at: Date }[]>`
        insert into chat_session (app, owner, title) values (${app}, ${user}, ${text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text})
        returning id, title, updated_at`)[0])
    : await ownSession(app, named, user)
  const keep = async (role: 'user' | 'assistant', content: unknown) => messageRow((await sql<{ id: string; role: string; mode: string; content: unknown; created_at: Date }[]>`
    insert into chat_message (session, role, mode, content) values (${session.id}, ${role}, ${mode}, ${sql.json(content as never)})
    returning id, role, mode, content, created_at`)[0])
  const said = await keep('user', { text })
  const replied = await keep('assistant', await answer(app, mode, text, session.id, user))
  // The time on the clock, not the transaction's start: the conversation last added to is listed first.
  const [touched] = await sql<{ id: string; title: string; updated_at: Date }[]>`
    update chat_session set updated_at = clock_timestamp() where id = ${session.id} returning id, title, updated_at`
  return { session: sessionRow(touched), messages: [said, replied] }
}
