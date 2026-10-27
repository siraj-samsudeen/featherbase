import type { Context } from 'hono'

type ErrorType =
  | 'ValidationError'
  | 'BadRequestError'
  | 'AuthenticationError'
  | 'PermissionError'
  | 'NotFoundError'
  | 'ConflictError'
  | 'NotSetUpError'
  | 'MethodNotAllowedError'
  | 'DataSourceError'
  | 'ServiceUnavailableError'
  | 'RateLimitError'
  | 'InternalError'

const STATUS: Record<ErrorType, number> = {
  ValidationError: 417, // business validation (a rule the row breaks); see #528
  BadRequestError: 400, // malformed request (bad JSON, bad params)
  AuthenticationError: 401,
  PermissionError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  // #620: an installed app whose required settings or secrets are missing:
  // an instance still to be configured, not an outage.
  NotSetUpError: 409,
  MethodNotAllowedError: 405,
  // EDS-11: an external data source is unreachable/failed — an upstream
  // failure (502), never disguised as an empty result.
  DataSourceError: 502,
  // A service Featherbase depends on to answer this request (the delegated
  // sign-in provider) did not answer usably — "try again later", not a
  // verdict on what the caller sent.
  ServiceUnavailableError: 503,
  // The same type the request-rate limiters answer with: try again later.
  RateLimitError: 429,
  InternalError: 500,
}

export class AppError extends Error {
  type: ErrorType
  fields?: Record<string, string>
  constructor(type: ErrorType, message: string, fields?: Record<string, string>) {
    super(message)
    this.type = type
    this.fields = fields
  }
}

/** The HTTP status errorResponse answers `err` with — for a log line that names it. */
export function statusOf(err: unknown): number {
  if (err instanceof AppError) return STATUS[err.type]
  if ((err as { code?: string })?.code === '23P01') return 409
  if (err instanceof SyntaxError) return 400
  return 500
}

// Errors a route has already logged with its own context, so errorResponse does not log them
// a second time (one failure, one log line).
const alreadyLogged = new WeakSet<object>()

/** Record that `err` has been logged where it was caught; errorResponse then answers without logging it. */
export function markLogged(err: unknown): void {
  if (typeof err === 'object' && err !== null) alreadyLogged.add(err)
}

export function errorResponse(c: Context, err: unknown) {
  if (err instanceof AppError) {
    return c.json(
      // ONE envelope, and nothing beside it: `error: { type, message, fields? }`.
      // This body used to carry Frappe's top-level `exc_type` as well (with
      // NotFound spelled DoesNotExistError). That was wire parity for the
      // replication phase and is a CLAUDE.md invariant-4 violation now.
      { error: { type: err.type, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
      STATUS[err.type] as 403,
    )
  }
  // An exclusion constraint (one holder at a time) refusing a write that no
  // path mapped is a conflict, not a server fault.
  if ((err as { code?: string })?.code === '23P01')
    return c.json({ error: { type: 'ConflictError', message: 'That value is already held for an overlapping period' } }, 409)
  // A SyntaxError here means c.req.json() failed on a malformed body — a
  // client error, not a server fault.
  if (err instanceof SyntaxError) {
    return c.json({ error: { type: 'BadRequestError', message: 'Malformed JSON body' } }, 400)
  }
  if (!(typeof err === 'object' && err !== null && alreadyLogged.has(err))) console.error(err)
  return c.json({ error: { type: 'InternalError', message: 'Internal server error' } }, 500)
}
