// #1377 (ADR 0028): the caller's own credential, carried from an app read's route to the
// Featherbase MCP tools that forward it. It never prints itself: logged, printed, inspected or
// turned into JSON it reads "[credential]", so a debug line or an error that captures it cannot
// leak it. Only the tools read its value, to set their header.
import type { Context } from 'hono'
import { authCredential } from './session-cookies'

const HIDDEN = '[credential]'

export class Credential {
  readonly #header: string
  constructor(header: string) {
    this.#header = header
  }
  /** The Authorization header value ("Bearer …"). Only mcp-app-reads.ts reads it. */
  header(): string {
    return this.#header
  }
  toString() {
    return HIDDEN
  }
  toJSON() {
    return HIDDEN
  }
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return HIDDEN
  }
}

/** The credential this request came with (header first, then the sid cookie), or none. */
export function callerCredential(c: Context): Credential | undefined {
  const header = authCredential(c)
  return header ? new Credential(header) : undefined
}
