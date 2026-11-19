// Asks the real language model every verified question of an app's semantic
// models, as the app's page asks it (of the first model, and of the others
// that run as the same read). The answer comes as SQL: it must be for the
// right model, must run, and must answer with the columns the verified plan
// answers with. It runs on a table with no rows, so no data is needed. Not
// part of the test suite: it needs ANTHROPIC_API_KEY and costs a call per
// question. When Featherbase is running on the made-up data, the agent is
// then checked as people use it (check-live-agent.ts): known answers,
// permissions, and attempts to get around its rules.
//
//   pnpm --filter server exec tsx scripts/check-verified-questions.ts ../../client-apps/jeyarama/dash/featherbase.json
//
// Exit code 0 when every question gets SQL with its verified columns.
import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { datasetsDeclaration } from '../src/app-datasets'
import { semanticDeclaration } from '../src/semantic-model'
import { questionToSql, runSql, type SqlTable } from '../src/semantic-sql'
import { planModel } from '../src/plan-model'
import { liveAgentChecks } from './check-live-agent'

const path = process.argv[2]
if (!path) throw new Error('Name the manifest: tsx scripts/check-verified-questions.ts <featherbase.json>')
const manifest = JSON.parse(await readFile(path, 'utf8')) as { semantic?: unknown; datasets?: unknown }
const { models } = semanticDeclaration.parse(manifest.semantic)
const datasets = datasetsDeclaration.parse(manifest.datasets ?? [])
const table = (model: (typeof models)[number]): SqlTable => ({ model, dataset: datasets.find(dataset => dataset.name === model.dataset)! })
const language = planModel()
let failed = 0
for (const model of models) {
  for (const { question, plan } of model.verified ?? []) {
    try {
      const among = [models[0], ...models.filter(other => other !== models[0] && other.read === models[0].read)]
      const got = await questionToSql((among.includes(model) ? among : [model]).map(table), question, language)
      const wanted = [...(plan.groupBy ?? []), ...plan.measures]
      const columns = 'sql' in got && got.model === model.name ? (await runSql(table(model), [], got.sql)).columns.map(column => column.name) : undefined
      const same = isDeepStrictEqual(columns, wanted)
      if (!same) failed++
      console.log(`${same ? 'PASS' : 'FAIL'} ${model.name}: ${question}`)
      if (!same) console.log(`  wanted columns ${JSON.stringify(wanted)}\n  got ${JSON.stringify(columns ?? got)}`)
      if ('sql' in got) console.log(`  ${got.sql}`)
    } catch (error) {
      failed++
      console.log(`FAIL ${model.name}: ${question}\n  ${(error as Error).message}`)
    }
  }
}
console.log(failed ? `${failed} question(s) did not get SQL with their verified columns` : 'Every verified question got SQL with its verified columns')
const live = await liveAgentChecks(path)
if (live === undefined) console.log('\nFeatherbase is not running, so the agent was not checked live. Start it (scripts\\start-featherbase.ps1) and run this again.')
// Exits outright: a database connection opened to record the language model's use would otherwise hold the process open.
process.exit(failed || live ? 1 : 0)
