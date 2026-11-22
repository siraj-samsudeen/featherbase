import { useState } from 'react'
import { ModuleCrumb } from './ModuleCrumb'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, DataList, Notice, PageHeader, Segmented, Sentence, buttonClasses, fmtCount, type DataColumn } from '@featherbase/shop-floor'
import { actionDoneSchema, type ActionPreview as Preview, type ActionPreviewAnswer, type ActionDone } from 'shared'
import { api } from '../lib/api'
import { tableLabel, useMeta } from '../lib/meta'
import { runAppAction } from '../lib/record-facts'
import { usePageTitle } from '../lib/page-title'
import { FactCell } from './ListRows'

type Row = Preview['rows'][number]

/**
 * #1340: an app's action said before it runs, as an ordinary page: "<Table> / <action>", the title with Cancel and
 * Run, one sentence of what would happen, filters with their counts, and the rows it would touch in the shared list.
 * Nothing is saved until Run; after it, the page reads again, so a second Run shows that it would add nothing.
 */
export function ActionPreview({ table, action }: { table: string; action: string }) {
  const meta = useMeta(table)
  const label = tableLabel(table, meta.data)
  const queryClient = useQueryClient()
  const preview = useQuery({
    queryKey: ['action-preview', table, action],
    queryFn: () => api.get<ActionPreviewAnswer>(`/api/records/${encodeURIComponent(table)}/preview/${encodeURIComponent(action)}`),
    retry: false,
  })
  usePageTitle(preview.data?.label ?? label)
  const [filter, setFilter] = useState('all')
  const [running, setRunning] = useState(false)
  const [said, setSaid] = useState<{ tone: 'positive' | 'negative'; words: string; done?: ActionDone['said'] } | null>(null)
  const run = async (answer: ActionPreviewAnswer) => {
    setRunning(true)
    setSaid(null)
    try {
      // The app may say what the run did, naming the record that keeps it; else the page says it is done.
      const done = actionDoneSchema.safeParse(await runAppAction(answer.app, action))
      setSaid(done.success ? { tone: 'positive', words: `${answer.label}: `, done: done.data.said }
        : { tone: 'positive', words: `${answer.label}: done. Running it again adds nothing; the run is kept with its counts.` })
      await queryClient.invalidateQueries()
    } catch (error) {
      setSaid({ tone: 'negative', words: error instanceof Error ? error.message : 'That did not go through. Try again.' })
    } finally {
      setRunning(false)
    }
  }
  const data = preview.data?.preview
  const counts = new Map<string, number>()
  for (const row of data?.rows ?? []) counts.set(row.filter, (counts.get(row.filter) ?? 0) + 1)
  const rows = (data?.rows ?? []).filter((r) => filter === 'all' || r.filter === filter)
  const columns: DataColumn<Row>[] = (data?.columns ?? []).map((c, i) => ({
    key: c.key,
    header: c.label,
    phone: i === 0 ? 'title' : 'meta',
    cell: (row) => {
      const cell = row.cells[c.key]
      if (!cell) return <span className="text-ink-subtle">—</span>
      const shown = 'parts' in cell ? <Sentence parts={cell.parts} /> : <FactCell fact={cell} />
      return c.nowrap ? <span className="whitespace-nowrap">{shown}</span> : shown
    },
  }))
  return (
    <div className="flex flex-col gap-4" data-testid="action-preview">
      <PageHeader
        // The path starts where the Table's list and record do, at its module.
        breadcrumb={<><ModuleCrumb meta={meta.data} className="hover:text-ink" /> / <Link to="/featherbase/admin/table/$table" params={{ table }} search={{} as never} className="hover:text-ink">{label}</Link> / {data?.title ?? 'Preview'}</>}
        title={data?.title ?? preview.data?.label ?? 'Preview'}
        // After a run the page reads again: what it lists is now a second run.
        status={said?.tone === 'positive' ? 'Done · the list now shows what running it again would do' : data?.status}
        actions={<>
          <Link to="/featherbase/admin/table/$table" params={{ table }} search={{} as never} className={buttonClasses()} data-testid="action-preview-cancel">Cancel</Link>
          {preview.data && <Button variant="primary" loading={running} onClick={() => run(preview.data!)} data-testid="action-preview-run">{data?.runLabel ?? 'Run'}</Button>}
        </>}
      />
      {said && <Notice tone={said.tone}><span data-testid={said.done ? 'action-preview-done' : undefined}>{said.words}{said.done && <Sentence parts={said.done} />}</span></Notice>}
      {preview.isError && <Notice tone="negative">{preview.error instanceof Error ? preview.error.message : 'This preview could not be read.'}</Notice>}
      {data && <>
        <p className="text-base text-ink" data-testid="action-preview-sentence"><Sentence parts={data.sentence} /></p>
        {data.filters.length > 0 && (
          // The whole plan's counts where the app sends only the first lines.
          <Segmented label="Show" value={filter} onChange={setFilter} options={[
            { value: 'all', label: `All ${fmtCount(data.total ?? data.rows.length)}` },
            ...data.filters.map((f) => ({ value: f.key, label: `${f.label} ${fmtCount(f.count ?? counts.get(f.key) ?? 0)}` })),
          ]} />
        )}
        <Card className="overflow-hidden">
          <DataList caption={data.title} rows={rows} columns={columns} rowKey={(row) => `${rows.indexOf(row)}`} rowTestId={() => 'action-preview-row'}
            empty={{ title: 'Nothing here', body: 'No row falls under this filter.' }} />
        </Card>
        {data.total !== undefined && data.total > data.rows.length && (
          <p className="text-sm text-ink-muted" data-testid="action-preview-shown">Showing the first {fmtCount(data.rows.length)} of {fmtCount(data.total)} lines; Run carries out all of them.</p>
        )}
        {data.note && <p className="text-sm text-ink-muted" data-testid="action-preview-note">{data.note}</p>}
      </>}
      {preview.isPending && <p className="text-sm text-ink-subtle">Loading…</p>}
    </div>
  )
}
