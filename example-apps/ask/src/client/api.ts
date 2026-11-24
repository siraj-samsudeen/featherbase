// The page's one call to Ask's server: send a question, get the reply.
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