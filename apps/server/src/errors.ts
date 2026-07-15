import type { Context } from 'hono'

export type ErrorType =
  | 'ValidationError'
  | 'AuthenticationError'
  | 'PermissionError'
  | 'NotFoundError'
  | 'ConflictError'
  | 'InternalError'

const STATUS: Record<ErrorType, number> = {
  ValidationError: 417,
  AuthenticationError: 401,
  PermissionError: 403,
  NotFoundError: 404,
  ConflictError: 409,
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

export function errorResponse(c: Context, err: unknown) {
  if (err instanceof AppError) {
    return c.json(
      { error: { type: err.type, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
      STATUS[err.type] as 403,
    )
  }
  console.error(err)
  return c.json({ error: { type: 'InternalError', message: 'Internal server error' } }, 500)
}
