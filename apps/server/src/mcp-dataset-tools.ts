// #1409: an agent serves an app's dataset from a stand-in over /mcp, and
// switches it to the warehouse. Each tool is one inner request to the route
// the Admin's Datasets page uses, with the caller's token, so the same rule
// applies to both: System Managers only. As with an import (#1105 D4), a load
// needs the check of that same file first, so an agent reads what would be
// refused before it replaces a dataset's rows.
import { createHash } from 'node:crypto'
import * as z from 'zod'
import { AppError } from './errors'
import { ALTERS, ALTERS_AGAIN, READS, type Api, type Json, type RegisterTool } from './mcp-common'

const appArg = z.string().min(1).describe('The app\'s name, as list_datasets gives it')
const datasetArg = z.string().min(1).describe('The dataset\'s name, as list_datasets gives it')
const fileArgs = {
  app: appArg,
  dataset: datasetArg,
  csv: z.string().describe('The file as CSV text, its header row first: exactly the dataset\'s columns, in any order. Dates as YYYY-MM-DD, numbers as digits only.'),
  delimiter: z.enum([',', '\t', ';']).optional().describe('What separates cells: a comma (the default), a tab or a semicolon'),
}
type FileArgs = z.infer<z.ZodObject<typeof fileArgs>>

const datasetPath = (app: string, dataset: string, verb: string) =>
  `/api/datasets/${encodeURIComponent(app)}/${encodeURIComponent(dataset)}/${verb}`

/** What a check vouches for: this caller, this dataset, this file. */
function checkDigest(tokenId: string, { app, dataset, csv, delimiter }: FileArgs): string {
  return createHash('sha256').update(JSON.stringify([tokenId, app, dataset, csv, delimiter ?? ','])).digest('base64url')
}

const CHECK_FIRST = 'Check the file first: run check_stand_in with this same app, dataset and file, and pass the check it returns'

export function registerDatasetTools(tool: RegisterTool, api: Api, tokenId: string) {
  tool('list_datasets',
    'The datasets the installed apps read, by app: each one\'s data source, whether it is served from the warehouse or from a stand-in '
    + '(rows loaded from a file until the warehouse has the data), its note, when the real data is expected, its rows and when they were '
    + 'refreshed or loaded. System Managers only.',
    { app: z.string().optional().describe('Only this app\'s datasets') }, READS,
    async ({ app }) => {
      const { apps } = (await api('GET', '/api/datasets')) as { apps: (Json & { app: string })[] }
      return { apps: app ? apps.filter((entry) => entry.app === app) : apps }
    })

  tool('check_stand_in',
    'Check a CSV against a dataset before loading it as the dataset\'s stand-in. It fits when it has exactly the dataset\'s columns and '
    + 'every value fits its column; each problem names its column and its row in the file (the header is row 1). Writes nothing. '
    + 'Returns check, which load_stand_in needs.',
    fileArgs, READS,
    async (args) => {
      const { app, dataset, ...file } = args
      const checked = await api('POST', datasetPath(app, dataset, 'check_stand_in'), file)
      return { ...checked, ...(checked.fits ? { check: checkDigest(tokenId, args) } : {}) }
    })

  tool('load_stand_in',
    'Load a CSV as a dataset\'s stand-in, exactly as check_stand_in checked it: the app then shows these rows in place of the warehouse\'s, '
    + 'and every page that shows them says they are sample data. It replaces the rows the dataset had, and the scheduled refresh leaves the '
    + 'dataset alone until switch_to_warehouse. On production it is refused until a System Manager has ticked Allowed on production on '
    + 'the dataset\'s Dataset Binding row.',
    {
      ...fileArgs,
      check: z.string({ error: CHECK_FIRST }).min(1, CHECK_FIRST).describe('The check check_stand_in returned for this same file'),
      note: z.string().optional().describe('Where the stand-in came from, in a few words; shown to everyone who sees its rows'),
      expected_by: z.string().optional().describe('The day the real data is expected, as YYYY-MM-DD; shown with the stand-in'),
    },
    ALTERS_AGAIN,
    async ({ check, note, expected_by, ...args }) => {
      if (check !== checkDigest(tokenId, args)) throw new AppError('ValidationError', CHECK_FIRST)
      const { app, dataset, ...file } = args
      return api('POST', datasetPath(app, dataset, 'load_stand_in'), { ...file, ...(note === undefined ? {} : { note }), ...(expected_by === undefined ? {} : { expected_by }) })
    })

  tool('switch_to_warehouse',
    'Switch a dataset from its stand-in to the warehouse: the real refresh runs now. If it brings rows, the app shows them and the '
    + 'sample-data line goes. If the warehouse fails or a check refuses its rows, the stand-in keeps serving; switched and message say which, and why.',
    { app: appArg, dataset: datasetArg }, ALTERS,
    ({ app, dataset }) => api('POST', datasetPath(app, dataset, 'switch_to_warehouse')))
}
