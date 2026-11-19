// A question in words, turned into a plan for one semantic model by a
// language model. The language model sees the model's names and its verified
// questions, never the data, and it never writes SQL: what it returns is read
// as a plan and checked like any other (readPlan), so it can name nothing the
// model does not declare and can widen nobody's scope. It may be told the
// asker's own dimension values (store and subcategory names, never figures)
// so that it spells a filter the way the data does.
import { z } from 'zod'
import { AppError } from './errors'
import { MAX_PLAN_ROWS, measureHow, readPlan, type AnalysisPlan, type SemanticModel } from './semantic-model'

/** A language model that answers one question under a system prompt, after the earlier questions of the conversation and the reply each got. */
export interface PlanModel {
  complete(prompt: { system: string; question: string; history?: { question: string; reply: string }[] }): Promise<string>
}

export const MAX_QUESTION_LENGTH = 500
/** How many earlier questions a follow-up carries on from. */
export const MAX_HISTORY = 6

/** An earlier question of the conversation, with the SQL or the plan it was answered by (and the model that is for) or the question it was asked back. */
export interface Turn { question: string; sql?: string; plan?: unknown; model?: string; clarify?: string }
/** What a question becomes: a plan to run on the model named, or one question to ask the person first. */
export type PlanReply = { model: string; plan: AnalysisPlan } | { clarify: string }

const also = (synonyms: readonly string[] | undefined) => synonyms?.length ? ` Also called: ${synonyms.join(', ')}.` : ''
const said = (description: string | undefined) => description ? ` ${description.replace(/\.$/, '')}.` : ''

// A model's names: what a plan may choose from.
const names = (model: SemanticModel) => [
  'Dimensions, to group or filter by:',
  ...model.dimensions.map(d => `- ${d.name}.${said(d.description)}${also(d.synonyms)}`),
  '',
  'Measures, figures that add up:',
  ...model.measures.map(m => `- ${m.name}: ${measureHow(m)}.${said(m.description)}${also(m.synonyms)}`),
  ...(model.metrics?.length ? ['', 'Metrics, worked out from the measures:',
    ...model.metrics.map(m => `- ${m.name} = ${m.expression}${m.unit === 'percent' ? ' (a percentage)' : ''}.${said(m.description)}${also(m.synonyms)}`)] : []),
]

const SHAPE = [
  'A plan is JSON with these keys; only "measures" is required:',
  '- "measures": the measures and metrics to answer with, in the order to show them',
  '- "groupBy": dimensions to group by',
  '- "filters": [{"dimension": <dimension>, "in": [<exact values>]}]',
  '- "having": [{"measure": <a name from measures>, "is": "below", "above", "at_most" or "at_least", "value": <a number>}] keeps only the rows whose figure passes',
  '- "order": [[<a name from measures or groupBy>, "asc" or "desc"]]',
  `- "limit": the number of rows to keep, 1 to ${MAX_PLAN_ROWS}`,
  'Behind target or a shortfall is a negative gap, so "furthest behind" orders gap ascending and keeps only a gap below 0.',
  'In the same way "fallen" keeps only a change below 0, and "grew" only a change or growth above 0.',
  'The platform already limits every answer to what the asker may see, so "my store" or "my sections" needs no filter.',
]
const UNCLEAR = [
  'When the question could mean two different plans and no sensible default exists, do not guess: reply',
  '{"clarify": "<one short question to ask the person>"}.',
]

// The asker's own names, and the model's verified questions as examples.
function known(values: Record<string, string[]>): string[] {
  const entries = Object.entries(values)
  return entries.length ? ['', 'The values the asker may see, spelt as the data spells them. Filter only with these:',
    ...entries.map(([dimension, list]) => `- ${dimension}: ${list.join(' | ')}`)] : []
}
const examples = (model: SemanticModel, reply: (plan: AnalysisPlan) => unknown) => model.verified?.length
  ? ['', 'Examples:', ...model.verified.flatMap(({ question, plan }) => [`Q: ${question}`, `A: ${JSON.stringify(reply(plan))}`])] : []

/** The system prompt for one model: its names, the shape of a plan, and its verified questions as examples. */
export function planPrompt(model: SemanticModel, values: Record<string, string[]> = {}): string {
  return [
    `You turn a business question into a plan for the semantic model "${model.name}".${said(model.description)}`,
    'You never see the data, never write SQL and never answer with figures: you only choose names from the lists below.',
    '',
    ...names(model),
    '',
    ...SHAPE,
    '',
    'Reply with one JSON object and nothing else: {"plan": <plan>}, or, when these names cannot answer the question,',
    '{"cannot": "<one short sentence saying what is missing>"}.',
    ...UNCLEAR,
    'Earlier questions of this conversation come first, each with the reply it got. A follow-up such as "and by store?"',
    'or "only the top 3" changes the latest plan: reply with the whole new plan.',
    ...known(values),
    ...examples(model, plan => ({ plan })),
  ].join('\n')
}

/**
 * The system prompt for a question that any one of several models may answer:
 * each model's names, its asker's values and its examples, and a reply that
 * says which model the plan is for. One model alone gets its own prompt.
 */
export function modelsPrompt(models: readonly SemanticModel[], values: Record<string, Record<string, string[]>> = {}): string {
  if (models.length === 1) return planPrompt(models[0], values[models[0].name])
  return [
    `You turn a business question into a plan for one of these semantic models: ${models.map(model => `"${model.name}"`).join(', ')}.`,
    'You never see the data, never write SQL and never answer with figures: you only choose a model, and names from that model\'s lists.',
    'Choose the one model whose figures answer the question. A plan uses names from one model only.',
    ...models.flatMap(model => ['', `Model "${model.name}".${said(model.description)}`, ...names(model),
      ...known(values[model.name] ?? {}), ...examples(model, plan => ({ model: model.name, plan }))]),
    '',
    ...SHAPE,
    '',
    'Reply with one JSON object and nothing else: {"model": <the model\'s name>, "plan": <plan>}, or, when no model\'s names can answer the question,',
    '{"cannot": "<one short sentence saying what is missing>"}.',
    ...UNCLEAR,
    'Earlier questions of this conversation come first, each with the reply it got. A follow-up such as "and by store?"',
    'or "only the top 3" changes the latest plan: reply with the whole new plan and its model. A follow-up may need another model.',
  ].join('\n')
}

const sentence = z.string().trim().min(1).max(300)
const reply = z.union([z.object({ model: z.string().optional(), plan: z.unknown() }).strict(), z.object({ cannot: sentence }).strict(), z.object({ clarify: sentence }).strict()])

/**
 * Reads the language model's reply: a plan for one of these models, or a
 * question to ask the person first. A reply that names no model is for the
 * first. A reply that is neither, says it cannot answer, or names anything
 * its model lacks is refused in plain words; it is never repaired.
 */
export function readReply(models: readonly SemanticModel[], text: string): PlanReply {
  // A reply may wrap its JSON in a code fence or a sentence: take the outermost object.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let parsed: z.infer<typeof reply> | undefined
  try { parsed = reply.parse(JSON.parse(text.slice(start, end + 1))) } catch { parsed = undefined }
  const named = parsed && !('cannot' in parsed) && !('clarify' in parsed) ? parsed.model : undefined
  const model = named === undefined ? models[0] : models.find(candidate => candidate.name === named)
  if (!parsed || !model) throw new AppError('ValidationError', 'That question could not be turned into a plan. Try asking it another way.')
  if ('cannot' in parsed) throw new AppError('ValidationError', `That question cannot be answered from ${models.map(candidate => candidate.name).join(' or ')}: ${parsed.cannot}`)
  if ('clarify' in parsed) return { clarify: parsed.clarify }
  return { model: model.name, plan: readPlan(model, parsed.plan) }
}

const question = z.string().trim().min(1).max(MAX_QUESTION_LENGTH)

/** Reads a request's question, refusing an empty or overlong one. The earlier turns it follows are the platform's own record, never the request's. */
export function readAsk(input: unknown): { question: string } {
  const parsed = z.object({ payload: z.object({ question }).strict() }).strict().safeParse(input)
  if (!parsed.success)
    throw new AppError('ValidationError', `Expected { payload: { question } }, a question of 1 to ${MAX_QUESTION_LENGTH} characters`)
  return { question: parsed.data.payload.question }
}

/**
 * Turns a question into a checked plan for one of these models, or a question
 * to ask back. Earlier turns are the platform's record of the conversation;
 * each earlier plan is still checked against its model before the language
 * model is shown it, and a turn the app's models can no longer read (a model
 * or a name since removed) is left out: there is nothing in it to follow up.
 */
export async function questionToPlan(models: readonly SemanticModel[], asked: string, language: PlanModel,
  values: Record<string, Record<string, string[]>> = {}, history: readonly Turn[] = []): Promise<PlanReply> {
  const earlier = history.flatMap(({ question: was, plan, model: named, clarify }) => {
    if (clarify !== undefined) return [{ question: was, reply: JSON.stringify({ clarify }) }]
    const model = named === undefined ? models[0] : models.find(candidate => candidate.name === named)
    if (!model) return []
    try {
      const checked = readPlan(model, plan)
      return [{ question: was, reply: JSON.stringify(models.length > 1 ? { model: model.name, plan: checked } : { plan: checked }) }]
    } catch { return [] }
  })
  return readReply(models, await language.complete({ system: modelsPrompt(models, values), question: asked, ...(earlier.length ? { history: earlier } : {}) }))
}
