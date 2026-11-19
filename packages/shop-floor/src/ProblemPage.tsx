import type { ReactNode } from 'react'
import { EmptyState } from './EmptyState'
import { FileQuestion, ShieldLock, TriangleAlert, type LucideIcon } from './icons'

/** Why a screen cannot show what was asked for. */
export type ProblemKind = 'not-found' | 'no-access' | 'failed'

const ICON: Record<ProblemKind, LucideIcon> = { 'not-found': FileQuestion, 'no-access': ShieldLock, failed: TriangleAlert }

/**
 * #1327 (audit F07): the one page for what a screen cannot show — not found, no access, or could not
 * open — said in plain words, with the one way forward (back, home, or try again). It sits inside the
 * page's own shell; a failure is announced, the other two are simply read.
 */
export function ProblemPage({ kind, title, body, action }: { kind: ProblemKind; title: ReactNode; body: ReactNode; action: ReactNode }) {
  return (
    <div data-testid={`problem-${kind}`} role={kind === 'failed' ? 'alert' : undefined}>
      <EmptyState icon={ICON[kind]} title={title} body={body} action={action} />
    </div>
  )
}
