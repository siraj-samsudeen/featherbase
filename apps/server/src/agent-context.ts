// #1083 (mcp-server D8): whether the request in hand was made by an agent
// through /mcp, and with which access token. The /mcp handler alone sets it,
// in-process, around each tool's inner /api request, so history written deep
// inside the save path can mark the change without every caller threading it
// and no outside caller can claim or hide the mark (no header sets it).
import { AsyncLocalStorage } from 'node:async_hooks'

export interface AgentMark {
  token_id: string
  token_label: string
}

const agent = new AsyncLocalStorage<AgentMark>()

export function runAsAgent<T>(mark: AgentMark, fn: () => T): T {
  return agent.run(mark, fn)
}

/** The agent mark of the request in hand; undefined outside /mcp. */
export function agentMark(): AgentMark | undefined {
  return agent.getStore()
}
