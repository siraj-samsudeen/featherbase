// The Action mode of an app's chat: a request a person sends for another
// person to review (chat-declaration.ts declares which). The chat never
// carries anything out and never decides anything. It works out which request
// the person means and what they have said about it, asks for what is
// missing, shows what it would send, and sends it only once the person has
// said yes. A reviewer then approves or rejects it, never their own.
//
// The language model is given the names of the requests and the person's own
// names for a dimension (their stores, their subcategories), never a figure.
// What it returns is checked here: an input that names a dimension must be
// one of the person's own names, so a request is only ever about something
// its sender can see.
import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { logActivity } from './audit'
import type { ActionDeclaration, RequestDeclaration } from './chat-declaration'
import { MAX_HISTORY, type PlanModel } from './semantic-question'

/** The most requests one conversation sends; a person who needs more starts another. */
export const MAX_REQUESTS_PER_CONVERSATION = 3
/** The longest an input may be. */
export const MAX_INPUT_LENGTH = 300
const LISTED = 50

export interface RequestInput { name: string; label: string; value: string }
/** A request as it is listed. */
export interface ListedRequest {
  id: number; ticket: string; title: string; inputs: RequestInput[]; status: 'pending_review' | 'approved' | 'rejected'; at: string
  decided_at?: string; note?: string; requester?: string
}
/** What the Action mode answers with. */
export type RequestReply =
  | { kind: 'confirm'; question: string; request: string; title: string; inputs: RequestInput[]; text: string }
  | { kind: 'submitted'; question: string; ticket: string; text: string }
  | { kind: 'cancelled'; question: string; text: string }
  | { kind: 'requests'; question: string; text: string; requests: ListedRequest[] }
  | { kind: 'clarify'; question: string; text: string; given?: { request: string; inputs: Record<string, string> } }
  | { kind: 'refused'; text: string }

// A whole message that says yes, or no, to what was just shown. Anything longer is a new instruction.
const YES = /^(yes|y|yep|yeah|ok|okay|confirm|confirmed|send|send it|go ahead|please do|do it)[\s,.!]*(please|send it|go ahead|thanks|thank you)?[\s.!]*$/i
const NO = /^(no|n|nope|cancel|stop|don'?t|do not)[\s,.!]*(cancel|thanks|thank you|don'?t send( it)?)?[\s.!]*$/i

const COULD_NOT = 'I could not work out what you want done. Try saying it another way.'

/** What the language model is told: the requests that can be sent, each with its inputs and the person's own names for them. */
export function requestsPrompt(requests: readonly RequestDeclaration[], names: Record<string, Record<string, string[]>> = {}): string {
  return [
    'You help a person at work send a request for another person to review. You never carry anything out yourself, and you never decide a request.',
    'Reply with one JSON object and nothing else, in one of these forms:',
    '{"request": "<name>", "inputs": {"<input>": "<value>"}} when the person wants one of the requests below. Give every input they have stated, here or earlier in the conversation, in their own words, and leave out any they have not stated. Never invent a value.',
    '{"list": true} when they ask about requests they have already sent.',
    '{"clarify": "<one short question>"} when it is unclear which request they want.',
    '{"cannot": "<one sentence>"} when what they want is none of these.',
    '',
    'The requests:',
    ...requests.flatMap(request => [
      `- ${request.name}: ${request.title}. ${request.description}`,
      ...request.inputs.map((input) => {
        const known = names[request.name]?.[input.name]
        return `    ${input.name}${input.optional ? ' (optional)' : ''}: ${input.description}${known?.length ? `. One of: ${known.join(' | ')}` : ''}`
      }),
    ]),
  ].join('\n')
}

const reply = z.union([
  z.object({ request: z.string().min(1), inputs: z.record(z.string(), z.unknown()).optional() }),
  z.object({ list: z.literal(true) }),
  z.object({ clarify: z.string().trim().min(1).max(MAX_INPUT_LENGTH) }),
  z.object({ cannot: z.string().trim().min(1).max(MAX_INPUT_LENGTH) }),
])

/** Reads the language model's reply. One that is none of the forms it was given is refused, not guessed at. */
export function readRequestReply(text: string): z.infer<typeof reply> {
  let parsed: z.infer<typeof reply> | undefined
  try { parsed = reply.parse(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))) } catch { parsed = undefined }
  if (!parsed) throw new AppError('ValidationError', COULD_NOT)
  return parsed
}

type Row = { id: string; prefix: string; title: string; inputs: RequestInput[]; status: ListedRequest['status']; created_at: Date; decided_at: Date | null; note: string | null; requester_name?: string | null }
const listed = (row: Row): ListedRequest => ({
  id: Number(row.id), ticket: `${row.prefix}-${row.id}`, title: row.title, inputs: row.inputs, status: row.status, at: row.created_at.toISOString(),
  ...(row.decided_at ? { decided_at: row.decided_at.toISOString(), note: row.note ?? '' } : {}),
  ...(row.requester_name ? { requester: row.requester_name } : {}),
})

/** The person's own requests to the app, the latest first. */
export async function ownRequests(app: string, user: string): Promise<ListedRequest[]> {
  return (await sql<Row[]>`
    select id, prefix, title, inputs, status, created_at, decided_at, note from chat_request
    where app = ${app} and requester = ${user} order by id desc limit ${LISTED}`).map(listed)
}

/** The requests waiting for a reviewer, the oldest first: everyone's but the reviewer's own. */
export async function requestsToReview(app: string, user: string): Promise<ListedRequest[]> {
  return (await sql<Row[]>`
    select r.id, r.prefix, r.title, r.inputs, r.status, r.created_at, r.decided_at, r.note,
      coalesce((select nullif(p.full_name, '') from person p where p.row_id = r.requester), r.requester) as requester_name
    from chat_request r where r.app = ${app} and r.status = 'pending_review' and r.requester <> ${user} order by r.id limit ${LISTED}`).map(listed)
}

const decision = z.object({ payload: z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(MAX_INPUT_LENGTH).optional() }).strict() }).strict()

/** A reviewer's decision on a request that is waiting. It is recorded with who made it; nothing else is changed by it. */
export async function decideRequest(app: string, id: unknown, input: unknown, user: string): Promise<void> {
  const parsed = decision.safeParse(input)
  if (!parsed.success) throw new AppError('ValidationError', `Expected { payload: { decision, note? } }: a decision of approved or rejected, and a note of at most ${MAX_INPUT_LENGTH} characters`)
  const number = typeof id === 'string' && /^\d{1,15}$/.test(id) ? Number(id) : Number.NaN
  const [found] = Number.isSafeInteger(number) ? await sql<{ id: string; requester: string; prefix: string; title: string }[]>`
    select id, requester, prefix, title from chat_request where id = ${number} and app = ${app}` : []
  if (!found) throw new AppError('NotFoundError', 'That request was not found')
  if (found.requester === user) throw new AppError('PermissionError', 'A request is reviewed by someone other than the person who sent it')
  const { decision: decided, note } = parsed.data.payload
  const [done] = await sql`
    update chat_request set status = ${decided}, decided_by = ${user}, decided_at = now(), note = ${note || null}
    where id = ${number} and status = 'pending_review' returning id`
  if (!done) throw new AppError('ConflictError', 'That request has already been decided')
  await logActivity(user, `${decided === 'approved' ? 'Approved' : 'Rejected'} request ${found.prefix}-${found.id} (${found.title}) of ${app}`)
}

// What the conversation last answered, in any mode.
async function lastReply(session: number): Promise<RequestReply | undefined> {
  const [row] = await sql<{ content: RequestReply }[]>`select content from chat_message where session = ${session} and role = 'assistant' order by id desc limit 1`
  return row?.content
}

// The turns of the request now being put together: those since the last one sent or cancelled.
async function earlier(session: number): Promise<{ question: string; reply: string }[]> {
  const rows = await sql<{ content: Extract<RequestReply, { kind: 'confirm' | 'clarify' }> }[]>`
    select content from chat_message where session = ${session} and role = 'assistant' and mode = 'action' and content->>'kind' in ('confirm', 'clarify')
      and id > coalesce((select max(id) from chat_message where session = ${session} and role = 'assistant' and mode = 'action'
        and content->>'kind' in ('submitted', 'cancelled')), 0)
    order by id desc limit ${MAX_HISTORY}`
  return rows.reverse().map(({ content }) => ({ question: content.question, reply: JSON.stringify(
    content.kind === 'confirm' ? { request: content.request, inputs: Object.fromEntries(content.inputs.map(input => [input.name, input.value])) }
      // Kept as jsonb, whose keys come back in its own order: the form is rebuilt in the order the language model was shown.
      : content.given ? { request: content.given.request, inputs: content.given.inputs } : { clarify: content.text }) }))
}

/**
 * Answers what a person said in the Action mode. `names` gives the person's
 * own names for the dimensions of a model, as that model's read allows them.
 */
export async function answerRequest(asked: {
  app: string; action: ActionDeclaration; text: string; session: number; user: string
  language: () => PlanModel; names: (model: string) => Promise<Record<string, string[]>>
}): Promise<RequestReply> {
  const { app, action, text: question, session, user } = asked
  const [{ sent }] = await sql<{ sent: number }[]>`select count(*)::int as sent from chat_request where session = ${session}`
  if (sent >= MAX_REQUESTS_PER_CONVERSATION)
    return { kind: 'refused', text: `This conversation has sent ${MAX_REQUESTS_PER_CONVERSATION} requests, the most one conversation sends. Start a new conversation for another.` }
  const shown = await lastReply(session)
  if (shown?.kind === 'confirm') {
    if (NO.test(question)) return { kind: 'cancelled', question, text: 'Nothing was sent.' }
    if (YES.test(question)) {
      const request = action.requests.find(candidate => candidate.name === shown.request)
      if (!request) return { kind: 'refused', text: 'That request can no longer be sent from this chat.' }
      const [row] = await sql<{ id: string }[]>`
        insert into chat_request (app, request, prefix, title, requester, session, inputs)
        values (${app}, ${request.name}, ${request.ticket}, ${request.title}, ${user}, ${session}, ${sql.json(shown.inputs as never)}) returning id`
      const ticket = `${request.ticket}-${row.id}`
      await logActivity(user, `Sent request ${ticket} (${request.title}) through the chat of ${app}`)
      return { kind: 'submitted', question, ticket, text: `Request ${ticket} has been sent. A person will review it, and nothing changes until they decide. Ask about “my requests” here to see where it stands.` }
    }
  }
  // The person's own names for each input that names a dimension, read once per model.
  const byModel = new Map<string, Record<string, string[]>>()
  const names: Record<string, Record<string, string[]>> = {}
  for (const request of action.requests) {
    names[request.name] = {}
    for (const input of request.inputs) {
      if (!input.dimension) continue
      if (!byModel.has(request.model!)) byModel.set(request.model!, await asked.names(request.model!))
      names[request.name][input.name] = byModel.get(request.model!)![input.dimension] ?? []
    }
  }
  const got = readRequestReply(await asked.language().complete({ system: requestsPrompt(action.requests, names), question, history: await earlier(session) }))
  if ('cannot' in got) return { kind: 'refused', text: got.cannot }
  if ('clarify' in got) return { kind: 'clarify', question, text: got.clarify }
  if ('list' in got) {
    const requests = await ownRequests(app, user)
    return { kind: 'requests', question, text: requests.length ? 'Your requests, the latest first:' : 'You have not sent any requests yet.', requests }
  }
  const request = action.requests.find(candidate => candidate.name === got.request)
  if (!request) throw new AppError('ValidationError', COULD_NOT)
  const inputs: RequestInput[] = []
  const missing: string[] = []
  for (const input of request.inputs) {
    const stated = got.inputs?.[input.name]
    let value = typeof stated === 'string' ? stated.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT_LENGTH) : ''
    if (input.dimension) {
      const known = names[request.name][input.name]
      // A person with one store need not name it.
      if (!value && known.length === 1) value = known[0]
      else if (value) {
        const match = known.find(name => name.trim().toLowerCase() === value.toLowerCase())
        if (!match) return { kind: 'clarify', question, text: `“${value}” is not one of the ${input.label.toLowerCase()} names you can see. Which ${input.label.toLowerCase()} do you mean?` }
        value = match
      }
    }
    if (value) inputs.push({ name: input.name, label: input.label, value })
    else if (!input.optional) missing.push(`the ${input.label.toLowerCase()} (${input.description})`)
  }
  if (missing.length)
    return { kind: 'clarify', question, text: `To send a ${request.title.toLowerCase()} request I still need ${missing.join(', and ')}.`,
      given: { request: request.name, inputs: Object.fromEntries(inputs.map(input => [input.name, input.value])) } }
  return { kind: 'confirm', question, request: request.name, title: request.title, inputs, text: 'Nothing has been sent yet. Shall I send this for a person to review?' }
}
