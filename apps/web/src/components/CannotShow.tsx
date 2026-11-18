import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Button, ProblemPage, buttonClasses, type ProblemKind } from '@featherbase/shop-floor'
import { ApiError } from '../lib/api'

/** #1327: which of the three a failed load is. */
export function problemKind(error: unknown): ProblemKind {
  if (error instanceof ApiError && error.status === 404) return 'not-found'
  if (error instanceof ApiError && error.status === 403) return 'no-access'
  return 'failed'
}

export function AdminHomeLink() {
  return <Link to="/featherbase/admin" className={buttonClasses()}>Go to the Admin home</Link>
}

/** A refusal in the server's own words ("You don't have read permission on Back Office"), else plainly. */
function refusalWords(error: unknown): string {
  const said = error instanceof ApiError ? error.message.trim() : ''
  return said ? said.replace(/([^.!?])$/, '$1.') : 'Your account can’t see it.'
}

/** A failure in words a person can act on; the server's own words when it gave a reason. */
function failureWords(error: unknown): string {
  if (error instanceof ApiError && error.status < 500 && error.message) return error.message
  if (error instanceof ApiError) return 'Something went wrong on the server. Try again in a moment.'
  return 'The server didn’t answer. Try again in a moment.'
}

/**
 * #1327 (audit F07): what a page says when the thing it was asked for can't be shown: a `what` (a Table's
 * label, "report") that isn't there, may not be opened, or failed to load. Not found leads back (`back`, else
 * the Admin home); no access leads to the Admin home; a failure offers Try again.
 */
export function CannotShow({ error, what, id, named, back, onRetry }: {
  error: unknown
  what: string
  /** A record's ID, or `named`: a report's or dashboard's name. */
  id?: string
  named?: string
  back?: ReactNode
  onRetry: () => void
}) {
  const kind = problemKind(error)
  const asked = id ? `No ${what} has the ID “${id}”. ` : named ? `There is no ${what} named “${named}”. ` : ''
  if (kind === 'not-found')
    return (
      <ProblemPage
        kind="not-found"
        title={`This ${what} isn’t here`}
        body={`${asked}It may have been deleted, or the link is wrong.`}
        action={back ?? <AdminHomeLink />}
      />
    )
  if (kind === 'no-access')
    return (
      <ProblemPage
        kind="no-access"
        title={`You can’t open this ${what}`}
        body={`${refusalWords(error)} Ask your administrator if you need it.`}
        action={<AdminHomeLink />}
      />
    )
  return (
    <ProblemPage
      kind="failed"
      title={`This ${what} couldn’t be opened`}
      body={failureWords(error)}
      action={<Button onClick={onRetry}>Try again</Button>}
    />
  )
}
