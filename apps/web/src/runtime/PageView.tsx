import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { checkPage, type PageDefinition, type PageSource, type PageStatus } from 'shared'
import { Notice, Skeleton, useToast } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { CannotShow } from '../components/CannotShow'
import { searchWithState, stateFromSearch } from './address'
import { runAction } from './actions'
import { absolutePath, resolveContext, type PageModel, type Row } from './grammar'
import { PartView } from './parts'
import { PageRuntimeProvider, scopeAt, type PageRuntime } from './runtime'
import { columnsRead, forgetTyped, typeInto, withTyped, type Typed } from './sources'
import { problemLines, useSources } from './use-sources'

// #1410: a runtime page. A page is a screen saved as data (a row of the Page
// Table); this draws it inside the Admin shell from the shared parts. Its state
// lives in the address; its rows are read as the person looking.

interface SavedPage { name: string; title: string; module: string; status: PageStatus; description: string | null; definition: PageDefinition; updated_at: string }
type Search = Record<string, unknown>

export function PageView({ name, search, onSearch }: {
  name: string
  /** The address's query string, which holds the page's state. */
  search: Search
  /** Asked to change the query string, without a reload. */
  onSearch: (next: Search) => void
}) {
  const page = useQuery({ queryKey: ['page', name], queryFn: () => api.get<SavedPage>(`/api/pages/${encodeURIComponent(name)}`) })
  if (page.isError) return <CannotShow error={page.error} what="page" named={name} onRetry={() => void page.refetch()} />
  if (!page.data) return <Skeleton label="Loading page" lines={4} />
  return <CheckedPage name={name} definition={page.data.definition} search={search} onSearch={onSearch} />
}

/** The save refuses a wrong definition, so one is drawn as saved; the same check here keeps a page saved before the catalog changed from breaking the screen. */
function CheckedPage(props: Parameters<typeof DrawnPage>[0]) {
  const mistakes = useMemo(() => checkPage(props.definition).fields, [props.definition])
  return Object.keys(mistakes).length ? <CannotDraw mistakes={mistakes} /> : <DrawnPage {...props} />
}

const NO_STATE = {}
const NO_DATA: Record<string, PageSource> = {}

function DrawnPage({ name, definition, search, onSearch }: { name: string; definition: PageDefinition; search: Search; onSearch: (next: Search) => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const defaults = definition.state ?? NO_STATE
  const data = definition.data ?? NO_DATA
  const state = stateFromSearch(defaults, search)
  const reads = useMemo(() => columnsRead(definition), [definition])
  const { sources, refresh } = useSources(name, data, state, reads)
  const [typed, setTyped] = useState<Typed>({})
  const parts = useMemo(() => new Map(definition.components.map((part) => [part.id, part])), [definition])

  // Two readings of the same rows: as the server last answered, and with what was typed laid over them.
  const rowsOf = (lay: (source: string, rows: Row[]) => Row[]) =>
    Object.fromEntries(Object.entries(sources).map(([source, read]) => [source, read.status === 'ready' ? lay(source, read.rows) : []]))
  const model: PageModel = { state, data: rowsOf((_, rows) => rows) }
  const typedModel: PageModel = { state, data: rowsOf((source, rows) => withTyped(rows, typed[source])) }
  const setState = (values: Search) => onSearch(searchWithState(defaults, search, values))
  const runtime: PageRuntime = {
    definition,
    parts,
    model,
    typed: typedModel,
    sources,
    write: (path, value, place) => {
      const at = absolutePath(path, scopeAt(typedModel, place))
      const key = /^\/state\/([^/]+)$/.exec(at)?.[1]
      if (key) setState({ [key]: value })
      else setTyped((before) => typeInto(before, typedModel.data, at, value))
    },
    fire: async (event, place) => {
      try {
        const said = await runAction(event.name, resolveContext(event, scopeAt(typedModel, place)), {
          refresh,
          saved: (table, row) => setTyped((before) => forgetTyped(before, Object.keys(data).filter((source) => (data[source] as { table?: string }).table === table), row)),
          // The router writes the query string itself, as it does for every other address.
          go: (href, opensIn) => void navigate({ to: href, search: opensIn }),
          setState,
        })
        if (said) toast({ tone: 'positive', message: said })
      } catch (error) {
        // The server's own words; what was typed stays on the page.
        toast({ tone: 'negative', message: problemLines(error).map((line) => <p key={line}>{line}</p>) })
      }
    },
  }
  return <PageRuntimeProvider value={runtime}><PartView id="root" /></PageRuntimeProvider>
}

/** A saved definition that the catalog no longer allows (it was right when it was saved): every mistake, where it is. */
function CannotDraw({ mistakes }: { mistakes: Record<string, string> }) {
  return (
    <Notice tone="negative">
      <p className="font-medium">This page cannot be drawn as it is saved.</p>
      <ul className="mt-1 list-disc pl-5">
        {Object.entries(mistakes).map(([at, why]) => <li key={at}>{at}: {why}</li>)}
      </ul>
    </Notice>
  )
}
