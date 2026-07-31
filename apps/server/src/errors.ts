import type { Context } from 'hono'

export type ErrorType =
  | 'ValidationError'
  | 'BadRequestError'
  | 'AuthenticationError'
  | 'PermissionError'
  | 'NotFoundError'
  | 'ConflictError'
  | 'MethodNotAllowedError'
  | 'DataSourceError'
  | 'InternalError'

const STATUS: Record<ErrorType, number> = {
  ValidationError: 417, // Frappe convention for business validation
  BadRequestError: 400, // malformed request (bad JSON, bad params)
  AuthenticationError: 401,
  PermissionError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  MethodNotAllowedError: 405,
  // EDS-11: an external data source is unreachable/failed — an upstream
  // failure (502), never disguised as an empty result.
  DataSourceError: 502,
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

// Frappe wire parity: real Frappe error bodies carry a top-level `exc_type`
// with its exception-class name. Ours map 1:1 except NotFound, which Frappe
// calls DoesNotExistError.
const EXC_TYPE: Record<ErrorType, string> = {
  ValidationError: 'ValidationError',
  BadRequestError: 'BadRequestError',
  AuthenticationError: 'AuthenticationError',
  PermissionError: 'PermissionError',
  NotFoundError: 'DoesNotExistError',
  ConflictError: 'ConflictError',
  MethodNotAllowedError: 'MethodNotAllowedError',
  DataSourceError: 'DataSourceError',
  InternalError: 'InternalError',
}

export function errorResponse(c: Context, err: unknown) {
  if (err instanceof AppError) {
    return c.json(
      {
        exc_type: EXC_TYPE[err.type],
        error: { type: err.type, message: err.message, ...(err.fields ? { fields: err.fields } : {}) },
      },
      STATUS[err.type] as 403,
    )
  }
  // A SyntaxError here means c.req.json() failed on a malformed body — a
  // client error, not a server fault.
  if (err instanceof SyntaxError) {
    return c.json({ exc_type: 'BadRequestError', error: { type: 'BadRequestError', message: 'Malformed JSON body' } }, 400)
  }
  console.error(err)
  return c.json({ exc_type: 'InternalError', error: { type: 'InternalError', message: 'Internal server error' } }, 500)
}
