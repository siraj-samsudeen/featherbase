// #206/#207 (issue #197): what each file-import did, and undoing one whole.
//
// "Since here by mistake it created these 11 tables, I did not have an easy
// way to see these tables came from where and delete them all in one."
//
// The Import Log is a Table like any other and its list view answers "what
// runs have happened?" — one row per part per target, which for an
// eleven-sheet workbook is eleven-plus rows that say nothing about being one
// thing the user did. This page is the other question: what did that IMPORT
// do, as one act.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'

interface BatchTarget {
  table: string
  created: boolean
  inserted: number
  updated: number
  failed: number
  run_id: string | null
  reverted_at: string | null
  sheets: string[]
  exists: boolean
}

interface ImportBatch {
  batch_id: string
  file_name: string | null
  started_at: string
  user: string | null
  targets: BatchTarget[]
  inserted: number
  updated: number
  failed: number
  created: number
}

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function Counts({ batch }: { batch: ImportBatch }) {
  return (
    <span className="text-gray-500">
      {batch.updated > 0 && `${batch.updated} updated · `}
      {batch.inserted} rows added
      {batch.failed > 0 && (
        <span className="text-[var(--color-danger)]"> · {batch.failed} failed</span>
      )}
    </span>
  )
}

interface Outcome {
  deleted: string[]
  refused: { table: string; message: string }[]
}

function BatchCard({ batch, onDone }: { batch: ImportBatch; onDone: (o: Outcome) => void }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  const removable = batch.targets.filter((t) => t.created && t.exists)

  const remove = useMutation({
    mutationFn: () =>
      api.post<Outcome>(
        `/api/import/batches/${encodeURIComponent(batch.batch_id)}/delete_tables`,
        {},
      ),
    onSuccess: async (res) => {
      // Reported by the PAGE, not here: deleting a Table sweeps the Import
      // Log rows that pointed at it, so a batch whose Tables all went is
      // itself gone from the next fetch — and this card with it. A
      // confirmation that disappears with the thing it confirms is no
      // confirmation at all.
      onDone(res)
      setConfirming(false)
      await queryClient.invalidateQueries({ queryKey: ['import-batches'] })
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      await queryClient.invalidateQueries({ queryKey: ['import-targets'] })
    },
  })

  return (
    <div className="fc-card mb-3 p-3" data-testid={`ib-batch-${batch.batch_id}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-[var(--color-ink)]">
          {batch.file_name ?? 'Imported data'}
        </span>
        <span className="text-xs text-gray-500">{when(batch.started_at)}</span>
        {batch.user && <span className="text-xs text-gray-500">by {batch.user}</span>}
        <span className="ml-auto text-sm">
          <Counts batch={batch} />
        </span>
      </div>

      <div className="text-sm">
        {/* One line per TARGET, not per part: a merge group fed by eleven
            sheets is one Table and says so. */}
        {batch.targets.map((target) => (
          <div
            key={target.table}
            className="flex flex-wrap items-baseline gap-2 border-t border-[var(--color-border)] py-1 first:border-t-0"
            data-testid={`ib-target-${target.table}`}
          >
            {target.exists ? (
              <Link
                to="/admin/$table"
                params={{ table: target.table }}
                search={{ filters: undefined }}
                className="underline"
              >
                {target.table}
              </Link>
            ) : (
              <span className="text-gray-400 line-through">{target.table}</span>
            )}
            {target.created ? (
              <span
                className="fc-pill bg-[var(--color-brand-tint)] text-[var(--color-brand-dark)]"
                data-testid={`ib-created-${target.table}`}
              >
                created by this import
              </span>
            ) : (
              <span className="fc-pill" data-testid={`ib-appended-${target.table}`}>
                rows added to an existing Table
              </span>
            )}
            {target.sheets.length > 0 && (
              <span className="text-xs text-gray-500">
                from {target.sheets.length === 1 ? 'sheet' : `${target.sheets.length} sheets`}{' '}
                {target.sheets.join(', ')}
              </span>
            )}
            <span className="ml-auto text-xs text-gray-500">
              {target.updated > 0 && `${target.updated} updated · `}
              {target.inserted} added
              {target.failed > 0 && (
                <span className="text-[var(--color-danger)]"> · {target.failed} failed</span>
              )}
              {target.reverted_at && ' · reverted'}
            </span>
          </div>
        ))}
      </div>

      {/* #207: the whole-batch action, and ONLY over what the import created.
          A Table that merely received rows is undone by the per-run revert in
          the wizard — deleting it would destroy data this import never made. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {removable.length > 0 && !confirming && (
          <button
            type="button"
            className="fc-btn py-1 text-[var(--color-danger)]"
            data-testid={`ib-delete-${batch.batch_id}`}
            onClick={() => setConfirming(true)}
          >
            Delete the {removable.length} {removable.length === 1 ? 'Table' : 'Tables'} this import
            created
          </button>
        )}
        {confirming && (
          <span
            className="rounded bg-[var(--color-danger-tint)] px-2 py-1"
            data-testid={`ib-confirm-${batch.batch_id}`}
          >
            Delete <strong>{removable.map((t) => t.table).join(', ')}</strong> and every row in
            them? This also removes their import records, and cannot be undone.{' '}
            <button
              type="button"
              className="fc-btn-primary ml-1 py-0.5"
              data-testid={`ib-confirm-go-${batch.batch_id}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'Deleting…' : `Delete ${removable.length}`}
            </button>
            <button
              type="button"
              className="fc-btn ml-1 py-0.5"
              data-testid={`ib-cancel-${batch.batch_id}`}
              onClick={() => setConfirming(false)}
            >
              Keep them
            </button>
          </span>
        )}
        {remove.isError && (
          <span className="text-[var(--color-danger)]" data-testid={`ib-error-${batch.batch_id}`}>
            {remove.error instanceof ApiError ? remove.error.message : 'Could not delete'}
          </span>
        )}
      </div>
    </div>
  )
}

export function ImportBatches() {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const batches = useQuery({
    queryKey: ['import-batches'],
    queryFn: () => api.get<{ batches: ImportBatch[] }>('/api/import/batches?limit=50'),
  })

  return (
    <div data-testid="import-batches" className="max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-[var(--color-ink)]">Imports</h1>
      <p className="mb-4 text-xs text-gray-500">
        Every file you have imported, and what each one did.{' '}
        <Link
          to="/admin/$table"
          params={{ table: 'Import Log' }}
          search={{ filters: undefined }}
          className="underline"
          data-testid="ib-log-link"
        >
          The Import Log
        </Link>{' '}
        has the run-by-run detail, including how to undo the rows one run wrote.
      </p>

      {outcome && (
        <p className="fc-card mb-3 p-2 text-sm" data-testid="ib-outcome">
          {outcome.deleted.length > 0 && (
            <span className="text-green-700">Deleted {outcome.deleted.join(', ')}. </span>
          )}
          {/* A refusal is named with its reason — never a silently smaller
              count than the button promised. */}
          {outcome.refused.map((r) => (
            <span key={r.table} className="text-[var(--color-danger)]">
              Kept {r.table}: {r.message}.{' '}
            </span>
          ))}
          {outcome.deleted.length > 0 &&
            ' Their import records went with them, so that import is no longer listed.'}
        </p>
      )}

      {batches.isPending && <p className="text-sm text-gray-500">Loading…</p>}
      {batches.isError && (
        <p className="text-sm text-[var(--color-danger)]" data-testid="ib-error">
          {batches.error instanceof ApiError ? batches.error.message : 'Could not load imports'}
        </p>
      )}
      {batches.data?.batches.length === 0 && (
        <p className="text-sm text-gray-500" data-testid="ib-empty">
          Nothing imported yet.{' '}
          <Link to="/admin/import" search={{ table: undefined }} className="underline">
            Import a file
          </Link>
          .
        </p>
      )}
      {batches.data?.batches.map((batch) => (
        <BatchCard key={batch.batch_id} batch={batch} onDone={setOutcome} />
      ))}
    </div>
  )
}
