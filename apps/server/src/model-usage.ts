// What the language model has used this month, and the allowance it is held
// to. Each call's tokens are kept as the provider reported them
// (model_usage). ANALYST_MONTHLY_TOKENS sets a month's allowance: the server
// log is warned at 80% of it, and at 100% every question in words is refused
// until the calendar month (the database's clock) ends. It then opens again
// by itself: nothing is switched off that a person must switch back on.
import { sql } from './db'
import { AppError } from './errors'
import { readVariable } from './env'

/** The share of the allowance at which the server log is warned. */
export const WARN_AT = 0.8

/** The month's allowance in tokens, or undefined when the instance sets none. */
export function monthlyAllowance(): number | undefined {
  const set = Number(readVariable('ANALYST_MONTHLY_TOKENS')?.trim())
  return Number.isFinite(set) && set >= 1 ? Math.floor(set) : undefined
}

/** The tokens used since the month began. */
export async function usedThisMonth(): Promise<number> {
  const [row] = await sql<{ used: string }[]>`
    select coalesce(sum(input_tokens + output_tokens), 0) as used from model_usage where at >= date_trunc('month', now())`
  return Number(row.used)
}

/** The first day of next month, as a person says it: "1 December". */
export function reopens(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** Refuses once the month's allowance is used. With no allowance set it asks the database nothing. */
export async function assertAllowance(): Promise<void> {
  const allowance = monthlyAllowance()
  if (allowance !== undefined && await usedThisMonth() >= allowance)
    throw new AppError('RateLimitError', `This month's allowance for questions in words is used up. It opens again on ${reopens()}.`)
}

/** Keeps what one call used. A failure here is logged and never fails the answer the call was for. */
export async function recordUsage(model: string, input: number, output: number): Promise<void> {
  try {
    const allowance = monthlyAllowance()
    const before = allowance === undefined ? 0 : await usedThisMonth()
    await sql`insert into model_usage (model, input_tokens, output_tokens) values (${model}, ${input}, ${output})`
    if (allowance === undefined) return
    const after = before + input + output
    if (before < allowance && after >= allowance) console.warn(`[analyst] this month's allowance of ${allowance} tokens is used up: questions in words are refused until ${reopens()}`)
    else if (before < allowance * WARN_AT && after >= allowance * WARN_AT) console.warn(`[analyst] 80% of this month's allowance of ${allowance} tokens is used`)
  } catch (error) {
    console.warn(`[analyst] usage was not recorded: ${(error as Error).message}`)
  }
}

/** The month so far, for the person who runs the instance. */
export async function usageReport() {
  const allowance = monthlyAllowance()
  const [row] = await sql<{ used: string; calls: number }[]>`
    select coalesce(sum(input_tokens + output_tokens), 0) as used, count(*)::int as calls from model_usage where at >= date_trunc('month', now())`
  const used = Number(row.used)
  return { used, calls: row.calls, allowance: allowance ?? null, reopens: reopens(),
    state: allowance === undefined ? 'no allowance' : used >= allowance ? 'stopped' : used >= allowance * WARN_AT ? 'warning' : 'open' }
}
