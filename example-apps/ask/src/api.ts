import { version } from '../package.json'

export class ApiError extends Error {}
let versions: Promise<Record<string, string>> | undefined
/** Each installed app's version, which every call into an app must name. */
const appVersions = () => (versions ??= fetch('/api/runtime_app_versions', { credentials: 'same-origin' }).then(r => r.json())
  .then((list: string[]) => Object.fromEntries(list.map(v => [v.split('@')[0], v]))).catch((): Record<string, string> => ({})))

async function call<T>(kind: 'app_reads' | 'app_actions', app: string, name: string, body: unknown): Promise<T> {
  const identity = app === 'ask' ? `ask@${version}` : (await appVersions())[app]
  const response = await fetch(`/api/${kind}/${app}/${encodeURIComponent(name)}`, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(identity ? { 'X-Featherbase-App-Version': identity } : {}) }, body: JSON.stringify(body) })
  if (response.status === 401) { window.top!.location.assign(`/featherbase/login?next=${encodeURIComponent('/ask/')}`); throw new ApiError('Sign in to continue.') }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(data?.error?.message ?? 'That did not work. Try again.')
  return data.result as T
}
export const read = <T,>(name: string, payload: unknown = {}) => call<T>('app_reads', 'ask', name, { payload })
export const act = <T,>(name: string, payload: unknown) => call<T>('app_actions', 'ask', name, { idempotencyKey: crypto.randomUUID(), payload })
/** A read of another app, run as the signed-in person: the same call that app's own page makes, under the same rules. */
export const readApp = <T,>(app: string, name: string, payload: unknown = {}) => call<T>('app_reads', app, name, { payload })
export const catalog = () => fetch('/api/app_catalog', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : [])).catch(() => []) as Promise<{ name: string; title: string; href: string; summary?: string }[]>

export interface Plan { report: 'sales'; month: 'this' | 'last'; stores: 'all' | string[]; group_by: 'none' | 'subcategory' | 'section' | 'store'; show: 'all' | 'behind' | 'ahead'
  sort: 'gap' | 'achieved' | 'actual' | 'target'; order: 'asc' | 'desc'; limit: number | null; name_contains: string | null }
export interface Reply { kind: 'data' | 'help' | 'suggest' | 'cannot'; say: string; plan?: Plan; reports: string[]; areas: string[]; guide?: string }
export interface Meter { label: string; period: string; used: number; of: number; unit: 'questions' | 'usd'; full: boolean }
export interface Session { user: string; name: string; admin: boolean; ai: 'openrouter' | 'built_in'; model: string; models: string[]; meters: Meter[]; refused: string | null }
export interface Thought { refused?: string; reply?: Reply; model?: string; cost_usd?: number; took_ms?: number; receipt?: { body: string; signature: string } }
export interface Asked { row_id: string; question: string; kind: string; reply: string; report: string; pointed_to: string; model: string; asked_at: string }
export interface Group { key: string; questions: number; cost_usd: number; last: string; name?: string }
export interface Limit { row_id: string; applies_to: string; who: string; who_name: string; model: string; period: string; max_questions: number | null; max_usd: number | null }
export interface Log { month: string; cap: number | null; model: string; allowed_models: string
  total: { questions: number; cost_usd: number; people: number; today: number; today_cost_usd: number }
  by_person: Group[]; by_model: Group[]; by_kind: Group[]; most_asked: Group[]; pointed_to: Group[]; limits: Limit[]
  questions: (Asked & { asked_by: string; name: string; cost_usd: number; took_ms: number; tokens_in: number; tokens_out: number })[] }
export interface Model { id: string; name: string; in_per_million: number; out_per_million: number }
