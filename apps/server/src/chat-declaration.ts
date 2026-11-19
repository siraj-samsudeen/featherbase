// An app's chat panel, declared in its manifest: the ways a person may talk to
// it, and the app roles that open each. A mode is opened by a role like any
// other permission, so an administrator gives it to a person by giving them
// the role.
//
//   agent    a question about the app's figures, answered in the chat by SQL
//            the language model writes (semantic-sql.ts)
//   reports  a question about the app's figures, answered as a report on the
//            app's page from a plan (semantic-model.ts)
//   ask      a question about how things work, answered from the help (help.ts)
//   action   a request the person sends for another person to review, after
//            confirming it (chat-requests.ts). The mode declares the requests
//            that can be sent and the roles that review them.
import { z } from 'zod'
import type { SemanticDeclaration } from './semantic-model'

export const CHAT_MODES = ['agent', 'reports', 'ask', 'action'] as const
export type ChatMode = (typeof CHAT_MODES)[number]

const roles = z.array(z.string().min(1)).min(1)
const figures = z.object({ roles, /** The semantic model a question is first asked of. */ model: z.string().min(1) }).strict()
const plain = z.object({ roles }).strict()
const name = z.string().regex(/^[a-z][a-z0-9_]*$/).max(40)
const input = z.object({
  name,
  /** What the input is called when it is shown, such as "Store". */
  label: z.string().min(1).max(40),
  /** What the input is, in a few words, for the language model and for the person when it is missing. */
  description: z.string().min(1).max(200),
  /** A dimension of the request's model: the value must then be one of the person's own names for it. */
  dimension: z.string().min(1).optional(),
  optional: z.boolean().optional(),
}).strict()
const request = z.object({
  name,
  title: z.string().min(1).max(60),
  description: z.string().min(1).max(300),
  /** The letters a request's number starts with: TR gives TR-12. */
  ticket: z.string().regex(/^[A-Z]{2,4}$/),
  /** The semantic model whose dimensions the inputs name. */
  model: z.string().min(1).optional(),
  inputs: z.array(input).min(1).max(8),
}).strict()
const action = z.object({ roles, /** The app roles that approve or reject what is sent. */ reviewers: roles, requests: z.array(request).min(1).max(10) }).strict()
export type RequestDeclaration = z.infer<typeof request>
export type ActionDeclaration = z.infer<typeof action>

/** The manifest's `chat`. */
export const chatDeclaration = z.object({
  /** What the panel calls itself, such as "FeatherBot". */
  title: z.string().min(1).max(40),
  modes: z.object({ agent: figures.optional(), reports: figures.optional(), ask: plain.optional(), action: action.optional() }).strict()
    .refine(modes => Object.keys(modes).length > 0, 'A chat declares at least one mode'),
}).strict()
export type ChatDeclaration = z.infer<typeof chatDeclaration>

/** Checks an app's chat against the rest of its manifest. Throws an Error naming the first thing wrong. */
export function validateChat(chat: ChatDeclaration | undefined, declaredRoles: readonly string[] = [], semantic?: SemanticDeclaration): void {
  for (const mode of CHAT_MODES) {
    const declared = chat?.modes[mode]
    if (!declared) continue
    const stray = declared.roles.find(role => !declaredRoles.includes(role))
    if (stray) throw new Error(`Chat mode ${mode}: ${stray} is not one of the app's roles`)
    if ('model' in declared && !semantic?.models.some(model => model.name === declared.model))
      throw new Error(`Chat mode ${mode}: the app declares no semantic model named ${declared.model}`)
  }
  const sends = chat?.modes.action
  if (!sends) return
  const reviewer = sends.reviewers.find(role => !declaredRoles.includes(role))
  if (reviewer) throw new Error(`Chat mode action: ${reviewer} is not one of the app's roles`)
  for (const [index, request] of sends.requests.entries()) {
    const earlier = sends.requests.slice(0, index)
    if (earlier.some(other => other.name === request.name)) throw new Error(`Chat mode action: the request ${request.name} is declared twice`)
    if (earlier.some(other => other.ticket === request.ticket)) throw new Error(`Chat mode action: two requests are numbered ${request.ticket}`)
    const model = semantic?.models.find(candidate => candidate.name === request.model)
    if (request.model && !model) throw new Error(`Chat request ${request.name}: the app declares no semantic model named ${request.model}`)
    for (const [place, input] of request.inputs.entries()) {
      if (request.inputs.slice(0, place).some(other => other.name === input.name)) throw new Error(`Chat request ${request.name}: the input ${input.name} is declared twice`)
      if (input.dimension && !model?.dimensions.some(dimension => dimension.name === input.dimension))
        throw new Error(`Chat request ${request.name}: ${input.dimension} is not a dimension of ${request.model ?? 'a model (the request names none)'}`)
    }
  }
}
