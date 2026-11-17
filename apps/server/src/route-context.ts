import type { SessionUser } from './auth'
import type { ViewingAs } from './view-as-context'

// frameOrigins (#642, E4): the outside sites this response's page may frame,
// set by the handler that serves an app's own page.
// #1222: viewingAs is set while a tester views as someone; `user` is then the person viewed.
export type Env = { Variables: { user: SessionUser; frameOrigins?: readonly string[]; viewingAs?: ViewingAs } }

export const who = (c: { get: (k: 'user') => SessionUser }) => c.get('user').row_id
