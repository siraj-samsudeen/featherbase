import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminPageTitle, fmtDayIST } from 'shared'
import { Button, DataList, EmptyState, Notice, RecordLink, Skeleton, StatusPill, fmtCount, fmtDate, fmtInstantIST, type DataColumn } from '@featherbase/shop-floor'
import { ApiError, api } from '../lib/api'
import { PrincipalLink } from '../lib/people'

// #1409: the Datasets page (System Managers). Every installed app's datasets
// in one place: where each is served from (the warehouse, or a stand-in loaded
// from a file until the warehouse has the data), how many rows it has and how
// fresh they are, with Switch To Warehouse beside each stand-in. A stand-in is
// loaded through MCP or the HTTP route, not from this page.

interface DatasetView {
  name: string
  /** The Data Source its query reads. */
  source: string
  /** Its Dataset Binding row, when it has one. */
  binding: string | null
  served_from: 'Warehouse' | 'Stand-in'
  /** The rows being served were loaded as a stand-in. */
  stand_in: boolean
  note: string | null
  expected_by: string | null
  rows: number | null
  as_of: string | null
  /** The person who loaded the stand-in being served. */
  loaded_by: string | null
  /** The snapshot being served (a Dataset Snapshot row). */
  snapshot: string | null
}

interface AppDatasets {
  app: string
  title: string
  datasets: DatasetView[]
}

interface Switched {
  switched: boolean
  message: string
}

/** Bound to a stand-in, or still serving one (its binding was set back by
 *  hand and the next refresh has not run). */
const onStandIn = (dataset: DatasetView) => dataset.served_from === 'Stand-in' || dataset.stand_in

// The shared table gives a row a height, not padding, and these rows hold
// several lines: every cell's content keeps this space above and below it, so
// a person sees where one dataset ends and the next begins.
const CELL = 'py-2'

function ServedFrom({ dataset }: { dataset: DatasetView }) {
  const standIn = onStandIn(dataset)
  // Bound to a stand-in, but no file has been loaded for it.
  const unloaded = standIn && !dataset.stand_in
  return (
    <div className={`min-w-0 space-y-0.5 font-normal ${CELL}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span data-testid="served-from">
          <StatusPill tone={standIn ? 'caution' : 'neutral'}>{standIn ? 'Stand-in' : 'Warehouse'}</StatusPill>
        </span>
        {dataset.stand_in && (
          <span className="text-ink-muted" data-testid="stand-in-loaded">
            Loaded {fmtDayIST(dataset.as_of)}
            {dataset.loaded_by && <> by <PrincipalLink id={dataset.loaded_by} /></>}
          </span>
        )}
      </div>
      {unloaded && (
        <p className="text-ink-muted" data-testid="stand-in-unloaded">
          {/* With rows and no stand-in, the app is still answered the last rows copied from the warehouse, unmarked. */}
          {dataset.rows === null ? 'No stand-in loaded yet' : 'No stand-in loaded yet. The app still shows the warehouse’s rows.'}
        </p>
      )}
      {standIn && dataset.note && <p className="text-ink wrap-anywhere">{dataset.note}</p>}
      {standIn && dataset.expected_by && <p className="text-ink-muted">Real data expected by {fmtDate(dataset.expected_by)}</p>}
    </div>
  )
}

export function Datasets() {
  const queryClient = useQueryClient()
  // What the last switch came to, shown above the lists.
  const [verdict, setVerdict] = useState<{ tone: 'positive' | 'caution' | 'negative'; text: string } | null>(null)
  // The dataset being switched (`<app>.<dataset>`); no other switch starts meanwhile.
  const [switching, setSwitching] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.get<{ apps: AppDatasets[] }>('/api/datasets'),
  })

  async function switchToWarehouse(app: string, dataset: DatasetView) {
    setSwitching(`${app}.${dataset.name}`)
    setVerdict(null)
    try {
      const answer = await api.post<Switched>(`/api/datasets/${encodeURIComponent(app)}/${encodeURIComponent(dataset.name)}/switch_to_warehouse`, {})
      setVerdict({ tone: answer.switched ? 'positive' : 'caution', text: answer.message })
    } catch (err) {
      setVerdict({
        tone: 'negative',
        text: `Could not switch ${dataset.name} to the warehouse: ${err instanceof ApiError ? err.message : 'the request failed'}`,
      })
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['datasets'] })
      setSwitching(null)
    }
  }

  const columns = (app: string): DataColumn<DatasetView>[] => [
    {
      key: 'dataset',
      header: 'Dataset',
      phone: 'title',
      cell: (d) => (
        <div className={`min-w-0 ${CELL}`}>
          {d.binding
            ? <RecordLink table="Dataset Binding" rowId={d.binding} name={d.name} className="font-semibold" />
            : <span className="font-semibold text-ink">{d.name}</span>}
          {/* One line: the column takes the width the source's name needs. */}
          <p className="whitespace-nowrap text-xs font-normal text-ink-muted" data-testid="dataset-source">
            Data Source: <RecordLink table="Data Source" rowId={d.source} name={d.source} />
          </p>
        </div>
      ),
    },
    { key: 'served', header: 'Served From', phone: 'status', cell: (d) => <ServedFrom dataset={d} /> },
    {
      key: 'rows',
      header: 'Rows',
      align: 'end',
      phone: 'value',
      cell: (d) => <div className={CELL}>{d.rows === null ? <span className="text-ink-muted">No data yet</span> : fmtCount(d.rows)}</div>,
    },
    {
      key: 'as-of',
      header: 'As Of',
      phone: 'meta',
      // The snapshot behind Rows and As Of is a record, so its time opens it.
      cell: (d) => (
        <div className={`whitespace-nowrap ${CELL}`}>
          {d.snapshot ? <RecordLink table="Dataset Snapshot" rowId={d.snapshot} name={fmtInstantIST(d.as_of)} /> : '—'}
        </div>
      ),
    },
    {
      key: 'switch',
      header: <span className="sr-only">Switch To Warehouse</span>,
      align: 'end',
      cell: (d) => {
        if (!onStandIn(d)) return null
        const running = switching === `${app}.${d.name}`
        return (
          <div className={CELL}>
            <Button
              aria-label={`Switch ${d.name} To Warehouse`}
              disabled={switching !== null}
              onClick={() => void switchToWarehouse(app, d)}
              className="whitespace-nowrap max-sm:min-h-11"
            >
              {running ? 'Switching…' : 'Switch To Warehouse'}
            </Button>
          </div>
        )
      },
    },
  ]

  const apps = list.data?.apps ?? []
  return (
    <div className="space-y-6" data-testid="datasets-page">
      <div>
        <h1 className="text-lg font-semibold text-ink">{adminPageTitle('datasets')}</h1>
        <p className="text-sm text-ink-muted">
          Where each app&rsquo;s data comes from. A stand-in is sample data loaded from a file, shown until the warehouse has the real data.
        </p>
      </div>
      {verdict && <Notice tone={verdict.tone}>{verdict.text}</Notice>}
      {list.isPending ? (
        <Skeleton label="Loading datasets" lines={4} />
      ) : list.isError && !list.data ? (
        <Notice tone="negative">
          <p>The datasets could not be loaded.</p>
          <Button className="mt-2" onClick={() => void list.refetch()}>Try again</Button>
        </Notice>
      ) : apps.length === 0 ? (
        <EmptyState title="No Datasets Yet" body="No installed app declares a dataset." />
      ) : (
        apps.map((app) => (
          <section key={app.app} aria-labelledby={`datasets-of-${app.app}`} className="space-y-2" data-testid={`datasets-of-${app.app}`}>
            <h2 id={`datasets-of-${app.app}`} className="text-base font-semibold text-ink">{app.title}</h2>
            <DataList
              caption={`${app.title} datasets`}
              rows={app.datasets}
              columns={columns(app.app)}
              rowKey={(d) => d.name}
              rowTestId={(d) => `dataset-${app.app}.${d.name}`}
              empty={{ title: 'No Datasets Yet', body: 'This app declares no dataset.' }}
            />
          </section>
        ))
      )}
    </div>
  )
}
