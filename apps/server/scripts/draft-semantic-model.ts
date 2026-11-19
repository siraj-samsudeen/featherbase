// Prints a first draft of a semantic model for one of an app's datasets, from
// the dataset's declared columns, for a developer to correct and paste into
// the manifest's `semantic.models`. Nothing is written.
//
//   pnpm --filter server exec tsx scripts/draft-semantic-model.ts <featherbase.json> <dataset> <read>
//
// <read> is the declared read whose policy decides who may ask (person_scope).
import { readFile } from 'node:fs/promises'
import { datasetsDeclaration } from '../src/app-datasets'
import { draftModel, validateSemantic } from '../src/semantic-model'

const [path, name, read] = process.argv.slice(2)
if (!path || !name || !read) throw new Error('Usage: tsx scripts/draft-semantic-model.ts <featherbase.json> <dataset> <read>')
const manifest = JSON.parse(await readFile(path, 'utf8')) as { datasets?: unknown; reads?: { operations?: Record<string, { policy: { kind: string }; outbound?: boolean }> }; tables?: { name: string; columns: { column_name: string }[] }[] }
const datasets = datasetsDeclaration.parse(manifest.datasets ?? [])
const dataset = datasets.find(candidate => candidate.name === name)
if (!dataset) throw new Error(`The app declares no dataset named ${name}. It declares: ${datasets.map(candidate => candidate.name).join(', ') || 'none'}`)
const model = draftModel(dataset, read)
// The draft is checked as the platform checks a manifest's models, so what is printed can be installed.
validateSemantic({ models: [model] }, datasets, manifest.reads?.operations, manifest.tables)
console.log(JSON.stringify(model, null, 2))
