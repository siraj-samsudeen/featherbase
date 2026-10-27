// 26-Oct-2026: the object Server Scripts and Client Scripts call is now named
// `featherbase` (featherbase.throw(msg), featherbase.ui.form.on(table, handlers));
// it was `frappe`, from the project's start as a Frappe replication. The runtimes
// no longer define `frappe`, so stored script source is rewritten to match.
//
// Only CODE changes: the identifier `frappe` used as an object (`frappe.x`,
// `frappe?.x`) that is not itself a member (`o.frappe.x` is left). Each source
// is read with a JavaScript tokenizer, so strings, template text, comments and
// regular expressions are never touched (#556: a text-level rewrite turned
// `fetch("https://frappe.io/api")` into `featherbase.io`). A source that cannot
// be read as JavaScript is left as it is and named in the report, for an
// operator to edit by hand.
//
// #556: this file replaced 0124_script_api_featherbase.sql before 0124 reached
// any instance. A checkout that ran the .sql runs this once more, harmlessly
// (nothing is left to rename). The .sql's ledger entry stays, as the record
// that the text-level version ran there.
import { tokenizer, tokTypes, type Token } from 'acorn'
import { sql } from '../src/db'

/** The source with every `frappe` object reference renamed, and whether a
 *  bare `frappe` is left that the rename could not follow (`typeof frappe`,
 *  `var f = frappe`, a local of that name): its meaning may have changed, so a
 *  person checks it. Null when the source cannot be read as JavaScript. Both
 *  runtimes run a script as a function body, so a top-level `return` (and,
 *  harmlessly, `await`) is allowed. */
export function renameScriptApi(source: string): { source: string; bare: boolean } | null {
  let tokens: Token[]
  try {
    tokens = [...tokenizer(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
    })]
  } catch {
    return null
  }
  let out = ''
  let at = 0
  let bare = false
  tokens.forEach((token, i) => {
    const before = tokens[i - 1]?.type
    const after = tokens[i + 1]?.type
    if (token.type !== tokTypes.name || source.slice(token.start, token.end) !== 'frappe') return
    if (before === tokTypes.dot || before === tokTypes.questionDot) return
    if (after !== tokTypes.dot && after !== tokTypes.questionDot) {
      bare = true
      return
    }
    out += source.slice(at, token.start) + 'featherbase'
    at = token.end
  })
  return { source: out + source.slice(at), bare }
}

const STORES = [
  { table: 'Server Script', relation: 'server_script' },
  { table: 'Client Script', relation: 'client_script' },
] as const

export async function up(): Promise<void> {
  const counts: number[] = []
  const unreadable: string[] = []
  const bare: string[] = []
  for (const { table, relation } of STORES) {
    let changed = 0
    const rows = await sql.unsafe(`select row_id, script from ${relation} where script like '%frappe%' order by row_id`)
    for (const row of rows) {
      const renamed = renameScriptApi(String(row.script))
      if (renamed === null) {
        unreadable.push(`${table} ${row.row_id}`)
        continue
      }
      if (renamed.bare) bare.push(`${table} ${row.row_id}`)
      if (renamed.source !== row.script) {
        await sql.unsafe(`update ${relation} set script = $1 where row_id = $2`, [renamed.source, row.row_id])
        changed++
      }
    }
    counts.push(changed)
  }
  console.log(`script-api-rename: ${counts[0]} Server Scripts and ${counts[1]} Client Scripts rewritten`)
  if (unreadable.length)
    console.log(`script-api-rename: left unchanged, not readable as JavaScript (edit by hand): ${unreadable.join(', ')}`)
  if (bare.length)
    console.log(`script-api-rename: still names frappe outside a member access (check by hand): ${bare.join(', ')}`)
}
