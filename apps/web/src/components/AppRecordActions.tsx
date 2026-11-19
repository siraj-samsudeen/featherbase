import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Notice, touchRowClasses } from '@featherbase/shop-floor'
import type { RecordAction } from 'shared'
import { ActionDisclosure } from './ActionDisclosure'
import { runAppAction, type Described } from '../lib/record-facts'

/**
 * #1340: a list's Record actions, as the app that describes the Table offers them: each its name and one line saying
 * what it does. One runs the app's action in place (its answer, or its refusal in its own words, said under the
 * menu); one opens a page, such as the platform's preview of an action.
 */
export function AppRecordActions({ described, table }: { described: NonNullable<Described>; table: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<{ tone: 'positive' | 'negative'; words: string } | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const actions = described.facts.actions ?? []
  const run = async (action: RecordAction) => {
    setBusy(action.key)
    setSaid(null)
    try {
      await runAppAction(described.app, action.run!)
      setSaid({ tone: 'positive', words: `${action.label}: done.` })
      // What it wrote shows at once: the rows, their facts and the Tables they link to.
      await queryClient.invalidateQueries()
    } catch (error) {
      setSaid({ tone: 'negative', words: error instanceof Error ? error.message : 'That did not go through. Try again.' })
    } finally {
      setBusy(null)
      setOpen(false)
    }
  }
  return (
    <div className="flex flex-col items-end gap-1" data-testid="app-record-actions" data-table={table}>
      <ActionDisclosure label="Record actions" open={open} onOpenChange={setOpen}>
        <div role="group" aria-label="Record actions" className="flex w-full flex-col items-stretch gap-0.5 whitespace-normal">
          {actions.map((action) => {
            const body = <>
              <span className="text-sm font-medium text-ink">{busy === action.key ? `${action.label}…` : action.label}</span>
              <span className="text-xs text-ink-muted">{action.explain}</span>
            </>
            const classes = touchRowClasses('flex w-full flex-col items-start gap-0.5 whitespace-normal rounded-lg px-3 py-2 text-left hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus')
            return action.run
              ? <button key={action.key} type="button" disabled={busy !== null} onClick={() => run(action)} className={classes} data-testid={`record-action-${action.key}`}>{body}</button>
              : <a key={action.key} href={action.href} className={classes} data-testid={`record-action-${action.key}`}
                  onClick={(e) => {
                    // Featherbase's own pages open in place; an app's page is a page load.
                    if (!action.href!.startsWith('/featherbase/') || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
                    e.preventDefault()
                    setOpen(false)
                    void navigate({ href: action.href! })
                  }}>{body}</a>
          })}
        </div>
      </ActionDisclosure>
      {said && <div role="status" className="max-w-md" data-testid="record-action-said"><Notice tone={said.tone}>{said.words}</Notice></div>}
    </div>
  )
}
