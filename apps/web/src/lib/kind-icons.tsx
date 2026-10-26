import { FileText, LayoutDashboard, List, LogIn, Pencil, Search, type LucideIcon } from '../components/ui/icons'

// One vocabulary for what kind of thing an activity or a remembered
// destination is — the activity feed, the sidebar's Recently opened and the
// command bar all draw a kind from here, so a page always looks like a page.
// The icon stands in for a written label, so each carries the kind's name.

export type ActivityKind = 'page' | 'row' | 'list' | 'search' | 'change' | 'login'

export interface KindVisual {
  /** The kind's name, read out in place of the icon. */
  label: string
  Icon: LucideIcon
  /** The tinted tile the feed draws (token classes only). */
  tint: string
}

export const KIND_VISUALS: Record<ActivityKind, KindVisual> = {
  page: { label: 'Page', Icon: LayoutDashboard, tint: 'bg-opportunity-tint text-opportunity' },
  row: { label: 'Row', Icon: FileText, tint: 'bg-action-tint text-action' },
  list: { label: 'List', Icon: List, tint: 'bg-positive-tint text-positive' },
  search: { label: 'Search', Icon: Search, tint: 'bg-missing-tint text-missing' },
  change: { label: 'Change', Icon: Pencil, tint: 'bg-caution-tint text-caution' },
  login: { label: 'Sign-in', Icon: LogIn, tint: 'bg-subtle text-ink-muted' },
}

export function kindVisual(kind: string): KindVisual {
  return KIND_VISUALS[kind as ActivityKind] ?? KIND_VISUALS.row
}

/** The kind as an icon: a coloured tile (the feed) or a quiet grey glyph (lists of names). */
export function KindIcon({ kind, tone = 'colour' }: { kind: string; tone?: 'colour' | 'grey' }) {
  const { label, Icon, tint } = kindVisual(kind)
  if (tone === 'grey')
    return (
      <span role="img" aria-label={label} data-testid="kind-icon" data-kind={kind} className="inline-flex shrink-0 text-ink-subtle">
        <Icon aria-hidden size={14} />
      </span>
    )
  return (
    <span
      role="img"
      aria-label={label}
      data-testid="kind-icon"
      data-kind={kind}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tint}`}
    >
      <Icon aria-hidden size={14} />
    </span>
  )
}
