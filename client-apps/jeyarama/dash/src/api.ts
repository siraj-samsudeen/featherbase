import { version } from '../package.json'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

// One call to the platform as the signed-in person (the session cookie rides
// along on the same origin), pinned to this build's version of the app.
async function post(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `feather_dash@${version}` },
    body: JSON.stringify({ payload }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error?.message ?? 'Request failed', response.status)
  return body
}

/** Calls one of Feather Dash's declared reads on the platform. */
export async function read<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  return (await post(`/api/app_reads/feather_dash/${encodeURIComponent(name)}`, payload)).result as T
}

const CHAT = '/api/app_chat/feather_dash'

/** A way of talking to the chat: figures answered in the chat, reports drawn on the page, how things work, or something to do. */
export type ChatMode = 'agent' | 'reports' | 'ask' | 'action'
export interface ChatSession { id: number; title: string; updated_at: string }
export interface ChatMessage { id: number; role: 'user' | 'assistant'; mode: ChatMode; content: Record<string, unknown>; at: string }

/** A request sent through the Action mode for a person to review. */
export interface ChatRequest {
  id: number; ticket: string; title: string; inputs: { name: string; label: string; value: string }[]
  status: 'pending_review' | 'approved' | 'rejected'; at: string; decided_at?: string; note?: string; requester?: string
}
/** The person's own requests and, for a reviewer, the requests of others that are waiting. */
export interface ChatRequests { mine: ChatRequest[]; review?: ChatRequest[] }

/**
 * The chat's name and the modes this person holds, in the panel's order; whether they review what others
 * send; and, for one who holds the Action mode, what can be sent. No mode and nothing to review means no chat for them.
 */
export async function chatModes(): Promise<{ title: string; modes: { mode: ChatMode; label: string }[]; review?: boolean
  requests?: { name: string; title: string; description: string }[] }> {
  return await post(`${CHAT}/modes`, {})
}

/** The requests this person sent, and those waiting for them to review. */
export async function chatRequests(): Promise<ChatRequests> {
  return await post(`${CHAT}/requests`, {})
}

/** A reviewer approves or rejects a request that is waiting; the lists as they then stand come back. */
export async function decideChatRequest(id: number, decision: 'approved' | 'rejected', note?: string): Promise<ChatRequests> {
  return await post(`${CHAT}/requests/${id}/decide`, { decision, ...(note ? { note } : {}) })
}

/** The person's conversations, the latest first. */
export async function chatSessions(): Promise<ChatSession[]> {
  return (await post(`${CHAT}/sessions`, {})).sessions
}

/** One conversation's messages, oldest first. */
export async function chatSession(id: number): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  return await post(`${CHAT}/sessions/${id}`, {})
}

/** Removes a conversation from the list; what is left comes back. */
export async function closeChatSession(id: number): Promise<ChatSession[]> {
  return (await post(`${CHAT}/sessions/${id}/close`, {})).sessions
}

/** Says something in a mode; the platform answers it and keeps both in the conversation (a new one when none is named). */
export async function sendChat(mode: ChatMode, text: string, session?: number): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  return await post(`${CHAT}/send`, { mode, text, ...(session ? { session } : {}) })
}

const platformGet = async <T>(path: string): Promise<T> => {
  const response = await fetch(path, { credentials: 'same-origin' })
  if (!response.ok) throw new ApiError('Request failed', response.status)
  return await response.json() as T
}

/**
 * What the platform says about this person and this app, for the page's "no access" message:
 * whether they can manage the instance (whoami) and, if so, what instance health says the app
 * lacks. Anything unreadable leaves them a reader or a manager with nothing known to be missing.
 */
export async function accessFacts(): Promise<{ manages: boolean; missing?: string[]; fix?: string | null }> {
  const me = await platformGet<{ capabilities?: { manage?: boolean } }>('/api/whoami').catch(() => undefined)
  if (!me?.capabilities?.manage) return { manages: false }
  const health = await platformGet<{ checks: { key: string; missing?: string[]; fix?: string | null }[] }>('/api/instance-health').catch(() => undefined)
  const check = health?.checks.find(c => c.key === 'app-setup:feather_dash')
  return { manages: true, missing: check?.missing, fix: check?.fix ?? null }
}
