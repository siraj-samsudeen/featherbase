// The questions a person has asked of an app's figures. They are kept on the
// platform, not on the asker's page, so a follow-up carries on from them on
// any device. A row holds the question and what it became: the SQL (or the
// plan) that answered it, the question it was asked back, or why it was refused. It
// never holds a figure, so a follow-up is always answered afresh, for the
// asker's places as they are then.
import { sql } from './db'
import { MAX_HISTORY, type Turn } from './semantic-question'

/** How long a conversation stays open: after a day "this month so far" has moved on. */
export const CONVERSATION_HOURS = 24

/** What a question became. */
export type Outcome = { model: string; sql: string } | { model: string; plan: unknown } | { clarify: string } | { refused: string }

/** Records a question the person asked of the app, and what it became. */
export async function recordQuestion(app: string, asker: string, question: string, outcome: Outcome): Promise<void> {
  const plan = 'plan' in outcome ? sql.json(outcome.plan as never) : null
  await sql`insert into app_question (app, asker, question, model, sql, plan, clarify, refused)
    values (${app}, ${asker}, ${question}, ${'model' in outcome ? outcome.model : null}, ${'sql' in outcome ? outcome.sql : null}, ${plan},
      ${'clarify' in outcome ? outcome.clarify : null}, ${'refused' in outcome ? outcome.refused : null})`
}

/**
 * The asker's open conversation with the app, oldest first: the latest turns
 * of the last day that were answered or asked back, since they last started
 * over. A refused question is no turn: there is nothing to follow up.
 */
export async function openTurns(app: string, asker: string): Promise<Turn[]> {
  const rows = await sql<{ question: string; model: string | null; sql: string | null; plan: unknown; clarify: string | null }[]>`
    select question, model, sql, plan, clarify from app_question
    where app = ${app} and asker = ${asker} and closed_at is null and refused is null
      and asked_at > now() - make_interval(hours => ${CONVERSATION_HOURS})
    order by asked_at desc, id desc limit ${MAX_HISTORY}`
  return rows.reverse().map(row => row.clarify !== null ? { question: row.question, clarify: row.clarify }
    : row.sql !== null ? { question: row.question, model: row.model!, sql: row.sql } : { question: row.question, model: row.model!, plan: row.plan })
}

/** The asker starts over: their questions are kept, and no longer brought to a follow-up. */
export async function closeTurns(app: string, asker: string): Promise<void> {
  await sql`update app_question set closed_at = now() where app = ${app} and asker = ${asker} and closed_at is null`
}
