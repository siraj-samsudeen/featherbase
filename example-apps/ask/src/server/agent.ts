import type { Reply, Step, Thought } from '../shared/reply'

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

/** A step's summary is one short line. */
export const SUMMARY_LENGTH = 200

/** The agent: the model calls tools until it can answer, or the steps run out.
 *  Returns the answer with the steps behind it. */
export async function answer(question: string, model: Model, mcp: McpTools): Promise<Thought> {
  const tools = await mcp.tools()
  const done: Done[] = []
  const thought = (reply: Reply): Thought => ({ answer: reply, steps: done.map(stepOf) })
  for (let step = 0; step < MAX_STEPS; step++) {
    const next = await model.next(question, tools, done)
    if (next.kind !== 'call') return thought(next)
    // A refusal is not an error: it goes back to the model as the call's result.
    const ran = await mcp.call(next.call.name, next.call.args)
    done.push(ran.ok ? { call: next.call, result: ran.result } : { call: next.call, result: ran.reason, refused: true })
  }
  const last = done[done.length - 1]
  return thought({ kind: 'cannot', text: last.refused ? `I couldn't answer that: ${last.result}` : "I couldn't answer that in the steps I'm allowed." })
}

/** A call made, as saved with the answer: the tool and its arguments, and how much came back. */
function stepOf({ call, result, refused }: Done): Step {
  if (refused) return { tool: call.name, args: call.args, summary: `refused: ${result}`.slice(0, SUMMARY_LENGTH), refused: true }
  return { tool: call.name, args: call.args, summary: summaryOf(result) }
}

/** A result in short, never its rows: "2 rows" when it has a total, "12 tables" for its first list. */
function summaryOf(result: unknown): string {
  if (!result || typeof result !== 'object') return 'done'
  const { total } = result as { total?: unknown }
  if (typeof total === 'number') return `${total} row${total === 1 ? '' : 's'}`
  const list = Object.entries(result).find(([, value]) => Array.isArray(value))
  return list ? `${(list[1] as unknown[]).length} ${list[0]}` : 'done'
}