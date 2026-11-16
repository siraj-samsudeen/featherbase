// A spec scenario as a Vitest test (#1070, step 2). The test's title is the
// scenario's name in openspec/specs (or an active change), and its body walks
// the scenario's Gherkin steps in order:
//
//   const scenario = scenarioFor(test, 'naming-and-numbering')
//   scenario('Two tables with the same prefix both start at 001', async ({ admin }, step) => {
//     await step('two tables "Store" and "Store Copy" both named by …', async () => { … })
//     await step(/adds a store to each/, async () => { … })
//     await step('each store is numbered STORE-001', async () => { … })
//   })
//
// A step names the next Gherkin line, by its exact text (without Given/When/
// Then/And) or a pattern. The test fails when the scenario is missing or still
// prose, when a step is out of order, and when a step is left out, so the test
// can't drift from the spec. Each step is recorded on the test (annotate), and
// `pnpm check:scenarios` reports every scenario with the test that proves it.
import type { TestAPI } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
type Scenario = {
  steps: { keyword: string; text: string }[]
  examples: Record<string, string>[] | null
  file: string
  line: number
}
const { findScenario } = require('../../../tools/scenarios/spec-index.cjs') as {
  findScenario: (capability: string, name: string) => Scenario
}

export type Step = (text: string | RegExp, run?: () => unknown) => Promise<void>
/** A Scenario Outline's row of values; an empty object for a plain scenario. */
export type Example = Record<string, string>

type Ctx = { annotate?: (message: string, type?: string) => Promise<unknown> }

/** Whether step i is an outcome: a Then, or an And or But continuing one. Such a step must assert something. */
export function isThenStep(steps: readonly { keyword: string }[], i: number): boolean {
  for (let k = i; k >= 0; k--) {
    const keyword = steps[k]!.keyword
    if (keyword !== 'And' && keyword !== 'But' && keyword !== '*') return keyword === 'Then'
  }
  return false
}

const fill = (text: string, example: Example) => text.replace(/<([^>]+)>/g, (whole, key: string) => example[key] ?? whole)

/**
 * The scenarios of one capability as tests. A Scenario Outline becomes one
 * test per row of its Examples, named "<scenario> [<values>]"; its steps read
 * with that row's values filled in.
 */
export function scenarioFor<C extends object>(test: TestAPI<C>, capability: string) {
  return (name: string, body: (ctx: C, step: Step, example: Example) => Promise<void>, timeout?: number) => {
    // Found while the file is collected: a name the spec doesn't have fails at once.
    const scenario = findScenario(capability, name)
    const rows: Example[] = scenario.examples ?? [{}]
    for (const example of rows) {
      const title = scenario.examples ? `${name} [${Object.values(example).join(', ')}]` : name
      const run = async (ctx: C) => {
          let next = 0
          const step: Step = async (text, run) => {
            const want = scenario.steps[next]
            if (!want) throw new Error(`"${name}" has ${scenario.steps.length} steps; the test takes one more: ${String(text)}`)
            const line = fill(want.text, example)
            const matches = typeof text === 'string' ? line === text || want.text === text : text.test(line)
            if (!matches) throw new Error(`Step ${next + 1} of "${name}" is "${want.keyword} ${line}", not ${String(text)}`)
            if (!run && isThenStep(scenario.steps, next))
              throw new Error(`Step ${next + 1} of "${name}" is "${want.keyword} ${line}", an outcome: give it a callback that asserts it`)
            next++
            await (ctx as Ctx).annotate?.(`${want.keyword} ${line}`, 'step')
            if (run) await run()
          }
          await body(ctx, step, example)
          if (next !== scenario.steps.length)
            throw new Error(
              `"${name}" ran ${next} of its ${scenario.steps.length} steps; the next is "${scenario.steps[next]!.keyword} ${fill(scenario.steps[next]!.text, example)}" (${scenario.file}:${scenario.line})`,
            )
      }
      // Vitest sets up the fixtures a test destructures, read from its source
      // text: the wrapper reports the body's, so `({ admin }, step)` gets admin.
      run.toString = () => body.toString()
      ;(test as unknown as (title: string, fn: (ctx: C) => Promise<void>, timeout?: number) => void)(title, run, timeout)
    }
  }
}
