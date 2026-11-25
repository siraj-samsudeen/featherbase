// The page's calls to the server: ask a question, and list the person's own chats.
import { version } from '../../package.json'
import type { Reply } from '../shared/reply'

/** A call that failed, with the message to show and the HTTP status. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** What asking returns: the chat the question was saved in, and its answer. */
export type Asked = { chat: string; answer: Reply }

// Without a chat, the server starts a new one and returns its id.
export async function askQuestion(question: string, chat?: string): Promise<Asked> {
  const response = await fetch('/api/app_actions/ask/ask', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      // The platform refuses a page whose version is not the installed Ask's (403).
      'X-Featherbase-App-Version': `ask@${version}`,
    },
    // An action names each attempt, so the platform never saves one twice.
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), payload: { question, chat } }),
  })
  // Signed out: go to the login page, and come back to Ask afterwards.
  if (response.status === 401) {
    window.location.assign('/featherbase/login?next=%2Fask%2F')
    throw new ApiError('Sign in to continue.', 401)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new ApiError(data?.error?.message ?? `Ask could not answer (${response.status}). Please try again.`, response.status)
  // The server's action returns { chat, answer }, and the platform wraps it in { result }.
  return data.result as Asked
}
/** One of the person's chats, as Recent Chats lists it. */
export type ChatRow = { row_id: string; title: string; created_at: string }

/** One page of the person's chats, and how many they have in all. */
export type ChatPage = { chats: ChatRow[]; total: number }

// The platform's own list of a Table's rows. Ask's permissions give each person only
// the chats they started, so this is "my chats". Newest first: `count` chats, after
// skipping the first `skip` (the ones already shown).
export async function myChats(skip: number, count: number): Promise<ChatPage> {
  const query = new URLSearchParams({
    fields: JSON.stringify(['row_id', 'title', 'created_at']),
    order_by: 'created_at desc',
    limit_start: String(skip),
    limit_page_length: String(count),
  })
  const response = await fetch(`/api/table/ask.chat?${query}`, { credentials: 'same-origin' })
  if (response.status === 401) {
    window.location.assign('/featherbase/login?next=%2Fask%2F%3Fview%3Dchats')
    throw new ApiError('Sign in to continue.', 401)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new ApiError(data?.error?.message ?? `Your chats could not load (${response.status}).`, response.status)
  return { chats: data.data as ChatRow[], total: data.total as number }
}