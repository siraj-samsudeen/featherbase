import type { Reply } from '../shared/reply'

/** A tool the model may call, as Featherbase's MCP server describes it. */
export type Tool = { name: string; description: string; inputSchema: Readonly<Record<string, unknown>> }

/** One tool call: the tool's name and its arguments. */
export type ToolCall = { name: string; args: Record<string, unknown> }

/** A call already made for this question, with what came back. refused: Featherbase said no. */
export type Done = { call: ToolCall; result: unknown; refused?: boolean }

/** The model's next move: call a tool, or finish with an answer, or say it can't. */
export type Next = { kind: 'call'; call: ToolCall } | Reply

/** The model: sees the question, the tools and the calls so far, and picks the next move. */
export interface Model {
  next(question: string, tools: Tool[], done: Done[]): Promise<Next>
}

/** Featherbase's read-only MCP tools, run as the person asking (the read's ctx.featherbaseMcp). */
export interface McpTools {
  tools(): Promise<Tool[]>
  call(name: string, args: Record<string, unknown>): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }>
}

/** At most this many tool calls for one question. */
export const MAX_STEPS = 8

/** The agent: the model calls tools until it can answer, or the steps run out. */
export async function answer(question: string, model: Model, mcp: McpTools): Promise<Reply> {
  const tools = await mcp.tools()
  const done: Done[] = []
  for (let step = 0; step < MAX_STEPS; step++) {
    const next = await model.next(question, tools, done)
    if (next.kind !== 'call') return next
    // A refusal is not an error: it goes back to the model as the call's result.
    const ran = await mcp.call(next.call.name, next.call.args)
    done.push(ran.ok ? { call: next.call, result: ran.result } : { call: next.call, result: ran.reason, refused: true })
  }
  const last = done[done.length - 1]
  return { kind: 'cannot', text: last.refused ? `I couldn't answer that: ${last.result}` : "I couldn't answer that in the steps I'm allowed." }
}