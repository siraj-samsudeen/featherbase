// Feather Ask's server entry. The platform loads this file (built to dist/server.mjs)
// and calls reads.ask for POST /api/app_reads/ask/ask.
import { MAX_QUESTION_LENGTH } from '../shared/reply'
import { reply } from './reply'

// Only what this app uses of the platform's read context: apps never import platform code.
interface ReadContext {
  user: string
  payload: unknown
  reject(message: string): never
}

// Must equal featherbase.json's platformVersion, or the platform won't load the app.
export const platformVersion = '2026-10'

/** The question from the page's payload: a non-empty string of reasonable length. */
function questionFrom(ctx: ReadContext): string {
  const question = (ctx.payload as { question?: unknown } | null)?.question
  if (typeof question !== 'string' || !question.trim()) ctx.reject('Type a question first')
  if (question.length > MAX_QUESTION_LENGTH) ctx.reject(`Keep the question under ${MAX_QUESTION_LENGTH} characters`)
  return question.trim()
}

export const reads = {
  async ask(ctx: ReadContext) {
    return { answer: reply(questionFrom(ctx)) }
  },
}