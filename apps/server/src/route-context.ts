import type { SessionUser } from './auth'

// frameOrigins (#642, E4): the outside sites this response's page may frame,
// set by the handler that serves an app's own page.
export type Env = { Variables: { user: SessionUser; frameOrigins?: readonly string[] } }

export const who = (c: { get: (k: 'user') => SessionUser }) => c.get('user').row_id
